/**
 * A loan as a countdown (D240, the Glass design's Loans): what's left, on
 * what clock, at what monthly pace. Read off real dates and amounts the
 * loan already carries, never an invented "percent paid" (see
 * loan-progress.js on why no issuer prints one for a transfer).
 *
 * Three shapes:
 *   bt        a balance transfer: days left at the promo rate, the
 *             statement-read end date, the server's needed monthly pace
 *   schedule  a fixed-term loan: payments left of the term, its payment
 *   deadline  a loan with only a payoff date: days left, and what a month
 *             it takes to clear (balance ÷ whole months left, rounded up)
 */

const toDate = (iso) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
};
const toISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / 864e5);
const monthsBetween = (a, b) => {
  const x = toDate(a);
  const y = toDate(b);
  return (y.getFullYear() - x.getFullYear()) * 12 + y.getMonth() - x.getMonth();
};
const addMonths = (iso, n) => {
  const d = toDate(iso);
  return toISO(new Date(d.getFullYear(), d.getMonth() + n, Math.min(d.getDate(), 28)));
};

// A 0% end within about six months is the one to act on.
const URGENT_DAYS = 183;

export function countdownFor(loan, today = toISO(new Date())) {
  const balance = Number(loan.bt?.balance_cents ?? loan.effective_balance_cents ?? loan.current_balance_cents ?? 0);
  let c = null;

  if (loan.bt?.end_date) {
    const bt = loan.bt;
    const start = bt.since ?? loan.start_date ?? today;
    const promo = bt.promos?.[0];
    c = {
      kind: 'bt',
      start,
      end: bt.end_date,
      count: Math.max(0, bt.days_left ?? daysBetween(today, bt.end_date)),
      monthsLeft: bt.payment_months_left ?? Math.max(1, monthsBetween(today, bt.end_date)),
      perMonthCents: bt.needed_monthly_cents ?? null,
      startBalanceCents: bt.transferred_cents > 0 ? bt.transferred_cents + (bt.fees_cents ?? 0) : null,
      promoAprBps: promo?.apr_bps ?? 0,
      afterAprBps: promo?.standard_apr_bps ?? null,
      ended: bt.state === 'promo_ended' || bt.state === 'paid_off',
    };
  } else if (loan.term_months != null && loan.start_date) {
    const end = loan.deadline_date ?? addMonths(loan.start_date, loan.term_months);
    const made = Math.min(Math.max(monthsBetween(loan.start_date, today), 0), loan.term_months);
    const left = loan.months_remaining ?? loan.term_months - made;
    c = {
      kind: 'schedule',
      start: loan.start_date,
      end,
      count: Math.max(0, left),
      monthsLeft: Math.max(0, left),
      made: loan.term_months - Math.max(0, left),
      term: loan.term_months,
      perMonthCents: loan.monthly_payment_cents ?? null,
      startBalanceCents: null,
      ended: left <= 0,
    };
  } else if (loan.deadline_date) {
    const start = loan.start_date ?? (loan.created_at ? loan.created_at.slice(0, 10) : today);
    const monthsLeft = Math.max(1, monthsBetween(today, loan.deadline_date));
    c = {
      kind: 'deadline',
      start,
      end: loan.deadline_date,
      count: Math.max(0, daysBetween(today, loan.deadline_date)),
      monthsLeft,
      perMonthCents: Math.ceil(balance / monthsLeft),
      startBalanceCents: null,
      ended: daysBetween(today, loan.deadline_date) < 0,
    };
  }
  if (!c) return null;

  const span = Math.max(1, daysBetween(c.start, c.end));
  c.balanceCents = balance;
  c.timeShare = Math.min(1, Math.max(0, daysBetween(c.start, today) / span));
  c.urgent = c.kind !== 'schedule' && !c.ended && c.count <= URGENT_DAYS;
  c.unit = c.kind === 'schedule' ? (c.count === 1 ? 'payment left' : 'payments left') : c.kind === 'bt' ? `days at ${(c.promoAprBps / 100).toFixed(0)}%` : 'days left';
  return c;
}

/** The loan whose promo or payoff date comes soonest, for the banner up top. */
export function nextDeadline(loans, today) {
  return loans
    .map((loan) => ({ loan, c: countdownFor(loan, today) }))
    .filter(({ c }) => c && c.kind !== 'schedule' && !c.ended && c.count > 0)
    .sort((a, b) => a.c.count - b.c.count)[0] ?? null;
}

/** Month by month from today at the monthly pace, down to zero or the end date. */
export function projection(c, today) {
  if (!c.perMonthCents) return [];
  // This month's payment is the first, so after month k the balance has
  // had k + 1 payments, and n payments reach zero n − 1 months from now.
  const points = [{ date: today, cents: c.balanceCents }];
  for (let k = 1; k < c.monthsLeft; k++) {
    const cents = Math.max(0, c.balanceCents - c.perMonthCents * (k + 1));
    points.push({ date: addMonths(today, k), cents });
    if (cents === 0) break;
  }
  return points;
}

export { daysBetween as countdownDaysBetween };
