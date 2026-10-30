/**
 * Tidy every transaction's merchant at once (D337): what an import does to
 * its own rows, run over the whole history. Pure: rows and the household's
 * merchants in, a plan out; the route applies it in one audited transaction
 * with an exact Undo.
 *
 * In order, each row taking the first answer it gets:
 *   1. learned: an unnamed row takes the name the same bank line (or its
 *      first words) got before (merchant-learning.js, D188); money moved
 *      between the household's own accounts only from the exact same line
 *      (D265). Payments and interest stay unnamed: they show as what they are.
 *   2. fixed: an unnamed row whose line contains exactly one existing
 *      merchant, or a name that's the more common one in another casing
 *      (merchant-review.js matchMerchant, D106).
 *   3. flagged: anything less certain goes to Review for a yes or no, unless
 *      it was answered there before.
 *   4. read (D367): a purchase or refund nothing above names gets a name read
 *      off its own line (line-name.js), or the household's name for it, sent to
 *      Review once per name; approving it names every line that reads the same.
 */
import { learnMerchants } from './merchant-learning.js';
import { matchMerchant } from '../review/merchant-review.js';
import { learnCities, nameFromLine, knownAs } from './line-name.js';
import { directoryEntryFor } from './directory.js';

/** Review's reason for a name read off the line; the approval looks for it to name the rest. */
export const LINE_REASON = 'Read from the statement line';
const LINE_TYPES = new Set(['purchase', 'refund']);

/** What an unnamed row's line reads as: the household's own name for it, or the line's. */
export function lineName(r, cities, canonical) {
  if (r.merchant || !LINE_TYPES.has(r.txn_type) || r.amount_cents === 0) return null;
  // A national brand the app already knows (D401) before a guess at the line's words.
  const read = directoryEntryFor(null, r.description)?.merchant ?? nameFromLine(r.description, cities);
  return read ? knownAs(read, canonical) ?? read : null;
}

/** The cities in every line the household has, for lineName. */
export const citiesOf = (rows) => learnCities(rows.map((r) => r.description));

export const NAMEABLE = new Set(['purchase', 'refund', 'fee', 'deposit', 'cashback']);
export const MOVING = new Set(['transfer', 'savings']);

const normalize = (s) => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * @param rows every transaction: { id, description, merchant, txn_type, amount_cents }
 * @param canonical the household's merchants (buildCanonicalMerchants)
 * @param answered transaction ids already answered in Review
 */
export function planTidy(rows, canonical, answered = new Set()) {
  const live = rows.filter((r) => r.amount_cents !== 0);
  const named = live.filter((r) => r.merchant);
  const learned = [];
  const take = (list, opts) => {
    for (const [i, { merchant }] of learnMerchants(named, list, opts)) learned.push({ id: list[i].id, to: merchant });
  };
  take(live.filter((r) => !r.merchant && NAMEABLE.has(r.txn_type)));
  take(live.filter((r) => !r.merchant && MOVING.has(r.txn_type)), { exactOnly: true });
  const done = new Set(learned.map((l) => l.id));

  const fixed = [];
  const flagged = [];
  for (const r of live) {
    if (done.has(r.id)) continue;
    // A payment's line names the card, not a merchant; a deposit's names the household's own bank
    // ("ACH Deposit from Chase"), which only the exact same line may name (D265).
    if (!r.merchant && (!NAMEABLE.has(r.txn_type) || r.txn_type === 'deposit')) continue;
    const ownCount = r.merchant ? (canonical.get(normalize(r.merchant))?.count ?? 1) : 0;
    const d = matchMerchant({ ...r, ownCount }, canonical);
    if (d.action === 'fix' && d.merchant !== r.merchant) fixed.push({ id: r.id, from: r.merchant ?? null, to: d.merchant, reason: d.reason });
    else if (d.action === 'flag' && !answered.has(r.id)) flagged.push({ id: r.id, current: r.merchant ?? null, suggested: d.merchant, reason: d.reason });
  }

  // 4. Read off the line, one question per name; a name answered before (any of its lines) isn't asked again.
  const taken = new Set([...done, ...fixed.map((f) => f.id), ...flagged.map((f) => f.id)]);
  const cities = citiesOf(rows);
  const byName = new Map();
  for (const r of live) {
    if (taken.has(r.id)) continue;
    const name = lineName(r, cities, canonical);
    if (name) byName.set(name, [...(byName.get(name) ?? []), r]);
  }
  for (const [name, same] of byName) {
    if (same.some((r) => answered.has(r.id))) continue;
    flagged.push({ id: same[0].id, current: null, suggested: name, reason: same.length > 1 ? `${LINE_REASON} (${same.length} lines)` : LINE_REASON });
  }
  return { learned, fixed, flagged };
}
