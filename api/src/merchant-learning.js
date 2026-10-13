/**
 * Merchant names learned from the household's own history (D188).
 *
 * The free parsers only know a short built-in list of merchants
 * (parse/local-merchants.js), so most of their rows arrive with no
 * merchant: the raw bank line shows, and no logo. But every row Claude
 * parsed, and every name a person fixed, already pairs a bank line with
 * a clean name. The same line, or one that starts the same way, gets
 * the same name:
 *
 *   exact  — the whole line, digits and punctuation stripped
 *            ("UBER *EATS 8005928996 CA" → "uber eats ca")
 *   two    — its first two words ("uber eats")
 *   one    — its first word, only when long and distinctive ("frontier")
 *
 * Each level needs real agreement in history (80% at exact, 90% and two
 * or more rows for the looser ones), so an ambiguous word like "uber"
 * (Uber and Uber Eats) is never decided by its first word alone. A row
 * is never its own evidence.
 *
 * Zelle is left out on both sides: a Zelle row's name comes from the
 * person (txn-name.js, D174), and old rows that say merchant "zelle"
 * mustn't teach that.
 *
 * Pure: history and rows in, a Map(row index → { merchant, how }) out.
 */

import { brandAtStart, brandName } from '../../web/src/merchant-logos.js'; // one brand list for logos and names

const isZelle = (s) => /zelle/i.test(s ?? '');

// Payment-processor prefixes that sit in front of the real name.
const PREFIX = /^(tst\*|sq \*|sq\*|sp \*|sp |aplpay |apple pay |paypal \*|pp\*|py \*|ctlp\*|dd \*|dd\*|bps\*|in \*|pos |pos debit |purchase )/i;

// First words that say nothing about who was paid.
const GENERIC = new Set([
  'the', 'and', 'payment', 'purchase', 'online', 'store', 'debit', 'credit', 'card', 'pos', 'recurring', 'check',
  'ach', 'web', 'transfer', 'deposit', 'zelle', 'interest', 'return', 'refund', 'mobile', 'bank', 'direct', 'des',
  'www', 'com', 'inc', 'llc', 'usa', 'amzn', 'mktp', 'mkt', 'intl', 'international', 'remote',
]);

export function descKeys(description) {
  const words = (description ?? '')
    .replace(PREFIX, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w.length >= 2 && !/\d/.test(w));
  const first = words.findIndex((w) => !GENERIC.has(w));
  const lead = first < 0 ? [] : words.slice(first);
  return {
    exact: words.join(' ') || null,
    two: lead.length >= 2 ? `${lead[0]} ${lead[1]}` : null,
    one: lead[0] && lead[0].length >= 4 ? lead[0] : null,
  };
}

const LEVELS = [
  { key: 'exact', share: 0.8, min: 1 },
  // One earlier row is enough here: two distinctive words ("paris baguette") rarely coincide.
  { key: 'two', share: 0.9, min: 1 },
  { key: 'one', share: 0.9, min: 2 },
];

/**
 * @param history rows that have a merchant: { id, description, merchant }
 * @param rows rows to name: { id?, description }
 */
/**
 * One name per brand: "Domino's" and "Domino's Pizza" are the same known
 * brand (dominos.com), so history's votes for them count together, under
 * the more common spelling. Names with no known brand, or different ones
 * ("Uber" vs "Uber Eats"), stay apart.
 */
function canonicalNames(history) {
  const counts = new Map();
  for (const h of history) counts.set(h.merchant, (counts.get(h.merchant) ?? 0) + 1);
  const byBrand = new Map();
  for (const name of counts.keys()) {
    const brand = brandAtStart(name)?.domain;
    if (brand) byBrand.set(brand, [...(byBrand.get(brand) ?? []), name]);
  }
  const canonical = new Map();
  for (const names of byBrand.values()) {
    const best = [...names].sort((a, b) => counts.get(b) - counts.get(a) || a.length - b.length)[0];
    for (const n of names) canonical.set(n, best);
  }
  return { of: (name) => canonical.get(name) ?? name, byDomain: new Map([...byBrand].map(([d, names]) => [d, canonical.get(names[0])])) };
}

export function learnMerchants(history, rows) {
  const counts = { exact: new Map(), two: new Map(), one: new Map() };
  const clean = history.filter((h) => h.merchant && !isZelle(h.merchant) && !isZelle(h.description));
  const names = canonicalNames(clean);
  const keyed = clean.map((h) => ({ ...h, merchant: names.of(h.merchant), keys: descKeys(h.description) }));
  for (const h of keyed) {
    for (const { key } of LEVELS) {
      const k = h.keys[key];
      if (!k) continue;
      const m = counts[key].get(k) ?? new Map();
      m.set(h.merchant, (m.get(h.merchant) ?? 0) + 1);
      counts[key].set(k, m);
    }
  }
  const selfOf = new Map(keyed.filter((h) => h.id != null).map((h) => [h.id, h]));

  const out = new Map();
  rows.forEach((r, i) => {
    if (isZelle(r.description)) return;
    const keys = descKeys(r.description);
    const self = r.id != null ? selfOf.get(r.id) : null;
    let disputed = false; // history saw this line under different names: don't guess at all
    for (const { key, share, min } of LEVELS) {
      const k = keys[key];
      if (!k || !counts[key].has(k)) continue;
      const tally = new Map(counts[key].get(k));
      if (self && self.keys[key] === k) tally.set(self.merchant, tally.get(self.merchant) - 1); // never its own evidence
      const total = [...tally.values()].reduce((a, b) => a + b, 0);
      if (total < min) continue;
      const [merchant, n] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
      if (n / total >= share) {
        out.set(i, { merchant, how: key });
        break;
      }
      disputed = true;
      break; // the closest level disagrees: a looser one shouldn't overrule it
    }
    // Never seen, but a brand the app knows ("BURGER KING #27813 …"): named
    // the way history spells that brand, else from the brand list itself.
    if (!out.has(i) && !disputed) {
      const brand = brandAtStart(r.description.replace(PREFIX, ''));
      if (brand) out.set(i, { merchant: names.byDomain.get(brand.domain) ?? brandName(brand.key), how: 'brand' });
    }
  });
  return out;
}
