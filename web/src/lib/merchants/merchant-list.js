/**
 * Settings → Merchants (D300): the rules behind the list and the icon
 * picker, kept out of the components so they can be tested. Pure.
 *
 * A logo has one source, in the order the avatar shows them
 * (MerchantAvatar.jsx): one uploaded, a website's (each chosen by the
 * household), then the logo the app knows for a chain, else none (its
 * category's icon). Emoji are gone (D301).
 */

import { lookupMerchantDomain } from '../transactions/merchant-logos.js';

/** Where a merchant's logo comes from: photo (uploaded), website (chosen), logo (built in), or none. */
export function iconSource(merchant, icon) {
  if (icon?.image_path) return { kind: 'photo' };
  if (icon?.domain) return { kind: 'website', domain: icon.domain };
  const known = lookupMerchantDomain(merchant);
  return known ? { kind: 'logo', domain: known } : { kind: 'none' };
}

/** The list's filters: what's left to do first. */
export const FILTERS = [
  { value: 'needs', label: 'Needs a Logo' },
  { value: 'chosen', label: 'Custom' },
  { value: 'all', label: 'All' },
];

const isChosen = (kind) => kind === 'photo' || kind === 'website';

/** How many merchants each filter holds. */
export function filterCounts(merchants, icons) {
  const out = { needs: 0, chosen: 0, all: merchants.length };
  for (const m of merchants) {
    const { kind } = iconSource(m.merchant, icons[m.merchant]);
    if (kind === 'none') out.needs += 1;
    else if (isChosen(kind)) out.chosen += 1;
  }
  return out;
}

/**
 * The merchants a filter and a search leave, most-used first, so the ones
 * that show up most get their icon first and the one-offs sink. Search
 * matches the name or any bank line it's recognised by.
 */
export function listMerchants(merchants, icons, { filter = 'needs', search = '' } = {}) {
  const needle = search.trim().toLowerCase();
  return merchants
    .filter((m) => {
      const { kind } = iconSource(m.merchant, icons[m.merchant]);
      if (filter === 'needs' && kind !== 'none') return false;
      if (filter === 'chosen' && !isChosen(kind)) return false;
      if (!needle) return true;
      return m.merchant.toLowerCase().includes(needle) || (m.aliases ?? []).some((a) => a.line.toLowerCase().includes(needle));
    })
    .sort((a, b) => b.transaction_count - a.transaction_count || a.merchant.localeCompare(b.merchant));
}

/**
 * What renaming does, as it's typed, by the API's own rule (merchant-names.js):
 * a name that exists (any case) merges into it, under its spelling.
 *   { error } | { to, merge: false } | { to, merge: true, intoCount }
 */
export function renamePreview(from, typed, merchants) {
  const name = typed.trim().replace(/\s+/g, ' ');
  if (!name) return { error: 'Give it a name' };
  if (name.length > 80) return { error: 'At most 80 characters' };
  if (name === from) return { same: true };
  const match = merchants.find((m) => m.merchant !== from && m.merchant.toLowerCase() === name.toLowerCase());
  return match ? { to: match.merchant, merge: true, intoCount: match.transaction_count } : { to: name, merge: false };
}

/** Where its picture comes from, in words, for the detail. */
export function sourceWords(source) {
  return {
    photo: 'Your uploaded logo',
    website: source.domain,
    logo: `Built in · ${source.domain}`,
    none: 'Its category’s icon',
  }[source.kind];
}
