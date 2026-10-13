/**
 * The app's one definition of spending and income. The Overview cards
 * (routes/summary.js), the Activity chart (routes/transactions.js), each
 * card's YTD spend on the Cards page (routes/accounts.js) and recurring-bill
 * detection (routes/recurring.js) all use it, in SQL or JS.
 *
 * Spending is money out, except moving money around — card payments,
 * transfers, savings — plus refunds, which reduce it. Income is a deposit.
 *
 * History: the rule used to be hand-copied into each query, and copies
 * drifted. The Recurring calendar counted every negative row, so a card
 * bill counted twice (the purchase and its payment) — D165. The Cards
 * page did the same, and the Activity chart dropped refunds and called
 * cashback and interest "earned" — D168. One rule, two forms, side by side.
 */

const NOT_SPEND = ['payment', 'transfer', 'savings'];
const NOT_SPEND_SET = new Set(NOT_SPEND);

export const countsAsSpend = ({ amount_cents, txn_type }) =>
  (amount_cents < 0 && !NOT_SPEND_SET.has(txn_type ?? '')) || txn_type === 'refund';

/** Net spend of some rows, as a negative number of cents — never positive, like the SQL's LEAST(…, 0). */
export const spendCents = (rows) => Math.min(rows.filter(countsAsSpend).reduce((sum, t) => sum + t.amount_cents, 0), 0);

/**
 * The same rule as a SQL condition, for a WHERE or FILTER clause. `alias`
 * is the transaction table's alias ('t'), or '' when unaliased. Wrap the
 * sum in LEAST(…, 0) wherever a total must never come out positive.
 * Only fixed strings go in — no user input reaches this.
 */
export function spendSql(alias = 't') {
  const c = alias ? `${alias}.` : '';
  const list = NOT_SPEND.map((t) => `'${t}'`).join(',');
  return `((${c}amount_cents < 0 AND COALESCE(${c}txn_type,'') NOT IN (${list})) OR ${c}txn_type = 'refund')`;
}

/** Income, as on the Overview's Income card: deposits only (not cashback, interest or refunds). */
export const incomeSql = (alias = 't') => `${alias ? `${alias}.` : ''}txn_type = 'deposit'`;
