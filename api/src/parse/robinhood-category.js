/**
 * Deterministic classification for Robinhood transactions on a
 * checking account — money genuinely moving to the brokerage, not new
 * spend, and worth its own category distinct from the household's
 * existing "Savings" bucket.
 *
 * Two confirmed real patterns (checked against real statement data,
 * not guessed):
 *   - "Robinhood Debits 531595957 Web ID: 5326394001" (Chase/BofA
 *     local parsers) and its checking-statement twin "ROBINHOOD
 *     DES:DEBITS ID:XXXXXXXXX ... CO ID:5326394001" — same company ID
 *     either way, small/varying amounts, genuine trading activity.
 *   - "Online Realtime Payment To Robinhood Securities
 *     Transaction#:... Reference#:..." — a wire-style transfer
 *     straight into the brokerage account.
 *
 * Deliberately does NOT match "Robinhood Money ... Payment" — a
 * different, larger, more periodic transfer this household's own
 * already-approved data already classifies "Savings", a real
 * distinction this rule should not collapse. A Robinhood Gold Card
 * purchase (the "GOLD ANNUAL SUBSCRIPTIO" line) never repeats
 * "Robinhood" in its own description, so it's naturally unaffected —
 * card subscription fees and brokerage transfers stay segregated
 * without needing an explicit exclusion for either.
 */

const PATTERNS = [/ROBINHOOD.*DEBITS/i, /ROBINHOOD SECURITIES/i];

/** { category, txn_type } for a description, or null if this rule doesn't apply. */
export function robinhoodCategoryFor(description) {
  const d = (description ?? '').trim();
  if (!PATTERNS.some((p) => p.test(d))) return null;
  return { category: 'Investment', txn_type: 'transfer' };
}
