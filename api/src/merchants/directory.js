/**
 * The merchant directory (D401): national brands a new install already knows,
 * so its first statement isn't all unnamed and uncategorized. Generated from
 * one household's history by a private script, brands only: each with the
 * words its statement lines begin with (descKeys' two- or one-word key, only
 * ever the brand itself), its website and the category its purchases get.
 * A household's own history always comes first; this fills what it can't.
 */
import { readFileSync } from 'node:fs';
import { descKeys, PREFIX } from './merchant-learning.js';
import { subBrand } from './sub-brands.js'; // one list of payment-processor prefixes
import { lookupMerchantDomain } from '../../../web/src/lib/transactions/merchant-logos.js';

const entries = JSON.parse(readFileSync(new URL('./directory.json', import.meta.url), 'utf8'));
const byKey = new Map(entries.flatMap((e) => e.keys.map((k) => [k, e])));
const byDomain = new Map(entries.map((e) => [e.domain, e]));
const byName = new Map(entries.map((e) => [e.merchant.toLowerCase(), e]));

/** The brand a statement line begins with, by its two words then its one, or null. */
export function directoryMerchant(description) {
  const product = subBrand(description);
  if (product) return product;
  const keys = descKeys(description);
  return (keys.two && byKey.get(keys.two)) || (keys.one && byKey.get(keys.one)) || null;
}

/**
 * A merchant's category from the directory, as one of the household's own:
 * the specific one when they have it ("Fast Food"), else the one every
 * install starts with ("Dining"), else null.
 */
export function directoryCategory(merchant, categoryNames, description = null) {
  const entry = directoryEntryFor(merchant, description);
  if (!entry) return null;
  return [entry.category, entry.fallback].find((c) => c && categoryNames.includes(c)) ?? null;
}

/**
 * The directory's brand for a row: by its merchant's name or website, else its line's key,
 * else a brand its line starts with ("CVS/PHARMACY #1234 …"). Null when it's none of them.
 */
export function directoryEntryFor(merchant, description = null) {
  // The line's product first: "Tesla" history still files a Supercharger visit as EV Charging.
  const product = subBrand(description);
  if (product) return product;
  if (merchant) {
    const known = byName.get(merchant.toLowerCase()) ?? byDomain.get(lookupMerchantDomain(merchant));
    if (known) return known;
  }
  if (!description) return null;
  return directoryMerchant(description) ?? byDomain.get(lookupMerchantDomain(description.replace(PREFIX, ''))) ?? null;
}
