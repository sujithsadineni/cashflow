/**
 * A scheduled loan's payments, as found (D299): which due dates were paid,
 * which were missed, and which simply aren't on file yet. Pure: facts in,
 * status out. Tested in loan-payments.test.js.
 *
 * A loan with a monthly payment, a term and a start date is due on the
 * start's day each month. Payments are the money out found for its lender
 * (routes/loans.js finds them, on any account). They settle due dates in
 * order, by amount: what's been paid ÷ the monthly payment is the number of
 * payments made, so a late payment still counts, two in one month count
 * twice, and a short one doesn't count until it's made up.
 *
 * A due date the household's records don't reach yet isn't missed: the
 * paying account's history (its latest statement or row) has to cover the
 * due date plus a few days' grace (payments post a day or two late around
 * weekends) before an unpaid one is called missed. Until then it's "not on
 * file yet", which is what the Loans page says instead of guessing.
 */

const GRACE_DAYS = 5;

const toUTC = (iso) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const fromUTC = (t) => new Date(t).toISOString().slice(0, 10);
const addDays = (iso, n) => fromUTC(toUTC(iso) + n * 86_400_000);

/** The k-th due date from the start: the start's day in each later month, the month's last day when it's shorter. */
export function dueDate(start, k) {
  const [y, m, d] = start.slice(0, 10).split('-').map(Number);
  const last = new Date(Date.UTC(y, m - 1 + k + 1, 0)).getUTCDate();
  return fromUTC(Date.UTC(y, m - 1 + k, Math.min(d, last)));
}

/**
 * @param loan       { start_date, term_months, monthly_payment_cents }
 * @param payments   money out found for it: [{ posted_date, cents (positive), account_id }], any order
 * @param coveredThrough  'YYYY-MM-DD': how far the paying account's records reach, or null for none
 * @param today      'YYYY-MM-DD'
 * @returns null without a full schedule; else {
 *   due_day, made, paid_cents, missed, behind_since, covered_through,
 *   last_payment: { posted_date, cents, account_id } | null,
 *   next: { date, status: 'not_on_file' | 'upcoming' } | null,
 *   dues: [{ date, status: 'paid' | 'missed' | 'not_on_file' | 'upcoming', paid_on }]   up to the next one ahead
 * }
 */
export function loanPaymentStatus({ loan, payments = [], coveredThrough = null, today }) {
  const { start_date: start, term_months: term, monthly_payment_cents: monthly } = loan;
  if (!start || !term || !monthly) return null;

  const sorted = [...payments].sort((a, b) => a.posted_date.localeCompare(b.posted_date));
  const paidCents = sorted.reduce((s, p) => s + p.cents, 0);
  const made = Math.min(term, Math.floor(paidCents / monthly));

  // The date each payment completed, settling due dates in order.
  const settledOn = [];
  let running = 0;
  for (const p of sorted) {
    running += p.cents;
    while (settledOn.length < Math.floor(running / monthly) && settledOn.length < term) settledOn.push(p.posted_date);
  }

  const dues = [];
  let missed = 0;
  let next = null;
  for (let k = 0; k < term; k++) {
    const date = dueDate(start, k);
    let status;
    if (k < made) status = 'paid';
    else if (coveredThrough && addDays(date, GRACE_DAYS) <= coveredThrough) status = 'missed';
    else if (date <= today) status = 'not_on_file';
    else status = 'upcoming';
    if (status === 'missed') missed += 1;
    dues.push({ date, status, paid_on: settledOn[k] ?? null });
    if (status === 'not_on_file' || status === 'upcoming') {
      next ??= { date, status };
      if (status === 'upcoming') break;
    }
  }

  // When the household fell behind and hasn't caught up: the first due date
  // of the latest stretch where what was paid by it (with grace) fell short.
  // Payments settle the oldest due first, so the one left unpaid is the
  // latest; "behind since March" is what a person (and a lender) would say.
  const paidBy = (iso) => sorted.reduce((s, p) => s + (p.posted_date <= iso ? p.cents : 0), 0);
  let behindSince = null;
  if (missed > 0) {
    for (let k = 0; k < dues.length && dues[k].date <= today; k++) {
      const cutoff = addDays(dues[k].date, GRACE_DAYS);
      if (coveredThrough && cutoff > coveredThrough) break;
      const short = paidBy(cutoff) < (k + 1) * monthly;
      behindSince = short ? behindSince ?? dues[k].date : null;
    }
  }

  return {
    due_day: Number(start.slice(8, 10)),
    made,
    paid_cents: paidCents,
    missed,
    behind_since: behindSince,
    covered_through: coveredThrough,
    last_payment: sorted.at(-1) ?? null,
    next,
    dues,
  };
}
