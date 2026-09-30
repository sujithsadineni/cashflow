/**
 * How much of a loan is "cleared" — always derived from real dates
 * already on the loan, never an invented number. Migration 012
 * deliberately dropped `original_amount_cents` after checking how
 * real personal-finance apps handle a balance-transfer card: none of
 * them track a "remaining principal for this specific transfer"
 * figure, because the issuer's own statement never prints one either
 * — computing it here would be a number that exists nowhere in
 * reality, the opposite of this app's "read it off reality, don't
 * compute it" rule. Time elapsed against a real span doesn't have
 * that problem: every loan has either a term or a deadline, both real
 * dates the household actually entered.
 *
 * Two sources, tried in order:
 *   1. A fixed schedule (term_months + start_date) — the fraction of
 *      months elapsed. Same arithmetic LoanScheduleDetail's own
 *      calendar grid already uses to mark a month Paid/Remaining.
 *   2. A deadline with no fixed schedule (the usual balance-transfer
 *      shape — a 0% promo end date, no amortization) — the fraction
 *      of time elapsed since the loan was added.
 * Returns null when neither exists — nothing real to show, so the
 * caller renders no progress at all rather than guessing.
 */
export function percentClearedFor(loan) {
  if (loan.term_months != null && loan.start_date != null) {
    const [sy, sm] = loan.start_date.split('-').map(Number);
    const startIndex = sy * 12 + (sm - 1);
    const now = new Date();
    const currentIndex = now.getFullYear() * 12 + now.getMonth();
    const paid = Math.min(Math.max(currentIndex - startIndex, 0), loan.term_months);
    return Math.round((paid / loan.term_months) * 100);
  }
  if (loan.deadline_date != null && loan.created_at != null) {
    const start = new Date(loan.created_at).getTime();
    const end = new Date(loan.deadline_date).getTime();
    if (!(end > start)) return null;
    const now = Date.now();
    const elapsed = Math.min(Math.max(now - start, 0), end - start);
    return Math.round((elapsed / (end - start)) * 100);
  }
  return null;
}

/**
 * Vivid's per-loan "thoughts" (D140) — small, true, encouraging facts
 * read off the loan itself, returned as raw numbers so the component
 * formats them (and privacy mode masks the money). Pure and
 * date-injectable so loan-progress.test.js can pin today.
 *
 *   monthsLeft     server's own months_remaining for a fixed-term loan
 *   payoffDate     the loan's deadline, else start + term
 *   monthlyCents   the loan's entered monthly payment
 *   daysLeft       days until a deadline-only loan's deadline (a 0% promo)
 *   neededCents    balance ÷ whole months left before that deadline,
 *                  rounded UP — what clears it in time. Plain division,
 *                  not interest modeling (CLAUDE.md scope), and a cent
 *                  high rather than a cent short.
 *   milestone      'start' | 'quarter' | 'half' | 'stretch' from percent
 */
export function loanInsightsFor(loan, percent, today = new Date()) {
  const out = {};
  const hasSchedule = loan.term_months != null && loan.start_date != null;

  if (hasSchedule) {
    if (loan.months_remaining != null) out.monthsLeft = loan.months_remaining;
    if (loan.deadline_date) {
      out.payoffDate = loan.deadline_date;
    } else {
      const [y, m] = loan.start_date.split('-').map(Number);
      const idx = y * 12 + (m - 1) + loan.term_months;
      out.payoffDate = `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}-01`;
    }
    if (loan.monthly_payment_cents != null) out.monthlyCents = loan.monthly_payment_cents;
  } else if (loan.deadline_date) {
    const [y, m, d] = loan.deadline_date.split('-').map(Number);
    const deadline = Date.UTC(y, m - 1, d);
    const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    const days = Math.round((deadline - now) / 86_400_000);
    out.daysLeft = Math.max(days, 0);
    const monthsLeft = (y - today.getFullYear()) * 12 + (m - 1 - today.getMonth()) + (d >= today.getDate() ? 1 : 0);
    if (monthsLeft > 0 && loan.effective_balance_cents > 0) {
      out.neededCents = Math.ceil(loan.effective_balance_cents / monthsLeft);
    }
  }

  if (percent != null) {
    out.milestone = percent >= 75 ? 'stretch' : percent >= 50 ? 'half' : percent >= 25 ? 'quarter' : 'start';
  }
  return out;
}

/** Vivid's look per loan type: an emoji, and static Tailwind classes for its color. */
export const VIVID_LOAN = {
  car: { emoji: '🚗', flip: true, fill: 'bg-vivid-blue', tint: 'bg-vivid-blue/10', stroke: 'var(--color-vivid-blue)' },
  home: { emoji: '🏡', fill: 'bg-vivid-green', tint: 'bg-vivid-green/10', stroke: 'var(--color-vivid-green)' },
  credit_card: { emoji: '💳', fill: 'bg-vivid-purple', tint: 'bg-vivid-purple/10', stroke: 'var(--color-vivid-purple)' },
  balance_transfer: { emoji: '🔄', fill: 'bg-vivid-amber', tint: 'bg-vivid-amber/10', stroke: 'var(--color-vivid-amber)' },
  other: { emoji: '💼', fill: 'bg-vivid-teal', tint: 'bg-vivid-teal/10', stroke: 'var(--color-vivid-teal)' },
};

/**
 * One month of a loan's history, as the drill-down colours it. Pure, so
 * the rule is tested rather than eyeballed:
 *   ahead     — a future month on the schedule (nothing to know yet)
 *   untracked — no way to read payments for this loan (no linked card, no lender)
 *   before    — earlier than the app's first record (`recordsFrom`), so absence proves nothing
 *   started   — the loan's first month with no payment in it: nothing was due yet
 *   paid    — a payment was actually found that month
 *   due     — the current month, no payment found yet (not late — the month isn't over)
 *   none    — a past month with no payment found
 * `month` and `currentMonth` are 'YYYY-MM' strings, so they compare as text.
 */
export function loanMonthStatus({ month, paidCents, paidSource, currentMonth, recordsFrom, startMonth }) {
  if (month > currentMonth) return 'ahead';
  if (!paidSource) return 'untracked';
  if (recordsFrom && month < recordsFrom && !(paidCents > 0)) return 'before';
  if (month === startMonth && !(paidCents > 0)) return 'started';
  if (paidCents > 0) return 'paid';
  return month === currentMonth ? 'due' : 'none';
}
