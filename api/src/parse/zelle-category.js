/**
 * Deterministic category for any Zelle transaction — sent or
 * received, whatever its txn_type. Zelle is a transfer mechanism, not
 * a spending category the AI, the local parser, or the historical-
 * category fallback (historical-category.js) should ever have to
 * guess at (a Zelle payment sent "for dinner" is not thereby a Dining
 * expense) — every Zelle line gets this category regardless of what
 * it's "for", the same way Bilt's rent mechanic (bilt-rent.js) always
 * resolves to Rent regardless of how the AI classified it.
 *
 * Only the category — txn_type stays whatever the parser already
 * decided (deposit/purchase/transfer), since that already reflects
 * the real direction of money and this app's spend totals rely on it.
 * Recategorizing every Zelle line is safe (category is presentation-
 * layer truth); reclassifying txn_type too would risk silently
 * changing what counts as "spent," which nobody asked for here.
 */
export function zelleCategoryFor(description) {
  return /zelle/i.test(description ?? '') ? 'Zelle' : null;
}
