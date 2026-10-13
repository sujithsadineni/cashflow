/**
 * The category icon names and the best-effort default for a category
 * name (D222). Kept apart from CategoryGlyph (category-icons.jsx), which
 * draws them, so that file only exports a component (fast refresh).
 */

export const ICON_CATALOG = [
  'home', 'bolt', 'cart', 'fork', 'car', 'fuel', 'bag', 'heart', 'shield',
  'refresh', 'star', 'tag', 'swap', 'card', 'tray-down', 'percent', 'bank',
  'undo', 'piggy', 'plane', 'film', 'briefcase', 'trend-up', 'dot',
];

// Best-effort default so every category looks right with zero setup.
// Matched on substrings of the lowercased name; order matters (first
// match wins), most-specific patterns first.
const DEFAULT_RULES = [
  [/rent/, 'home'],
  [/utilit|ev charg/, 'bolt'],
  [/grocer|costco/, 'cart'],
  [/din(e|ing)/, 'fork'],
  [/transport/, 'car'],
  [/fuel|gas/, 'fuel'],
  [/shop/, 'bag'],
  [/health/, 'heart'],
  [/insurance/, 'shield'],
  [/subscription/, 'refresh'],
  [/annual fee/, 'star'],
  [/cashback/, 'tag'],
  [/transfer/, 'swap'],
  [/card payment/, 'card'],
  [/salary|cash deposit|deposit/, 'tray-down'],
  [/interest/, 'percent'],
  [/loan/, 'bank'],
  [/zelle/, 'swap'],
  [/refund/, 'undo'],
  [/invest/, 'trend-up'],
  [/saving/, 'piggy'],
  [/travel/, 'plane'],
  [/entertainment/, 'film'],
  [/consulting|fee/, 'briefcase'],
];

export function defaultIconFor(name) {
  const n = (name ?? '').toLowerCase();
  for (const [pattern, key] of DEFAULT_RULES) {
    if (pattern.test(n)) return key;
  }
  return 'dot';
}
