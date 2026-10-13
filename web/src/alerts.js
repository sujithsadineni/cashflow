import { api, formatMoney } from './api';
import { longDate } from './balance-transfer';

/**
 * "Already shown today," not "shown once ever" or "shown every
 * reload." A condition that's still true tomorrow (the statement's
 * still not up, the subscription still hasn't posted) deserves a
 * fresh mention rather than going silent forever the first time it's
 * seen — but three page refreshes in one evening shouldn't repeat the
 * same toast three times. Keyed on the exact set of findings in each
 * group, so the moment that set changes (one gets resolved, a new one
 * joins) it reads as new again automatically, with no separate
 * "clear this alert" logic to build.
 */
const SEEN_PREFIX = 'cashflow_alert_seen:';

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function alreadyShownToday(key) {
  try {
    return localStorage.getItem(SEEN_PREFIX + key) === todayKey();
  } catch {
    return false;
  }
}

function markShownToday(key) {
  try {
    localStorage.setItem(SEEN_PREFIX + key, todayKey());
  } catch {
    // Private browsing / blocked storage — the toast still shows this
    // session, it just won't be remembered as "already seen" next time.
  }
}

/** "A, B, C" for 3 or fewer; "A, B, +3 more" past that — a toast is a line, not a list. */
function summarizeNames(names, max = 3) {
  if (names.length <= max) return names.join(', ');
  return `${names.slice(0, max).join(', ')}, +${names.length - max} more`;
}

/** "−$5,000.00" / "+$2,050.00": which way a total moves. */
const signed = (cents) => formatMoney(cents, { showSign: true });

// Which total each Review fix moves, and which way (review-groups.js says the same in words).
const MOVES = {
  zelle_card_payment: ['spending', -1],
  card_now_tracked: ['spending', -1],
  type_reward: ['spending', +1],
  daily_cash: ['spending', -1],
  abroad: ['spending', +1],
  card_deposit: ['income', -1],
  income_internal: ['income', -1],
};

/**
 * One toast per CATEGORY of finding, not one per finding — the first
 * version of this did the latter and a real household with five
 * lapsed subscriptions got a wall of seven stacked toasts covering
 * half the screen on every load. A single summarizing line reads as
 * designed; a toast per row reads as a bug.
 *
 * D201: each has a heading and a way to deal with it, and they arrive
 * least urgent first. Only the newest three show, so the ones about
 * money at risk (a promo ending, fixes that change your totals) are
 * the ones left on screen.
 */
