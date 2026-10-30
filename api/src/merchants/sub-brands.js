/**
 * One brand, several things (D420): a line that names the product as well as the brand is that
 * product, with its own name and category, so a subscription isn't lost among the brand's other
 * charges ("TESLA SUBSCRIPTION" among Supercharger visits, YouTube Premium among Google's).
 */
const sub = (merchant, domain, category, fallback = category) => ({ merchant, domain, category, fallback, keys: [] });
const SUB_BRANDS = [
  [/^uber\s*\*?\s*eats\b/i, sub('Uber Eats', 'ubereats.com', 'Dining')],
  [/^uber\s*\*?\s*one\b/i, sub('Uber One', 'uber.com', 'Subscriptions')],
  [/^(google\s*\*\s*)?youtube/i, sub('YouTube', 'youtube.com', 'Subscriptions')],
  [/^tesla\b.*\bsupercharg/i, sub('Tesla Supercharger', 'tesla.com', 'EV Charging', 'Transport')],
  [/^tesla\b.*\bsubscription/i, sub('Tesla Subscription', 'tesla.com', 'Subscriptions')],
  [/^tesla\b.*\b(reservation|commerce|motors)\b/i, sub('Tesla', 'tesla.com', 'Transport')],
  [/^cinemark movie club/i, sub('Cinemark Movie Club', 'cinemark.com', 'Subscriptions', 'Entertainment')],
  [/^(amazon prime|amzn prime|prime video)\b/i, sub('Amazon Prime', 'amazon.com', 'Subscriptions')],
  [/^costco gas/i, sub('Costco Gas', 'costco.com', 'Fuel')],
  [/^apple\.com\/bill/i, sub('Apple', 'apple.com', 'Subscriptions')],
];

// Wallets and processors in front of the name (merchant-learning.js's PREFIX, kept here so the
// statement readers can use this without importing the directory).
const LEAD = /^((?:daily cash adjustment\s*·\s*)+|aplpay |apple pay |sampay |samsung pay |gpay |google pay |tst\*\s?|sq \*|sq\*|sp |pos |purchase )/i;

/** The product a line names besides its brand, as a directory entry, or null. */
export function subBrand(description) {
  const line = (description ?? '').replace(LEAD, '').trim();
  return SUB_BRANDS.find(([re]) => re.test(line))?.[1] ?? null;
}
