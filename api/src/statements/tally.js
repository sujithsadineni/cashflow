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

/**
 * Does an approved statement add up on what's actually in the ledger (D274)?
 * statementTally counts staged rows too, so rows still waiting in an import
 * (a held duplicate, say) made a statement look whole while the ledger was
 * short. This one counts only saved transactions, and says what's waiting.
 *
 * @returns { state, diff_cents, pending_count, pending_cents }, state one of:
 *   match       adds up to the cent
 *   off         doesn't: diff_cents is saved rows minus what the balances say
 *   unread      an opening or closing balance wasn't read, so it can't be checked
 *   no_summary  the import has no statement summary (period, balances) at all
 */
export function ledgerTally({ accountType, hasSummary, openingCents, closingCents, savedCents, pendingCount = 0, pendingCents = 0 }) {
  const waiting = { pending_count: pendingCount, pending_cents: pendingCents };
  if (!hasSummary) return { state: 'no_summary', diff_cents: null, ...waiting };
  const t = statementTally({ accountType, openingCents, closingCents, rows: [{ amount_cents: savedCents }] });
  if (t.status === 'unknown') return { state: 'unread', diff_cents: null, ...waiting };
  return { state: t.status === 'match' ? 'match' : 'off', diff_cents: t.diff_cents, ...waiting };
}
