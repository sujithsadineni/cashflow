/**
 * Pairs the two halves of a transfer between the household's own
 * accounts (D265): the same amount leaving one account and arriving in
 * another within a few days, both typed as moving money (transfer or
 * savings). Card payments aren't here: payment_match pairs those (D199).
 *
 * Only a pair that can't be anything else is linked: the money out has
 * exactly one arrival that fits, and that arrival has exactly one
 * departure that fits. Two $100 Zelles to yourself in the same week stay
 * unlinked rather than risk crossing them.
 *
 * Pure: rows in, pairs out. Tested in transfer-match.test.js.
 */

export const MOVING = new Set(['transfer', 'savings']);
export const WINDOW_DAYS = 4;
// Account-verification micro-deposits (D177) are their own pairs, not transfers.
const MIN_CENTS = 100;

const DAY = 86_400_000;
const daysApart = (a, b) => Math.abs(new Date(a) - new Date(b)) / DAY;

/**
 * @param rows { id, account_id, posted_date: 'YYYY-MM-DD', amount_cents, txn_type }
 * @returns [{ out_transaction_id, in_transaction_id }]
 */
export function matchTransfers(rows) {
  const moving = rows.filter((r) => MOVING.has(r.txn_type) && Math.abs(r.amount_cents) >= MIN_CENTS);
  const outs = moving.filter((r) => r.amount_cents < 0);
  const ins = moving.filter((r) => r.amount_cents > 0);
  const fits = (o, i) => i.amount_cents === -o.amount_cents && i.account_id !== o.account_id && daysApart(o.posted_date, i.posted_date) <= WINDOW_DAYS;

  const pairs = [];
  for (const o of outs) {
    const arrivals = ins.filter((i) => fits(o, i));
    if (arrivals.length !== 1) continue;
    const [i] = arrivals;
    if (outs.filter((other) => fits(other, i)).length !== 1) continue;
    pairs.push({ out_transaction_id: o.id, in_transaction_id: i.id });
  }
  return pairs;
}
