/**
 * "Where it's going" families (D373): a handful of groups the categories
 * fall into, so related spending reads together — Food in oranges, Home &
 * bills in blues. Matched on the category's name, first rule wins, like
 * defaultIconFor (category-icon-keys.js): a best-effort default that needs
 * no setup and keeps no household's own category names in the code. A
 * name nothing matches lands in "Fees & other".
 *
 * Each family owns a hue range for its categories' colours
 * (category-palette.js). Green (about 120–165°) is in no range: in this
 * app green means money in.
 */
export const FAMILIES = [
  { key: 'sent', name: 'Sent & settled', icon: 'swap', hues: [272, 324], chroma: [0.12, 0.2], match: /transfer|zelle|venmo|remit|wire|consult|gift|donation|charit/ },
  { key: 'life', name: 'Shopping & life', icon: 'bag', hues: [330, 380], chroma: [0.12, 0.2], match: /shop|cloth|apparel|entertain|travel|fitness|gym|personal care|salon|hair|health|medical|pharma|beauty|hobby|book|game|pet/ },
  { key: 'food', name: 'Food', icon: 'fork', hues: [16, 58], chroma: [0.12, 0.19], match: /grocer|costco|din(e|ing)|restaurant|fast food|food|coffee|cafe|bakery|takeout/ },
  { key: 'move', name: 'Getting around', icon: 'car', hues: [62, 98], chroma: [0.11, 0.16], lightness: [0.66, 0.82], match: /transport|fuel|\bgas\b|ev charg|parking|toll|auto|\bcar\b|ride|transit/ },
  { key: 'home', name: 'Home & bills', icon: 'home', hues: [206, 268], chroma: [0.1, 0.18], match: /rent|mortgage|utilit|phone|mobile|internet|insurance|subscription|home|household|government|\btax|educat|school|tuition/ },
  { key: 'other', name: 'Fees & other', icon: 'percent', hues: [180, 204], chroma: [0.06, 0.12], match: null },
];

const OTHER = FAMILIES[FAMILIES.length - 1];

/** The family a category name belongs to. */
export function familyOf(name) {
  const n = (name ?? '').toLowerCase();
  // A fee is a fee, whatever it's on: a balance transfer's fee isn't money sent. (A consulting fee is a payment.)
  if (/\bfees?\b/.test(n) && !/consult/.test(n)) return OTHER;
  return FAMILIES.find((f) => f.match?.test(n)) ?? OTHER;
}
