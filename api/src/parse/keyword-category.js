/**
 * A category from plain words in the bank line (D188), for a row nothing
 * else could categorise: no history, no rule, a place never seen. "HABIBI
 * GRILL", "BIRYANI POT", "WOK N ROLL" are restaurants without anyone having
 * to say so. Only ever fills a blank, only for purchases, and only names a
 * category the household actually has. It's a suggestion like any other:
 * the row still goes through Review.
 */

const RULES = [
  ['Dining', /\b(restaur\w*|cafe|grill|kitchen|pizza\w*|tacos?|taqueria|burgers?|biryani|bakery|bagels?|coffee|espresso|tea|boba|sushi|ramen|pho|thai|indian|chinese|mexican|wok|eats|diner|bbq|barbecue|soft serve|ice cream|creamery|gelato|deli|bistro|curry|dosa|wings|chicken|noodles?|dumplings?|donuts?|doughnuts?|cantina|brewing|brewery|steakhouse|smokehouse)\b/i],
  ['Groceries', /\b(grocery|groceries|supermarket|market|fresh meat|halal meat|produce|farmers)\b/i],
  ['Fuel', /\b(fuel|gas station|petro\w*)\b/i],
  ['Transport', /\b(parking|parkmobile|toll|transit|taxi)\b/i],
];

/** @returns a category name from `categoryNames`, or null. */
export function keywordCategory(description, categoryNames) {
  for (const [category, re] of RULES) {
    if (re.test(description ?? '') && categoryNames.includes(category)) return category;
  }
  return null;
}
