/**
 * The rules behind editing a merchant (D300): its website, for a logo, and
 * a new name, which becomes a merge when it's a merchant that already
 * exists. Pure: tested in merchant-names.test.js.
 */

const HOSTNAME = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;

/**
 * A typed website as the hostname its favicon is read from:
 * "https://www.Bakery.com/menu" → "bakery.com". Null when it isn't one.
 */
export function cleanDomain(input) {
  if (typeof input !== 'string') return null;
  const host = input.trim().toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '')
    .replace(/^www\./, '')
    .replace(/\.$/, '');
  return HOSTNAME.test(host) && host.length <= 253 ? host : null;
}

/** A merchant name as it's stored: trimmed, single spaces. */
export const cleanName = (name) => (typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '');

/**
 * What renaming `from` to `to` does, given every merchant name on file:
 *   { error }                       nothing to do, or no name
 *   { to, merge: true }            `to` already exists (any case): the two become one, under its spelling
 *   { to, merge: false }           a new name (a change of case is a rename too)
 */
export function renameTarget(from, to, existing) {
  const name = cleanName(to);
  if (!name) return { error: 'Give it a name' };
  if (name.length > 80) return { error: 'At most 80 characters' };
  if (name === from) return { error: 'That’s its name already' };
  const match = existing.find((m) => m !== from && m.toLowerCase() === name.toLowerCase());
  return match ? { to: match, merge: true } : { to: name, merge: false };
}
