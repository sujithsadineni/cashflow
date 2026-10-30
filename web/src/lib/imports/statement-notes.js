/**
 * What a statement says that's worth knowing (D360): shown beside the reading's
 * progress, then beside the limit line once it's read. A credit limit or APR
 * that moved since the statement before, high use of the limit, a terms
 * notice, a new mailing address, which bank paid it, a plan still being paid,
 * interest or a fee charged, rewards earned, a name nobody on a shared card
 * accounts for, lines to check, and rows that don't add up; and the calm
 * ones, so a quiet statement still says something: the limit and APR
 * unchanged, new charges against last time, payments not matched yet, and
 * rows that add up to the cent.
 *
 * Each note says when the reading reaches it (`at`: 'summary', a row's id, or
 * 'end') and what it points at on the page (`target`: a figure's key or a
 * row's id), so it appears as its line is read and lights that line on hover.
 * Money is worded by the formatters passed in (formatMoney stays the only
 * divider). Pure; tested in statement-notes.test.js.
 *
 * @param data staged read: { rows, summary, tally, context }
 * @param fmt  { money(cents), date(iso), mask(name), apr(bps) }
 * @returns [{ key, tone: 'warn'|'earn'|'info', emoji, text, at, target }]
 */
import { lineFlags } from '../review/line-review.js';

export function statementNotes(data, fmt) {
  if (!data) return [];
  const { rows = [], summary = {}, tally = null, context = {} } = data;
  const prev = context.previous ?? null;
  const notes = [];
  // One line each, an emoji first (the owner's ask): what it is at a glance, then the figure.
  const add = (key, tone, emoji, text, at = 'end', target = null) => notes.push({ key, tone, emoji, text, at, target });
  const sum = (list, f) => list.reduce((t, x) => t + f(x), 0);

  // The credit line, against the statement before.
  const limit = context.credit_limit_cents;
  if (limit != null && prev?.credit_limit_cents != null && limit !== prev.credit_limit_cents) {
    const up = limit > prev.credit_limit_cents;
    add('limit', up ? 'earn' : 'warn', up ? '🎉' : '⚠️', `Limit ${up ? 'raised' : 'cut'} to ${fmt.money(limit)} (was ${fmt.money(prev.credit_limit_cents)})`, 'summary', { figure: 'limit' });
  }
  // Against the printed limit, else the one the household set (Apple prints none).
  const ownLimit = limit == null ? context.credit_limit_manual_cents ?? null : null;
  if ((limit ?? ownLimit) > 0 && summary.closing_cents > 0) {
    const pct = Math.round((summary.closing_cents / (limit ?? ownLimit)) * 100);
    if (pct >= 50) add('usage', 'warn', '🔥', `${pct}% of ${ownLimit ? 'your' : 'the'} limit used`, 'summary', { figure: 'closing' });
  }
  const apr = context.apr_purchase_bps;
  if (apr != null && prev?.apr_purchase_bps != null && apr !== prev.apr_purchase_bps) {
    const up = apr > prev.apr_purchase_bps;
    add('apr', up ? 'warn' : 'earn', up ? '📈' : '📉', `APR ${up ? 'up' : 'down'} to ${fmt.apr(apr)} (was ${fmt.apr(prev.apr_purchase_bps)})`, 'summary', { figure: 'apr' });
  }
  // Nothing moved is worth saying too: the household checks for it.
  const limitSame = limit != null && limit === prev?.credit_limit_cents;
  const aprSame = apr != null && apr === prev?.apr_purchase_bps;
  if (limitSame && aprSame) add('steady', 'info', '✅', 'Limit and APR unchanged', 'summary', { figure: 'limit' });
  else if (limitSame && apr == null) add('steady', 'info', '✅', 'Limit unchanged', 'summary', { figure: 'limit' });
  // New charges against the statement before.
  const spent = summary.spend_cents == null ? null : Math.abs(summary.spend_cents);
  const before = prev?.total_spend_cents == null ? null : Math.abs(prev.total_spend_cents);
  if (spent > 0 && before > 0) {
    const pct = Math.round(((spent - before) / before) * 100);
    if (Math.abs(pct) < 10) add('spend', 'info', '🟰', 'Spending steady vs last statement', 'summary', { figure: 'spend' });
    else add('spend', pct >= 25 ? 'warn' : pct < 0 ? 'earn' : 'info', pct > 0 ? '💸' : '🪙',
      `Spending ${pct > 0 ? 'up' : 'down'} ${Math.abs(pct)}% vs last statement`, 'summary', { figure: 'spend' });
  }

  // Rows the reading passes: who paid it, interest and fees charged.
  const byBank = new Map();
  for (const p of context.payments ?? []) {
    const label = `${p.account.issuer ?? p.account.name}${p.account.mask ? ` ··${p.account.mask}` : ''}`;
    byBank.set(label, [...(byBank.get(label) ?? []), p.row_id]);
  }
  // Payments read ✅ once matched and ❗ while not, one note each (D392, the owner's ask).
  for (const [label, ids] of byBank) add(`paid-${label}`, 'info', '✅', `Paid from ${label}${ids.length > 1 ? ` ×${ids.length}` : ''}`, ids[0], { row: ids[0] });
  // A bank account's payments to the cards (D199): each card its own note, so hovering one lights its
  // row, ✅ once the card's statement matched it, ❗ until then. A verified one moves from ❗ to ✅ on
  // its own: the server works both lists out each time the statement is opened.
  // One note per payment (D394): what it covered of the card's statement, so two payments to one
  // card can say different things ("Sep balance in full", "$400.00 of $1,022.87 Sep balance").
  for (const p of context.paid_cards ?? []) {
    add(`paid-card-${p.row_id}`, 'info', '✅', `Paid ${p.account.name} · ${paymentCovered(p, fmt)}`, p.row_id, { row: p.row_id });
  }
  for (const p of context.unverified_card_payments ?? []) {
    add(`unverified-card-${p.row_id}`, 'warn', '❗', `${p.name}${p.paid_cents > 0 ? ` ${fmt.money(p.paid_cents)}` : ' payment'} not verified yet`, p.row_id, { row: p.row_id });
  }
  const unmatched = context.unmatched_payments ?? [];
  if (unmatched.length) add('unmatched', 'warn', '❗', `${unmatched.length === 1 ? 'Payment' : `${unmatched.length} payments`} not matched to a bank yet`, unmatched[0], { row: unmatched[0] });
  const charged = (type) => rows.filter((r) => r.txn_type === type && r.amount_cents < 0 && r.review_status !== 'REJECTED');
  const interest = charged('interest');
  if (interest.length) add('interest', 'warn', '🧾', `Interest charged: ${fmt.money(-sum(interest, (r) => r.amount_cents))}`, interest[0].id, { row: interest[0].id });
  const fees = charged('fee');
  if (fees.length) add('fees', 'warn', '🧾', `${fees.length === 1 ? 'Fee' : `${fees.length} fees`} charged: ${fmt.money(-sum(fees, (r) => r.amount_cents))}`, fees[0].id, { row: fees[0].id });

  // What the statement printed besides its rows.
  const notice = context.terms_notice;
  if (notice?.effective_on) add('terms', 'warn', '📜', `Terms change ${fmt.date(notice.effective_on)}${notice.reject_by ? ` · reject by ${fmt.date(notice.reject_by)}` : ''}`);
  if (context.address_changed) add('address', 'info', '📬', 'New mailing address');
  const plans = (context.plans ?? []).filter((p) => p.remaining_cents > 0);
  if (plans.length) add('plans', 'info', '🗓️', `${plans.length === 1 ? 'Plan' : `${plans.length} plans`} still running: ${fmt.money(sum(plans, (p) => p.remaining_cents))} left`);
  if (summary.cashback_cents > 0) add('rewards', 'earn', '🎁', `${fmt.money(summary.cashback_cents)} in rewards earned`);
  for (const p of context.proposed ?? []) {
    add(`who-${p.printed_name}-${p.card_ending}`, 'warn', '👤', `Who is ${fmt.mask(p.printed_name ?? 'this name')}${p.card_ending ? ` ··${p.card_ending}` : ''}? ${p.rows} ${p.rows === 1 ? 'row' : 'rows'}`);
  }

  // What the review asks of the person.
  const flagged = rows.filter((r) => lineFlags(r).length > 0);
  if (flagged.length) add('check', 'warn', '👀', `${flagged.length} ${flagged.length === 1 ? 'line' : 'lines'} to check`, 'end', { row: flagged[0].id });
  if (tally?.status === 'mismatch') add('tally', 'warn', '❗', `Off by ${fmt.money(Math.abs(tally.diff_cents))}: a line may be missing`);
  if (tally?.status === 'match') add('tally', 'earn', '✅', 'Adds up to the cent');
  return notes;
}

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * What one bank payment covered of the card statement it went against (D394): the newest one
 * closed by the payment's day, named by the month it closed. Words only; the server sends the
 * figures (paid_cents, and statement: balance, minimum, what earlier payments since its close
 * already paid, and when the next one closed). Nothing owed on it means a payment ahead, named by
 * the statement still open. Without a statement on file it's just the amount.
 */
