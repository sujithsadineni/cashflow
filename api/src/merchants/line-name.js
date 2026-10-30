/**
 * A likely merchant name read off a statement line nobody named (D367): for
 * lines the readers left blank on purpose (parse/local-merchants.js: guessing
 * wrong is worse than blank). This never names a row by itself; the name goes
 * to Review → Merchants as a suggestion and a person approves it.
 *
 *   "AplPay HARLOWS 101 CENTRAL"             → "Harlows"
 *   "TST* SWEETS HUT - FAIRVIEW FAIRVIEW GA" → "Sweets Hut"
 *   "MOHAN'S DOSA HOUSE JERSEY CITY NJUSA"   → "Mohan's Dosa House"
 *
 * The city a line ends with is learned from the household's own lines: a word
 * (or two) that sits right before a state code on several lines is a city.
 * Pure; tested in line-name.test.js.
 */

const PREFIXES = /^(aplpay|purchase returns -|fraud credit -|tst\*|sq \*|sp|flt\*|ctlp\*|py \*|dd \*|in \*)\s*/i;
// Lines that name no merchant: returns, reversals, fees and credits with a code.
const GENERIC = /^(merchandise return|pending credit|reversal transaction|annual fee|credit adjustment|credit for|monthly service charge|store\b|[a-z0-9]{4}:\d+)/i;
// A state code as a line prints it: TX, NC, TXUSA, "GA USA"; and a few foreign region codes.
const STATE = /^(?:[A-Z]{2}(?:USA)?|USA|TEL|AND)$/;

const words = (s) => s.split(/\s+/).filter(Boolean);

/** The cities in a set of lines: the one or two words before a trailing state code, seen at least twice. */
export function learnCities(descriptions) {
  const count = new Map();
  for (const d of descriptions) {
    const w = words((d ?? '').replace(/\s+USA$/, ''));
    if (w.length < 3 || !STATE.test(w.at(-1))) continue;
    for (const k of [w.at(-2).toLowerCase(), `${w.at(-3)} ${w.at(-2)}`.toLowerCase()]) count.set(k, (count.get(k) ?? 0) + 1);
  }
  return new Set([...count].filter(([, n]) => n >= 2).map(([k]) => k));
}

// Each word printed in capitals reads as a name ("DOSA HOUSE" → "Dosa House"); a word with its own mix ("FreeTaxUSA") stays.
const titleCase = (s) => s.split(' ').map((w) => (w === w.toUpperCase() ? w.toLowerCase().replace(/(^|[&-])([a-z])/g, (m) => m.toUpperCase()) : w)).join(' ');

/** A likely merchant name, or null when the line names none. */
export function nameFromLine(description, cities = new Set()) {
  const line = (description ?? '').trim();
  if (GENERIC.test(line)) return null;
  // "TST*RALEIGH - TACO VIDA": when the part before the dash is only a city, the merchant is after it.
  return read(line, cities) ?? (line.includes(' - ') ? read(line.slice(line.indexOf(' - ') + 3), cities) : null);
}

function read(line, cities) {
  let s = line;
  if (!s || GENERIC.test(s)) return null;
  for (let i = 0; i < 2 && PREFIXES.test(s); i++) s = s.replace(PREFIXES, '');
  if (GENERIC.test(s)) return null;
  s = s.replace(/^\d{2,4}\s+(?=[a-z]{2})/i, ''); // a store number first: "078 TACO TOWER"
  if (/\d/.test(words(s)[0] ?? '')) return null; // still a number first: an address or a code
  s = s.replace(/\.(com|net|org)\b.*$/i, '');
  // Up to the first store number, #, [, " - ", "*", "," or a wide gap.
  s = s.split(/\s{2,}|\s-\s|[#[*,]|\s(?=\S*\d)/)[0].trim();
  let w = words(s);
  while (w.length && STATE.test(w.at(-1))) w.pop();
  // Then the city it ends with (two words first: "JERSEY CITY").
  for (let i = 0; i < 2 && w.length > 1; i++) {
    const two = w.length > 2 ? `${w.at(-2)} ${w.at(-1)}`.toLowerCase() : null;
    if (two && cities.has(two)) w = w.slice(0, -2);
    else if (cities.has(w.at(-1).toLowerCase())) w = w.slice(0, -1);
    else break;
  }
  w = w.slice(0, 4);
  const name = w.join(' ');
  if (name.replace(/[^a-z]/gi, '').length < 3 || w[0].length < 2) return null;
  // One word that's a city, or three letters or fewer (an airport, a code): no merchant named.
  if (w.length === 1 && (cities.has(name.toLowerCase()) || name.replace(/[^a-z]/gi, '').length <= 3)) return null;
  return titleCase(name);
}

const squash = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * The household's own name for a merchant a line reads as, when there is one:
 * "Wm Supercenter" isn't, but "O'reilly" is "O'Reilly Auto Parts" and
 * "Homedepot" is "Home Depot". `canonical`: buildCanonicalMerchants' map. The
 * most used wins.
 */
export function knownAs(read, canonical) {
  const r = squash(read);
  if (r.length < 5) return null;
  let best = null;
  for (const { name, count } of canonical.values()) {
    const n = squash(name);
    if (n.length >= 5 && (n === r || n.startsWith(r) || r.startsWith(n)) && (!best || count > best.count)) best = { name, count };
  }
  return best?.name ?? null;
}
