/**
 * Installment plans a card statement printed (D356): which are still being
 * paid, one line for the back of the card, and the loan a plan becomes when
 * the household adds it to Loans (by hand, one click: loan tracking is a
 * balance and a deadline, no amortisation). Pure; tested in plans.test.js.
 */

/** The plans with principal still to pay. */
export const activePlans = (plans) => (plans?.items ?? []).filter((p) => p.remaining_cents > 0);

/** "Plan It: $800.00 left on 1 plan · $404.80 due"; null when none is active. `money` formats cents. */
export function planLine(plans, money) {
  const active = activePlans(plans);
  if (active.length === 0) return null;
  const left = active.reduce((n, p) => n + p.remaining_cents, 0);
  const due = plans.payment_due_cents ?? active.reduce((n, p) => n + p.payment_due_cents, 0);
  return `Plan It: ${money(left)} left on ${active.length} ${active.length === 1 ? 'plan' : 'plans'} · ${money(due)} due`;
}

const addMonths = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1 + n, d));
  return date.toISOString().slice(0, 10);
};

/** The loan a plan becomes (POST /api/loans): its own figures, its last payment as the deadline. */
export function loanFromPlan(plan, account) {
  return {
    name: `Plan It · ${plan.description}`.slice(0, 80),
    lender: account.issuer ?? '',
    loan_type: 'credit_card',
    linked_account_id: account.id,
    term_months: plan.months,
    start_date: plan.created_on,
    monthly_payment_cents: plan.monthly_principal_cents + plan.monthly_fee_cents,
    current_balance_cents: plan.remaining_cents,
    deadline_date: addMonths(plan.created_on, plan.months),
  };
}
