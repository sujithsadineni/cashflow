/**
 * A balance transfer's status (D193): everything the Loans page says
 * about one, read off the linked card's own statements and rows. No
 * per-transfer allocation (D70 removed that: no issuer prints one) and
 * no interest modelling (CLAUDE.md scope). Pure: facts in, status out.
 * Tested in balance-transfer.test.js.
 *
 * What it answers:
 *   - what was moved and what it cost: draws and their fees since the
 *     first draw (or the loan's start date)
 *   - what's owed: the card's latest statement balance (the same Tier 1
 *     number every linked loan uses, passed in), and what's been paid
 *     on the card since
 *   - when 0% ends: the latest statement's printed promo end date,
 *     falling back to the hand-entered deadline; a date that moved
 *     between statements is reported, not silently swapped
 *   - whether the pace clears it: balance ÷ payment months left
 *     (rounded up, the same rule as loanInsightsFor in the web app),
 *     against what was paid in the latest statement
 *   - what to watch: interest showing up, a late fee (it can end a
 *     promo early), purchases on the card, a stale statement
 */

const DAY = 86_400_000;
const ENDING_SOON_DAYS = 60;
const STALE_STATEMENT_DAYS = 45;

const utc = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

/** Whole payment months from today up to the end date, counting this month while its day hasn't passed. */
export function paymentMonthsLeft(endDate, today) {
  const [y, m, d] = endDate.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  return Math.max((y - ty) * 12 + (m - tm) + (d >= td ? 1 : 0), 0);
}

/** A row that moved money onto the card as a transfer or cash advance. */
export const isDraw = (t) => t.txn_type === 'transfer' && t.category_name === 'Balance Transfer';
/** That draw's transaction fee. */
export const isDrawFee = (t) => t.txn_type === 'fee' && (t.category_name === 'Balance Transfer' || /BALANCE TRANSFER|CASH ADVANCE|DIRECT DEPOSIT/i.test(t.description ?? ''));
const isLateFee = (t) => t.txn_type === 'fee' && /LATE/i.test(t.description ?? '');

/**
 * @param loan        { start_date, deadline_date, effective_balance_cents }
 * @param statements  the linked card's statements, oldest first: { period_start, period_end, closing_balance_cents, total_payments_cents }
 * @param promos      promo lines by statement period_end: { [period_end]: [{ kind, label, offer_id, apr_bps, standard_apr_bps, end_date, balance_subject_cents }] }
 * @param rows        the card's transactions: { id, posted_date, description, amount_cents, txn_type, category_name }
 * @param today       'YYYY-MM-DD'
 */
export function balanceTransferStatus({ loan, statements = [], promos = {}, rows = [], today }) {
  const draws = rows.filter(isDraw).sort((a, b) => a.posted_date.localeCompare(b.posted_date));
  // Since the loan's start if given, else the first draw. A sign either way
  // counts: a draw saved before D191 is positive, and still a draw.
  const since = loan.start_date ?? draws[0]?.posted_date ?? null;
  const inRange = (t) => since && t.posted_date >= since;
  const sum = (list) => list.reduce((s, t) => s + Math.abs(t.amount_cents), 0);

  const ownDraws = draws.filter(inRange);
  const transferred = sum(ownDraws);
  const fees = sum(rows.filter((t) => inRange(t) && isDrawFee(t) && t.amount_cents < 0));
  const paid = rows.filter((t) => inRange(t) && t.txn_type === 'payment' && t.amount_cents > 0).reduce((s, t) => s + t.amount_cents, 0);
  const interest = rows.filter((t) => inRange(t) && t.txn_type === 'interest' && t.amount_cents < 0).reduce((s, t) => s - t.amount_cents, 0);
  const lateFees = rows.filter((t) => inRange(t) && isLateFee(t));
  const purchases = rows.filter((t) => inRange(t) && t.txn_type === 'purchase' && t.amount_cents < 0);

  // The promo: from the latest statement that prints one for this transfer
  // (an issuer stops printing it once it ends), earliest-ending first:
  // that's the deadline that bites.
  const latest = statements.at(-1) ?? null;
  const promoKinds = (list) => (list ?? []).filter((p) => p.kind === 'balance_transfer' || p.kind === 'cash_advance');
  const promoAt = statements.findLastIndex((s) => (!since || s.period_end >= since) && promoKinds(promos[s.period_end]).length > 0);
  const promoLines = promoAt < 0 ? [] : promoKinds(promos[statements[promoAt].period_end]).sort((a, b) => a.end_date.localeCompare(b.end_date));
  const previous = promoAt > 0 ? statements[promoAt - 1] : null;
  const promo = promoLines[0] ?? null;
  const endDate = promo?.end_date ?? loan.deadline_date ?? null;
  const endSource = promo ? 'statement' : loan.deadline_date ? 'manual' : null;

  const balance = loan.effective_balance_cents ?? latest?.closing_balance_cents ?? null;
  const daysLeft = endDate ? Math.round((utc(endDate) - utc(today)) / DAY) : null;
  const monthsLeft = endDate ? paymentMonthsLeft(endDate, today) : null;

  let state;
  if (balance != null && balance <= 0 && (transferred > 0 || paid > 0)) state = 'paid_off';
  else if (!endDate) state = 'no_end_date';
  else if (daysLeft < 0) state = 'promo_ended';
  else if (daysLeft <= ENDING_SOON_DAYS) state = 'ending_soon';
  else state = 'active';

  const needed = state === 'active' || state === 'ending_soon'
    ? (monthsLeft > 0 && balance > 0 ? Math.ceil(balance / monthsLeft) : balance > 0 ? balance : 0)
    : null;

  // The pace: what the latest statement shows paid, against what's needed now.
  // A statement whose cycle began before the first draw says nothing about paying it off.
  const lastPaid = latest && since && latest.period_start > since ? latest.total_payments_cents ?? null : null;
  const pace = needed == null || lastPaid == null ? null : lastPaid >= needed ? 'on_track' : 'behind';

  const warnings = [];
  if (state === 'promo_ended' && balance > 0) {
    warnings.push({ kind: 'promo_ended', standard_apr_bps: promo?.standard_apr_bps ?? null });
  }
  if (interest > 0) warnings.push({ kind: 'interest_charged', cents: interest });
  if (lateFees.length > 0) warnings.push({ kind: 'late_fee', date: lateFees.at(-1).posted_date });
  if (purchases.length > 0) warnings.push({ kind: 'purchases_on_card', count: purchases.length, cents: sum(purchases) });
  if (promo && previous) {
    const before = (promos[previous.period_end] ?? []).find((p) => p.kind === promo.kind && (p.offer_id ?? null) === (promo.offer_id ?? null));
    if (before && before.end_date !== promo.end_date) {
      warnings.push({ kind: 'end_date_moved', from: before.end_date, to: promo.end_date });
    }
  }
  if (promo && loan.deadline_date && loan.deadline_date !== promo.end_date) {
    warnings.push({ kind: 'manual_date_differs', manual: loan.deadline_date, statement: promo.end_date });
  }
  if (latest && state !== 'paid_off' && (utc(today) - utc(latest.period_end)) / DAY > STALE_STATEMENT_DAYS) {
    warnings.push({ kind: 'statement_stale', period_end: latest.period_end });
  }
  // A draw still saved with D68's positive sign: D178's Review flag fixes it.
  const unsigned = ownDraws.filter((t) => t.amount_cents > 0);
  if (unsigned.length > 0) warnings.push({ kind: 'draw_sign', transaction_ids: unsigned.map((t) => t.id) });

  return {
    state,
    since,
    transferred_cents: transferred,
    fees_cents: fees,
    paid_cents: paid,
    interest_cents: interest,
    balance_cents: balance,
    balance_as_of: latest?.period_end ?? null,
    end_date: endDate,
    end_source: endSource,
    days_left: daysLeft,
    payment_months_left: monthsLeft,
    needed_monthly_cents: needed,
    last_statement_paid_cents: lastPaid,
    pace,
    promos: promoLines,
    draws: ownDraws.map((t) => ({ id: t.id, posted_date: t.posted_date, description: t.description, cents: Math.abs(t.amount_cents) })),
    warnings,
  };
}