export function paymentCovered(p, fmt) {
  const paid = p.paid_cents;
  const st = p.statement;
  if (!st) return fmt.money(paid);
  const monthOf = (iso) => MONTH[Number(iso.slice(5, 7)) - 1];
  const month = monthOf(st.period_end);
  const owed = st.balance_cents - (st.paid_before_cents ?? 0);
  // Nothing owed on it (a credit, or already paid in full): a payment ahead, toward the statement still open.
  if (st.balance_cents <= 0 || owed <= 0) {
    return st.next_period_end ? `${fmt.money(paid)} early, toward ${monthOf(st.next_period_end)} statement` : `${fmt.money(paid)} early, nothing owed yet`;
  }
  if (paid === st.balance_cents) return `${month} balance in full`;
  if (paid === owed) return `rest of ${month} balance`;
  if (st.minimum_cents != null && paid === st.minimum_cents) return `${month} minimum only`;
  if (paid > owed) return `${month} balance + ${fmt.money(paid - owed)} more`;
  return `${fmt.money(paid)} of ${fmt.money(st.balance_cents)} ${month} balance`;
}

/**
 * The notes shown at a point in the reading: the summary's once it's read, a
 * row's once it has landed, the rest at the end. `landed` is the set of row
 * ids landed so far; `ended` once every line is in.
 */
export function notesSoFar(notes, { summaryRead, landed, ended }) {
  return notes.filter((n) => (n.at === 'summary' ? summaryRead : n.at === 'end' ? ended : ended || landed.has(n.at)));
}
