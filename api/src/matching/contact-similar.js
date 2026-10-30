/**
 * Contacts that may be one person (D290). Every spelling a bank prints
 * becomes a contact ("Quinn", "Quin", "Quinn Parker"), so these are put up
 * for the household to merge or mark different. Never merged
 * automatically: two "Rowan"s can be two people. Pure; tested.
 *
 * A pair is suggested, strongest reason first, when:
 *   - the names are the same words              ("Quinn Parker" twice)
 *   - one name's words are all in the other's   ("Rowan Lee" / "Rowan James Lee")
 *   - the first names are the same              ("Avery Cousin" / "Avery Stone"),
 *     unless it's a common leading name the household lists (`common`, kept in
 *     household/common-first-names.js: three people sharing one are three people)
 *   - the first names are one letter apart      ("Eric" / "Erik")
 *   - a bare one-word name ends the other's first name ("Lina" / "Carolina Park");
 *     not between two full names, where it's usually another name ("Ana" / "Diana")
 */

const words = (name) => (name ?? '').toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 1);

function oneApart(a, b) {
  if (Math.abs(a.length - b.length) > 1 || a === b) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

export function whySimilar(a, b, common = new Set()) {
  const A = words(a);
  const B = words(b);
  if (!A.length || !B.length) return null;
  const setA = new Set(A);
  const setB = new Set(B);
  const same = setA.size === setB.size && [...setA].every((w) => setB.has(w));
  if (same) return 'Same name';
  if ([...setA].every((w) => setB.has(w)) || [...setB].every((w) => setA.has(w))) return 'One name is inside the other';
  const [fa, fb] = [A[0], B[0]];
  if (fa === fb) return common.has(fa) ? null : 'Same first name';
  if (fa.length < 4 || fb.length < 4) return null;
  if (oneApart(fa, fb)) return 'Similar first name';
  const bare = (A.length === 1 && fb.endsWith(fa)) || (B.length === 1 && fa.endsWith(fb));
  return bare ? 'Similar first name' : null;
}

const STRENGTH = ['Same name', 'One name is inside the other', 'Similar first name', 'Same first name'];

/**
 * @param contacts - { id, name, aliases? }
 * @param distinct - [[lowId, highId]] pairs already marked different people
 * @param skip - contact names never suggested (the household's own, already one each)
 * @param commonFirst - leading names too common to mean anything when shared
 * @returns [{ a, b, why }] strongest first, a.id < b.id
 */
export function similarPairs(contacts, distinct = [], skip = [], commonFirst = []) {
  const common = new Set(commonFirst.map((n) => n.toLowerCase()));
  const no = new Set(distinct.map(([x, y]) => `${Math.min(x, y)}:${Math.max(x, y)}`));
  const skipped = new Set(skip.map((s) => s.toLowerCase()));
  const list = contacts.filter((c) => !skipped.has(c.name.toLowerCase())).sort((x, y) => x.id - y.id);
  const out = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const [a, b] = [list[i], list[j]];
      if (no.has(`${a.id}:${b.id}`)) continue;
      const why = whySimilar(a.name, b.name, common);
      if (why) out.push({ a, b, why });
    }
  }
  return out.sort((x, y) => STRENGTH.indexOf(x.why) - STRENGTH.indexOf(y.why) || x.a.name.localeCompare(y.a.name));
}