export async function checkAlerts(notify) {
  let alerts;
  try {
    alerts = await api.alerts();
  } catch {
    return; // best-effort — a failed check shouldn't itself become an error toast
  }
  const [loans, suggestions] = await Promise.all([
    api.loans.list().catch(() => []),
    api.loans.suggestions().catch(() => []),
  ]);

  const queue = [];
  const once = (key, build) => {
    if (alreadyShownToday(key)) return;
    queue.push(build);
    markShownToday(key);
  };

  const { overdue_statements: statements, missed_recurring: missed, new_recurring: found } = alerts;
  const unknown = alerts.payments_unknown ?? [];
  const changes = alerts.review_changes ?? [];

  if (found.length > 0) {
    once(`new-recurring:${found.map((c) => c.match_name_contains).sort().join(',')}`, () => ({
      title: found.length === 1 ? 'New recurring charge found' : `${found.length} new recurring charges found`,
      message: found.length === 1
        ? `${found[0].name}${found[0].expected_amount_cents != null ? ` ~${formatMoney(Math.abs(found[0].expected_amount_cents))}` : ''} (${found[0].cadence.toLowerCase()})`
        : summarizeNames(found.map((c) => c.name)),
      type: 'info',
      action: { label: 'Review on Recurring', to: '/recurring' },
    }));
  }

  if (missed.length > 0) {
    once(`missed:${missed.map((r) => `${r.id}:${r.expected_date}`).sort().join(',')}`, () => ({
      title: missed.length === 1 ? 'A recurring charge hasn’t shown up' : `${missed.length} recurring charges haven’t shown up`,
      message: missed.length === 1
        ? `${missed[0].name}${missed[0].expected_amount_cents != null ? ` (~${formatMoney(Math.abs(missed[0].expected_amount_cents))})` : ''} this month`
        : `This month: ${summarizeNames(missed.map((r) => r.name))}`,
      type: 'error',
      duration: 8000,
      action: { label: 'Open Recurring', to: '/recurring' },
    }));
  }

  // D199/D200: card payments no bank, person or cash explains yet.
  if (unknown.length > 0) {
    once(`payments-unknown:${unknown.map((p) => p.id).sort().join(',')}`, () => ({
      title: unknown.length === 1 ? 'A card payment has no known source' : `${unknown.length} card payments have no known source`,
      message: `Newest: ${unknown[0].account_name} ${formatMoney(unknown[0].amount_cents)}. Usually a bank statement that isn’t uploaded yet.`,
      type: 'info',
      duration: 7000,
      action: { label: 'See which statements', to: '/review?tab=payments' },
    }));
  }

  if (statements.length > 0) {
    once(`statements:${statements.map((s) => `${s.account_id}:${s.expected_by}`).sort().join(',')}`, () => ({
      title: statements.length === 1 ? 'Statement past due' : `${statements.length} statements past due`,
      message: statements.length === 1
        ? `${statements[0].account_name}${statements[0].mask ? ` ···${statements[0].mask}` : ''} is ${statements[0].days_overdue} day${statements[0].days_overdue === 1 ? '' : 's'} late. Please upload it.`
        : `Please upload: ${summarizeNames(statements.map((s) => s.account_name))}`,
      type: 'error',
      duration: 8000,
      action: { label: 'Upload', to: '/import' },
    }));
  }

  // D200: fixes waiting in Review that move a total.
  if (changes.length > 0) {
    const count = changes.reduce((n, c) => n + c.count, 0);
    const by = {};
    for (const c of changes) {
      const [total, sign] = MOVES[c.check_kind] ?? [];
      if (total) by[total] = (by[total] ?? 0) + sign * c.cents;
    }
    const parts = Object.entries(by).filter(([, cents]) => cents !== 0).map(([total, cents]) => `${total.charAt(0).toUpperCase()}${total.slice(1)} ${signed(cents)}`);
    once(`review-changes:${changes.flatMap((c) => c.ids).sort().join(',')}`, () => ({
      title: `${count} fix${count === 1 ? '' : 'es'} would change your totals`,
      message: `${parts.join(' · ')} once you approve.`,
      type: 'info',
      duration: 9000,
      action: { label: 'Open Review', to: '/review?tab=findings' },
    }));
  }

  // D194: a balance transfer no loan tracks.
  for (const s of suggestions) {
    once(`bt-suggestion:${s.key}`, () => ({
      title: 'Balance transfer not tracked',
      message: `${s.account_name}${s.draw_cents ? ` has a ${formatMoney(s.draw_cents)} transfer` : ' has a balance transfer'}${s.end_date ? `, 0% until ${longDate(s.end_date)}` : ''}.`,
      type: 'info',
      duration: 8000,
      action: { label: 'Track it on Loans', to: '/settings?tab=loans' },
    }));
  }

  // D193: money at risk on a balance transfer — last, so it stays on screen.
  for (const loan of loans) {
    const bt = loan.bt;
    if (!bt) continue;
    const at = { label: 'Open Loans', to: '/settings?tab=loans' };
    if (bt.state === 'ending_soon') {
      once(`bt-ending:${loan.id}:${bt.end_date}`, () => ({
        title: `${loan.name}: 0% ends in ${bt.days_left} day${bt.days_left === 1 ? '' : 's'}`,
        message: `${formatMoney(bt.balance_cents)} still owed${bt.needed_monthly_cents ? `. About ${formatMoney(bt.needed_monthly_cents)} a month clears it by ${longDate(bt.end_date)}` : ''}.`,
        type: 'error', duration: 10000, action: at,
      }));
    } else if (bt.state === 'promo_ended' && bt.balance_cents > 0) {
      once(`bt-ended:${loan.id}:${bt.end_date}`, () => ({
        title: `${loan.name}: the 0% rate has ended`,
        message: `${formatMoney(bt.balance_cents)} is now charged interest.`,
        type: 'error', duration: 10000, action: at,
      }));
    } else if (bt.pace === 'behind') {
      once(`bt-behind:${loan.id}:${bt.balance_as_of}`, () => ({
        title: `${loan.name}: behind pace`,
        message: `The latest statement shows ${formatMoney(bt.last_statement_paid_cents)} paid. About ${formatMoney(bt.needed_monthly_cents)} a month clears it by ${longDate(bt.end_date)}.`,
        type: 'error', duration: 10000, action: at,
      }));
    }
    if (bt.warnings.some((w) => w.kind === 'interest_charged' || w.kind === 'late_fee')) {
      once(`bt-cost:${loan.id}:${bt.balance_as_of}`, () => ({
        title: `${loan.name}: interest or a late fee posted`,
        message: 'A late payment can end a 0% rate early. Open the loan to see what was charged.',
        type: 'error', duration: 10000, action: at,
      }));
    }
  }

  // One at a time, a beat apart, so they read as arriving rather than as a block.
  queue.forEach((build, i) => {
    setTimeout(() => {
      const { message, ...options } = build();
      notify(message, options);
    }, i * 250);
  });
}
