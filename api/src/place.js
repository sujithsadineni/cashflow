/**
 * Where a purchase happened (D224), read from the bank's own description:
 * online, or a town (with its state and store number when printed). Pure:
 * tested in place.test.js. The transactions list attaches it to each row,
 * and the table shows it after the merchant: "Costco - Mapleton, GA" (D225).
 *
 * Nothing is stored. It's read every time a row is shown, so the whole
 * history has it and every future statement too.
 *
 *   COSTCO WHSE #1204 FAIRVIEW NC                         → Fairview, NC · #1204
 *   COSTCO WHSE #0101 770-555-0101 GA                 → #101 (town learned: Mapleton)
 *   WWW COSTCO COM ISSAQUAH WAUSA                     → Online (the WA town is head office)
 *   TARGET T-0001 100 MAIN RD CEDAR PARK 30001 GA USA → Cedar Park, GA
 *   H&M 0001GLENDALE 1 Main Circle GLENDALE30002 GA USA → Glendale, GA
 *   AplPay FOOD LION #7777 SHELBYVILLE NC - GROCERY STORE → Shelbyville, NC · #7777
 */

const STATES = new Set('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' '));

// A website, an app (delivery, rides) or a marketplace is online, wherever the
// processor's office is (Amazon's Seattle, Lyft's San Francisco).
const ONLINE = /\bWWW\b|[A-Z0-9]\.(COM|CO|DEV|IN|NET|ORG|IO)\b|\bAMZN\b|AMAZON (MARKETPLACE|MKTPL|RETA|PAY)|\bONLINE\b|DOORDASH|\bUBER\b|\bLYFT\b|GOOGLE \*/i;

// Bank prefixes and trailers that aren't part of the place.
const PREFIXES = [/^(Daily Cash Adjustment · )+/i, /^Purchase Returns - /i, /^AplPay /i, /^Card Purchase \d{2}\/\d{2} /i];
const TRAILERS = [/\s+\(RETURN\)$/i, /\s+-?\s*(GROCERY STORE|INSIDE SALE)$/i, /\s+Card \d{4}$/i, /\s+\S*\/\S+$/, /\s+CABLE & PAY TV.*$/i];

// Words that end a street address or a company name, never part of a town.
const NOT_TOWN = new Set(['ST', 'RD', 'AVE', 'AVENUE', 'DR', 'BLVD', 'PKWY', 'HWY', 'LN', 'CT', 'CIR', 'CIRCLE', 'WAY', 'STE', 'SUITE', 'PL', 'PLZ', 'XING', 'CRSSNG', 'BVD', 'ROAD', 'STREET', 'NE', 'NW', 'SE', 'SW',
  'LLC', 'INC', 'CO', 'LTD', 'CORP', 'I', 'STORE', 'THE', 'AND', '&', '-', 'NA', 'PA', 'USA', 'SALE']);
// A town is one word, unless the two read as one name ("Cedar Park", "San Francisco").
const FIRST_OF_TWO = new Set(['SAN', 'SANTA', 'LOS', 'LAS', 'SAINT', 'NEW', 'FORT', 'FT', 'PEACHTREE', 'JOHNS', 'CHAPEL', 'ROCKY', 'GRAND', 'SALT', 'PALM', 'MOUNT', 'MT', 'MIAMI', 'NAGS', 'DFW', 'HOLLY', 'FUQUAY', 'WAKE', 'SUGAR', 'STONE', 'PIGEON', 'MYRTLE', 'KANSAS', 'OKLAHOMA', 'CORAL', 'CEDAR', 'BOWLING', 'COLLEGE']);
const SECOND_OF_TWO = new Set(['CREEK', 'BEACH', 'HEAD', 'CITY', 'HILL', 'HILLS', 'PARK', 'SPRINGS', 'VALLEY', 'POINT', 'LAKE', 'RIDGE', 'CORNERS', 'COR', 'AIRPORT', 'FALLS', 'FORGE', 'GROVE', 'HEIGHTS', 'MOUNTAIN', 'VILLAGE']);

// Town names the bank truncates into something unrecognisable.
const CUT_TOWNS = [[/KILL DEVIL HI(L|LL|LLS)?$/, 'Kill Devil Hills']];

/** A local phone number in the line (10 digits), or null. Toll-free numbers are head offices, never a place. */
const TOLL_FREE = new Set(['800', '888', '877', '866', '855', '844', '833']);
export function phoneOf(text) {
  const m = (text ?? '').match(/\b(\d{3})[-. ]?(\d{3})[-. ]?(\d{4})\b/);
  return m && !TOLL_FREE.has(m[1]) ? `${m[1]}${m[2]}${m[3]}` : null;
}

const ACRONYMS = new Set(['DFW', 'RDU', 'ATL', 'JFK', 'LAX', 'SFO', 'ORD', 'CLT']);
const title = (w) => w.split(' ').map((x) => (ACRONYMS.has(x.toUpperCase()) ? x.toUpperCase() : x.toLowerCase().replace(/(^|-)([a-z])/g, (m) => m.toUpperCase()))).join(' ');

/**
 * @param description  the bank's line
 * @returns { online, town, state, store } (any may be null/false), or null when nothing is printed
 */
export function parsePlace(description) {
  let text = (description ?? '').replace(/\s+/g, ' ').trim();
  if (!text || /^zelle/i.test(text)) return null;
  for (const p of PREFIXES) text = text.replace(p, '');
  let changed = true;
  while (changed) {
    changed = false;
    for (const t of TRAILERS) {
      const next = text.replace(t, '');
      if (next !== text) { text = next; changed = true; }
    }
  }
  // "#0101" is a store; "#26,1, Brigade Gateway" is a street address.
  const store = text.match(/#\s?0*(\d{1,6})(?![\d,])/)?.[1] ?? null;
  if (ONLINE.test(text)) return { online: true, town: null, state: null, store, phone: null };

  // The end of the line: state (or India), with an optional "USA" (sometimes glued: "NCUSA").
  const tokens = text.split(' ');
  let last = tokens.at(-1).toUpperCase();
  if (last === 'USA') { tokens.pop(); last = (tokens.at(-1) ?? '').toUpperCase(); }
  let state = null;
  let country = null;
  if (/^[A-Z]{2}USA$/.test(last) && STATES.has(last.slice(0, 2))) state = last.slice(0, 2);
  else if (STATES.has(last)) state = last;
  else if (/^IND(IND)?$/.test(last)) country = 'IN';
  else if (/^[A-Z]{2,}\d{5}$/.test(last)) return store ? { online: false, town: null, state: null, store, phone: phoneOf(text) } : null;
  if (!state && !country) return store ? { online: false, town: null, state: null, store, phone: phoneOf(text) } : null;
  tokens.pop();

  // Before it: an optional ZIP (sometimes glued to the town: "GLENDALE30002"), then the town.
  let before = tokens.at(-1) ?? '';
  // ZIP or ZIP+4 ("300970000"), on its own or glued to the town.
  const glued = before.match(/^([A-Za-z]{3,})(\d{5}(?:\d{4})?|\d{6})$/);
  if (glued) tokens[tokens.length - 1] = glued[1];
  else if (/^(\d{5}(\d{4})?|\d{6})$/.test(before)) tokens.pop();
  before = tokens.at(-1) ?? '';

  // Towns the bank cuts mid-word that one word can't recover.
  const tail = tokens.slice(-3).join(' ').toUpperCase();
  const cut = CUT_TOWNS.find(([re]) => re.test(tail));
  if (cut) return { online: false, town: cut[1], state: state ?? country, store, phone: null };

  const word = (w) => /^[A-Za-z][A-Za-z.'-]*$/.test(w) && !NOT_TOWN.has(w.toUpperCase().replace(/\.$/, ''));
  if (!word(before) || before.length < 3) return { online: false, town: null, state, store, phone: phoneOf(text) };
  let town = before;
  const prev = tokens.at(-2) ?? '';
  if (word(prev) && (FIRST_OF_TWO.has(prev.toUpperCase()) || SECOND_OF_TWO.has(before.toUpperCase()))) town = `${prev} ${before}`;
  return { online: false, town: title(town), state: state ?? country, store, phone: null };
}

/**
 * Towns learned from the household's own rows (D224):
 *  - a store that sometimes prints a phone number instead of its town
 *    ("COSTCO WHSE #0101 770-555-0101 GA") gets it from another row of the
 *    same merchant and store number ("#0101 MAPLETON GA")
 *  - a town cut short by the bank ("SHELBYVIL") becomes the full one seen
 *    elsewhere ("Shelbyville")
 * @param rows  [{ merchant, description }]
 *  - a merchant seen in exactly one town lends it to its rows that print only
 *    a local (not toll-free) phone number ("Spice Central 919-…" → its one town)
 * @returns { storeTown, fullTown, onlyTown: Map(merchant → { town, state }) }
 */
export function learnPlaces(rows) {
  const counts = new Map();
  const towns = new Map();
  const merchantTowns = new Map();
  for (const r of rows) {
    const p = parsePlace(r.description);
    if (!p?.town) continue;
    towns.set(p.town, (towns.get(p.town) ?? 0) + 1);
    const mk = (r.merchant ?? '').toLowerCase();
    if (mk) {
      const set = merchantTowns.get(mk) ?? new Map();
      set.set(p.town, p.state);
      merchantTowns.set(mk, set);
    }
    if (p.store) {
      const key = `${(r.merchant ?? '').toLowerCase()}|${p.store}`;
      const byTown = counts.get(key) ?? new Map();
      byTown.set(p.town, (byTown.get(p.town) ?? 0) + 1);
      counts.set(key, byTown);
    }
  }
  const storeTown = new Map([...counts].map(([k, m]) => [k, [...m].sort((a, b) => b[1] - a[1])[0][0]]));
  const fullTown = new Map();
  const names = [...towns.keys()];
  for (const short of names) {
    if (short.length < 6) continue;
    const full = names.filter((n) => n !== short && n.toLowerCase().startsWith(short.toLowerCase())).sort((a, b) => towns.get(b) - towns.get(a))[0];
    if (full) fullTown.set(short, full);
  }
  // A merchant seen in exactly one town, for its rows that print only a local phone number.
  const onlyTown = new Map([...merchantTowns].filter(([, m]) => m.size === 1).map(([k, m]) => { const [[town, state]] = [...m]; return [k, { town, state }]; }));
  return { storeTown, fullTown, onlyTown };
}

/**
 * Places looked up once in a public directory, for stores that only ever
 * print a phone number (D226): { 'costco|#123': { town, state } } by store,
 * { 'tel:5555550100': { town, state } } by phone. They're the household's
 * own stores, so they live in household/known-places.js, which is never
 * published (D259); without it, such a row shows its state and number.
 */
const local = await import('./household/known-places.js').catch((err) => {
  if (err.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw err;
});
export const KNOWN_PLACES = local.KNOWN_PLACES ?? {};

/**
 * The place for one row, with what was learned filled in, and the words
 * shown after the merchant: "Mapleton, GA" · "Online" · "#102". null when
 * the line says nothing.
 * @returns { online, town, state, store, label, title } | null
 */
export function placeFor(row, learned, known = KNOWN_PLACES) {
  const p = parsePlace(row.description);
  if (!p) return null;
  const mk = (row.merchant ?? '').toLowerCase();
  let town = p.town ? learned?.fullTown.get(p.town) ?? p.town : null;
  let state = p.state;
  if (!town && !p.online) {
    // In order: the household's own other rows of that store; a public store
    // directory (KNOWN_PLACES); the merchant's one town, for a local phone line.
    const listed = (p.store && known[`${mk}|#${p.store}`]) || (p.phone && known[`tel:${p.phone}`]);
    const only = !p.store && p.phone ? learned?.onlyTown.get(mk) : null;
    if (p.store && learned?.storeTown.get(`${mk}|${p.store}`)) town = learned.storeTown.get(`${mk}|${p.store}`);
    else if (listed) ({ town, state } = listed);
    else if (only) ({ town, state } = only);
  }
  if (!p.online && !town && !p.store) return null;
  p.state = state;
  const storeWord = /WHSE/i.test(row.description) ? 'Warehouse' : 'Store';
  const where = town && p.state ? `${town}, ${p.state === 'IN' ? 'India' : p.state}` : town;
  // Shown after the name in the same type (D225): "Costco - Mapleton, GA" / "Costco - Online" / "Costco - #102".
  const label = p.online ? 'Online' : where ?? [p.state, `#${p.store}`].filter(Boolean).join(' ');
  const titleText = p.online
    ? 'Online'
    : [town && p.state ? `${town}, ${p.state === 'IN' ? 'India' : p.state}` : town ?? p.state, p.store ? `${storeWord} #${p.store}` : null].filter(Boolean).join(' · ');
  return { online: p.online, town, state: p.state, store: p.store, label, title: titleText };
}
