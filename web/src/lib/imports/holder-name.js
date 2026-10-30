/** "ALEX J MORGAN" → "Alex J Morgan": a statement's printed holder as a name for People. */
export function holderName(printed) {
  return (printed ?? '').trim().replace(/\s+/g, ' ').toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
}

const words = (s) => (s ?? '').toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);

/**
 * The person a statement's printed holder is, or null. Banks print the same
 * person differently ("SAM N RIVERA" on one, "SAM RIVERA" on another, a middle
 * name or initial or not), so it's a match when one name's words all appear in
 * the other's, with at least two in common. A shared first name alone isn't
 * (two people can share one); nor is a shared surname.
 */
export function personForHolder(holder, people) {
  const printed = new Set(words(holder));
  if (printed.size === 0) return null;
  const hits = people.filter((p) => {
    const own = words(p.name);
    const common = own.filter((w) => printed.has(w)).length;
    return common >= 2 && (common === own.length || common === printed.size);
  });
  return hits.length === 1 ? hits[0] : null;
}
