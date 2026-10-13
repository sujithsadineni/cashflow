/**
 * Does a statement's rows add up to what the statement itself printed?
 *
 * Every statement prints an opening and a closing balance, and the rows
 * in between have to account for the whole change. That's one check
 * that works for every bank, local or Claude parsing alike, without
 * knowing how each issuer words its totals.
 *
 * Direction: a checking or savings balance is money you have, so rows
 * (negative = out) move it the same way: closing − opening. A credit
 * card balance is money you owe, so a $50 purchase (−5000) raises it:
 * opening − closing.
 *
 * Returns { status: 'match' | 'mismatch' | 'unknown', expected_cents,
 * rows_cents, diff_cents }. 'unknown' when the statement didn't print
 * both balances — never a guess.
 */
export function statementTally({ accountType, openingCents, closingCents, rows }) {
  const rowsCents = rows.reduce((sum, r) => sum + (r.amount_cents ?? 0), 0);
  if (openingCents == null || closingCents == null) {
    return { status: 'unknown', expected_cents: null, rows_cents: rowsCents, diff_cents: null };
  }
  const expected = accountType === 'CREDIT_CARD' ? openingCents - closingCents : closingCents - openingCents;
  const diff = rowsCents - expected;
  return { status: diff === 0 ? 'match' : 'mismatch', expected_cents: expected, rows_cents: rowsCents, diff_cents: diff };
}
