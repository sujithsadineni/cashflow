/**
 * The category icon names and the best-effort default for a category
 * name (D222). Kept apart from CategoryGlyph (category-icons.jsx), which
 * draws them, so that file only exports a component (fast refresh).
 */

export const ICON_CATALOG = [
  'home', 'bolt', 'cart', 'fork', 'car', 'fuel', 'bag', 'heart', 'shield',
  'refresh', 'star', 'tag', 'swap', 'card', 'tray-down', 'percent', 'bank',
  'undo', 'piggy', 'plane', 'film', 'briefcase', 'trend-up', 'school', 'cut',
  'wrench', 'ticket', 'document', 'gift', 'barbell', 'bed', 'phone', 'dot',
  // D373: so no two categories share an icon
  'globe', 'people', 'compare', 'battery', 'storefront', 'fast-food', 'shirt', 'check', 'cash', 'hourglass', 'leaf', 'library', 'receipt',
];

// Best-effort default so every category looks right with zero setup.
// Matched on substrings of the lowercased name; order matters (first
// match wins), most-specific patterns first.
const DEFAULT_RULES = [
  // D373: the most specific first, so related categories don't share an icon
  // (a fee isn't its transfer, Costco isn't Groceries, Clothing isn't Shopping).
  [/transfer fee/, 'receipt'],
  [/balance transfer/, 'compare'],
  [/india|international|remit|wire/, 'globe'],
  [/zelle|venmo/, 'people'],
  [/rent/, 'home'],
  [/ev charg/, 'battery'],
  [/utilit/, 'bolt'],
  [/fuel|gas/, 'fuel'],
  [/costco|warehouse|wholesale/, 'storefront'],
  [/grocer/, 'cart'],
  [/fast food|takeout/, 'fast-food'],
  [/din(e|ing)/, 'fork'],
  [/transport/, 'car'],
  [/cloth|apparel/, 'shirt'],
  [/shop/, 'bag'],
  [/health/, 'heart'],
  [/insurance/, 'shield'],
  [/subscription/, 'refresh'],
  [/annual fee/, 'star'],
  [/cashback/, 'tag'],
  [/transfer/, 'swap'],
  [/card payment/, 'card'],
  [/salary|payroll|paycheck/, 'cash'],
  [/cash deposit|deposit/, 'tray-down'],
  [/bank fee/, 'bank'],
  [/interest earned|interest income/, 'leaf'],
  [/interest/, 'percent'],
  [/loan/, 'hourglass'],
  [/\btax/, 'library'],
  [/refund/, 'undo'],
  [/invest/, 'trend-up'],
  [/saving/, 'piggy'],
  [/travel/, 'plane'],
  [/entertainment/, 'film'],
  [/consulting|fee/, 'briefcase'],
  // D262: the audit's new categories, and Education.
  [/educat|school|tuition/, 'school'],
  [/personal care|salon|hair/, 'cut'],
  [/auto|maintenance|repair/, 'wrench'],
  [/parking|toll/, 'ticket'],
  [/government|dmv|immigration/, 'document'],
  [/gift|donation|charit/, 'gift'],
  [/fitness|gym/, 'barbell'],
  [/^home\b|household|furnish/, 'bed'],
  [/phone|mobile/, 'phone'],
  [/verif/, 'check'],
];

export function defaultIconFor(name) {
  const n = (name ?? '').toLowerCase();
  for (const [pattern, key] of DEFAULT_RULES) {
    if (pattern.test(n)) return key;
  }
  return 'dot';
}
