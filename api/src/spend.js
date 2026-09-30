/**
 * What counts as spending, for code that works on transaction rows in JS
 * rather than in SQL. It must stay identical to the SQL rule in
 * routes/summary.js (the Overview's "Spent"): money out, except moving
 * money around — card payments, transfers, savings — plus refunds, which
 * reduce it. The Recurring calendar once summed every negative row, so a
 * card bill counted twice (the purchase and its payment) and its "Spent
 * this month" ran at more than double the Overview's figure.
 */

const NOT_SPEND = new Set(['payment', 'transfer', 'savings']);

export const countsAsSpend = ({ amount_cents, txn_type }) =>
  (amount_cents < 0 && !NOT_SPEND.has(txn_type ?? '')) || txn_type === 'refund';

/** Net spend of some rows, as a negative number of cents — never positive, like summary.js's LEAST(…, 0). */
export const spendCents = (rows) => Math.min(rows.filter(countsAsSpend).reduce((sum, t) => sum + t.amount_cents, 0), 0);