const RECENT_DRAW_DAYS = 60;

/**
 * Cards that carry a balance transfer the Loans page doesn't track yet
 * (D194). A suggestion, never an automatic loan: one click creates it,
 * prefilled from the statement, or it's dismissed for good.
 *
 * A card qualifies when it has no active balance-transfer loan and
 * either its latest statement prints a transfer/cash-advance promo that
 * hasn't ended, or it has a draw in the last 60 days (a CSV statement,
 * or a promo table the reader didn't find).
 *
 * @param cards      [{ id, name, issuer, statements: [...oldest first], promos: { [period_end]: [...] }, rows: [...] }]
 * @param loans      [{ loan_type, linked_account_id, is_active }]
 * @param dismissed  keys ("<account id>:<date>") the household said aren't loans
 * @returns [{ key, account_id, account_name, issuer, draw_cents, draw_date, end_date, apr_bps, standard_apr_bps, balance_cents }]
 */
export function balanceTransferSuggestions({ cards, loans, dismissed = [], today }) {
  const tracked = new Set(loans.filter((l) => l.is_active && l.loan_type === 'balance_transfer').map((l) => l.linked_account_id));
  const out = [];
  for (const card of cards) {
    if (tracked.has(card.id)) continue;
    const latest = card.statements.at(-1) ?? null;
    const promo = (latest ? card.promos[latest.period_end] ?? [] : [])
      .filter((p) => (p.kind === 'balance_transfer' || p.kind === 'cash_advance') && p.end_date >= today)
      .sort((a, b) => a.end_date.localeCompare(b.end_date))[0] ?? null;
    const draws = card.rows.filter(isDraw).sort((a, b) => a.posted_date.localeCompare(b.posted_date));
    const recent = draws.filter((t) => (utc(today) - utc(t.posted_date)) / DAY <= RECENT_DRAW_DAYS);
    if (!promo && recent.length === 0) continue;
    // The draws that belong to this promo: the recent ones, else the latest.
    const own = recent.length > 0 ? recent : draws.slice(-1);
    const key = `${card.id}:${promo?.end_date ?? own[0].posted_date}`;
    if (dismissed.includes(key)) continue;
    out.push({
      key,
      account_id: card.id,
      account_name: card.name,
      issuer: card.issuer ?? null,
      draw_cents: own.reduce((s, t) => s + Math.abs(t.amount_cents), 0) || null,
      draw_date: own[0]?.posted_date ?? null,
      end_date: promo?.end_date ?? null,
      apr_bps: promo?.apr_bps ?? null,
      standard_apr_bps: promo?.standard_apr_bps ?? null,
      balance_cents: latest?.closing_balance_cents ?? null,
    });
  }
  return out;
}
