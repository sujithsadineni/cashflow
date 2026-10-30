/**
 * What a question is about (D332 step 3): the household's own categories,
 * merchants and accounts, matched against its words. Pure: the names come
 * in as a vocabulary built from the database (vocabFrom).
 *
 * Matching, in order:
 *  1. Whole names, as words: "georgia power", "groceries" (plurals folded,
 *     so "grocery" finds Groceries). Longest first; on a tie a category
 *     beats an account beats a merchant ("Rent" the category, not a
 *     merchant named Rent).
 *  2. A few everyday words for categories the ledger has: "gas" → Fuel,
 *     "eating out" → Dining, "electric" → Utilities.
 *  3. One distinctive word left over ("power" in "ga power") that is part
 *     of merchant or account names: one match is used; several come back as
 *     choices, never a guess.
 */

/** Words that say how or when, never what: they're never matched as names. */
const STOP = new Set(`a an and any are as at be by can compare compared did do does each every for from get got had has have how i in is it its last
me month months monthly more most much my of on or our out over paid past pay per previous same show since so spend spending spent than that the
their there this to top total trend us versus vs was we week weeks were what when where which while who why with year years ytd you your all
day days today yesterday current far biggest largest highest average avg breakdown expenses expense expenditure cost costs money bills bill
charge charges purchase purchases transaction transactions merchant merchants store stores categories category list give tell versus against
january february march april may june july august september october november december jan feb mar apr jun jul aug sep sept oct nov dec
one two three four five six seven eight nine ten eleven twelve card cards account accounts`.split(/\s+/));

const SYNONYMS = {
  Dining: ['restaurant', 'eating out', 'eat out', 'takeout', 'food delivery'],
  Groceries: ['grocery', 'supermarket'],
  Fuel: ['gas', 'petrol', 'gasoline'],
  Utilities: ['utility', 'electric', 'electricity', 'water bill', 'internet', 'power bill'],
  Phone: ['mobile', 'cell phone', 'phone bill'],
  Subscriptions: ['subscription', 'streaming'],
  Travel: ['flight', 'hotel'],
  Health: ['medical', 'doctor', 'pharmacy'],
  Rent: ['housing'],
  'Parking & Tolls': ['parking', 'toll'],
  'Personal Care': ['haircut', 'salon'],
};

export const normalize = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** A word without its plural: groceries → grocery, bills → bill. Stop words and short words stay as they are. */
export function stem(w) {
  if (STOP.has(w) || w.length <= 3) return w;
  if (w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}
const tokens = (s) => normalize(s).split(' ').filter(Boolean).map(stem);

const PRIORITY = { category: 0, account: 1, merchant: 2 };

/**
 * The vocabulary from the database's lists: categories [{ id, name }],
 * merchants [{ name, count }], accounts [{ id, name }] (one entry per
 * name; several accounts can share it). A name made only of stop words
 * can't be told apart from the question's own words, so it's left out.
 */
export function vocabFrom({ categories = [], merchants = [], accounts = [] }) {
  const entries = [];
  const add = (kind, name, extra) => {
    const t = tokens(name);
    if (t.length === 0 || t.every((w) => STOP.has(w))) return;
    entries.push({ kind, name, tokens: t, ...extra });
  };
  for (const c of categories) add('category', c.name, { id: c.id });
  const byName = Map.groupBy(accounts, (a) => a.name);
  for (const [name, list] of byName) add('account', name, { ids: list.map((a) => a.id) });
  for (const m of merchants) add('merchant', m.name, { count: m.count ?? 0 });
  const names = new Set(categories.map((c) => c.name));
  for (const [category, words] of Object.entries(SYNONYMS)) {
    if (!names.has(category)) continue;
    const id = categories.find((c) => c.name === category).id;
    for (const w of words) entries.push({ kind: 'category', name: category, id, tokens: tokens(w), synonym: w });
  }
  return entries;
}

const sameSubject = (a, b) => a.kind === b.kind && a.name === b.name;
const subjectOf = ({ kind, name, id, ids, partial }) => ({ kind, name, ...(id !== undefined && { id }), ...(ids && { ids }), ...(partial && { partial }) });

/**
 * The subjects named in `text`: { subjects, choices, used } where choices is
 * set when one leftover word fits several names ({ word, options }).
 * `used` is how many words were read as names, for the parser's "did it
 * understand anything" check.
 */
export function findSubjects(text, vocab) {
  const words = tokens(text);
  const taken = new Array(words.length).fill(false);
  const found = [];

  // 1 and 2: whole names and everyday words, longest first.
  const hits = [];
  for (const e of vocab) {
    const n = e.tokens.length;
    for (let i = 0; i + n <= words.length; i++) {
      if (e.tokens.every((w, j) => words[i + j] === w)) hits.push({ e, i, n });
    }
  }
  hits.sort((a, b) => b.n - a.n || PRIORITY[a.e.kind] - PRIORITY[b.e.kind] || (a.e.synonym ? 1 : 0) - (b.e.synonym ? 1 : 0) || a.i - b.i);
  for (const h of hits) {
    if (taken.slice(h.i, h.i + h.n).some(Boolean)) continue;
    taken.fill(true, h.i, h.i + h.n);
    if (!found.some((f) => sameSubject(f, h.e))) found.push(h.e);
  }

  // 3: a distinctive leftover word inside merchant or account names.
  let choices = null;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (taken[i] || STOP.has(w) || w.length < 4 || /^\d+$/.test(w)) continue;
    const options = vocab.filter((e) => !e.synonym && e.kind !== 'category' && e.tokens.includes(w));
    if (options.length === 0) continue;
    taken[i] = true;
    if (options.length === 1) {
      if (!found.some((f) => sameSubject(f, options[0]))) found.push({ ...options[0], partial: true });
    } else if (!choices) {
      const ranked = options.sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind] || (b.count ?? 0) - (a.count ?? 0)).slice(0, 6);
      choices = { word: normalize(text).split(' ').find((raw) => stem(raw) === w) ?? w, options: ranked.map(subjectOf) };
    }
  }

  return { subjects: found.map(subjectOf), choices, used: taken.filter(Boolean).length };
}
