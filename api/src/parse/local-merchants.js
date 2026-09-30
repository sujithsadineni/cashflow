/**
 * A small, shared "clean up a raw statement description into a human
 * merchant name" lookup for the local (no-API-call) PDF parsers.
 *
 * Deliberately modest in scope: this only needs to cover the merchants
 * that actually repeat across THIS household's own statements — it's
 * not trying to out-guess an LLM on an arbitrary, never-seen merchant.
 * A description that matches nothing here is left with merchant=null,
 * exactly like CSV rows already behave when AI enrichment is
 * unavailable (see parse/categorize.js) — the human fills it in during
 * review, and once it's a real transaction, merchant-review.js (D106)
 * cleans up near-duplicates automatically from then on anyway. Guessing
 * wrong here would be worse than leaving it blank.
 */

// [pattern, cleanName]. Order matters — first match wins, so a more
// specific pattern (a whole different merchant that happens to start
// the same way) would need to come first; none currently collide.
const MERCHANT_PATTERNS = [
  [/^WAL-?MART|^WM SUPERCENTER/i, 'Walmart'],
  [/^COSTCO WHSE|^WWW COSTCO COM/i, 'Costco'],
  [/^CINEMARK/i, 'Cinemark'],
  [/^GOOGLE\s?\*/i, 'Google'],
  [/^BP\s?#/i, 'BP'],
  [/^ALLSTATE/i, 'Allstate'],
  [/^TESLA/i, 'Tesla'],
  [/^GROUPON/i, 'Groupon'],
  [/^KOHL'?S/i, "Kohl's"],
  [/DUKE-?ENERGY/i, 'Duke Energy'],
  [/^CVS\s?\/?\s?PHARMACY/i, 'CVS'],
  [/^FOOD LION/i, 'Food Lion'],
  [/^TARGET/i, 'Target'],
  [/APPLE STORE/i, 'Apple'],
  [/DISNEY\s?PLUS/i, 'Disney+'],
];

// Descriptions with no real merchant behind them — a generic bank/
// card event, not a purchase. Matching one of these means merchant
// stays null even though the text looks like it could be a name.
const NO_MERCHANT_PATTERNS = [
  /ELECTRONIC PAYMENT/i,
  /^PAYMENT FROM /i,
  /MOBILE PAYMENT/i,
  /ONLINE PAYMENT/i,
  /^INTEREST CHARGED/i,
  /CASHBACK/i,
  /^CREDIT BALANCE REFUND/i,
];

/** The cleaned merchant name for a raw statement description, or null. */
export function cleanMerchantName(description) {
  const d = (description ?? '').trim();
  if (!d) return null;
  if (NO_MERCHANT_PATTERNS.some((p) => p.test(d))) return null;
  for (const [pattern, name] of MERCHANT_PATTERNS) {
    if (pattern.test(d)) return name;
  }
  return null;
}
