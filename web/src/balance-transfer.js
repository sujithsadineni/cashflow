/**
 * Words for a balance transfer's status (D195). The API works out the
 * facts (api/src/balance-transfer.js, attached to a loan as `bt`); this
 * only turns them into sentences, so both designs and every screen say
 * the same thing. Pure: tested in balance-transfer.test.js. Money stays
 * in cents here — the caller's formatMoney does the dividing.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2027-04-05' -> 'Apr 5, 2027' */
export function longDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** 2974 -> '29.74%', 0 -> '0%' */
export const aprText = (bps) => (bps % 100 === 0 ? `${Math.floor(bps / 100)}%` : `${Math.floor(bps / 100)}.${String(bps % 100).padStart(2, '0')}%`);

/**
 * A loan with its statement-read dates in place of the hand-typed ones,
 * for the helpers that already read `deadline_date` / `created_at`
 * (percentClearedFor, loanInsightsFor): the promo end the issuer printed,
 * counted from the day of the transfer.
 */
export function withStatementDates(loan) {
  if (!loan.bt) return loan;
  return { ...loan, deadline_date: loan.bt.end_date ?? loan.deadline_date, created_at: loan.bt.since ?? loan.created_at };
}

/**
 * The one-line status. `tone` is 'spend' when money is at risk, else 'muted'.
 * @returns { text, tone }
 */
export function statusLine(bt) {
  const promoRate = bt.promos[0] ? aprText(bt.promos[0].apr_bps) : '0%';
  switch (bt.state) {
    case 'paid_off':
      return { text: 'Paid off', tone: 'earn' };
    case 'promo_ended': {
      const after = bt.promos[0]?.standard_apr_bps;
      return { text: `${promoRate} ended ${longDate(bt.end_date)}${after != null ? ` · now ${aprText(after)}` : ''}`, tone: 'spend' };
    }
    case 'ending_soon':
      return { text: `${promoRate} ends in ${bt.days_left} day${bt.days_left === 1 ? '' : 's'} · ${longDate(bt.end_date)}`, tone: 'spend' };
    case 'active':
      return { text: `${promoRate} until ${longDate(bt.end_date)} · ${bt.days_left} days`, tone: 'muted' };
    default:
      return { text: 'No promo end date yet — it’s read from the card’s next statement', tone: 'muted' };
  }
}

/**
 * What it takes to clear it in time, and how the last statement compares.
 * null when there's nothing to pace (paid off, ended, no end date).
 * @returns { needed_cents, months, by, pace, paid_cents } | null
 */
export function paceOf(bt) {
  if (bt.needed_monthly_cents == null) return null;
  return {
    needed_cents: bt.needed_monthly_cents,
    months: bt.payment_months_left,
    by: bt.end_date,
    pace: bt.pace,
    paid_cents: bt.last_statement_paid_cents,
  };
}

/**
 * Each warning as a sentence. Money appears as { cents } parts so the
 * caller can format (and privacy-mask) it.
 * @returns [{ kind, tone, parts: [string | { cents }] }]
 */
export function warningSentences(bt) {
  return bt.warnings.map((w) => {
    switch (w.kind) {
      case 'promo_ended':
        return { kind: w.kind, tone: 'spend', parts: [`The promo is over. What’s left is charged ${w.standard_apr_bps != null ? aprText(w.standard_apr_bps) : 'the card’s standard rate'} from now on.`] };
      case 'interest_charged':
        return { kind: w.kind, tone: 'spend', parts: ['Interest of ', { cents: w.cents }, ' was charged since the transfer. Check whether it’s on purchases or the promo was lost.'] };
      case 'late_fee':
        return { kind: w.kind, tone: 'spend', parts: [`A late fee posted on ${longDate(w.date)}. A late payment can end a 0% rate early.`] };
      case 'purchases_on_card':
        return { kind: w.kind, tone: 'muted', parts: [`${w.count} purchase${w.count === 1 ? '' : 's'} (`, { cents: w.cents }, ') on this card since the transfer. Payments go to higher-rate balances first, and on many cards purchases lose their interest-free grace period while a promo balance is carried.'] };
      case 'end_date_moved':
        return { kind: w.kind, tone: 'spend', parts: [`The promo end date moved from ${longDate(w.from)} to ${longDate(w.to)} on the latest statement.`] };
      case 'manual_date_differs':
        return { kind: w.kind, tone: 'muted', parts: [`The statement says ${longDate(w.statement)}; the date typed in is ${longDate(w.manual)}. The statement’s is used.`] };
      case 'statement_stale':
        return { kind: w.kind, tone: 'muted', parts: [`The latest statement is from ${longDate(w.period_end)}. Upload the newer ones to keep this current.`] };
      case 'draw_sign':
        return { kind: w.kind, tone: 'spend', parts: ['The transfer is still saved as money in, not new debt on the card. Approve its sign fix on the Review page.'] };
      default:
        return { kind: w.kind, tone: 'muted', parts: [w.kind] };
    }
  });
}
