/**
 * How sure the app is that a possible-duplicate pair really is one (D329),
 * from evidence about each copy, strongest first:
 *
 *   printed   is the row printed on its own statement's PDF (re-read)?
 *             A copy its own statement doesn't print came from nowhere.
 *   needed    does its statement add up only WITH it? Then the bank counted
 *             that money in that period, and the copy is real there.
 *   spare     does its statement add up only WITHOUT it? Then it's extra.
 *
 * The hard checks decide whenever one answers. The soft ones (description,
 * dates) only give a "can't tell" score, capped, because the household's
 * own data disproved them as proof: Amex re-posted a dispute credit and its
 * reversal on two later statements with the original date, so a row dated
 * outside its period, with a twin, was real all along.
 *
 * Pure: facts in, { score, verdict, remove_id, checks } out. Tested in
 * duplicate-score.test.js.
 */

const HARD_DUPLICATE = 98;
const HARD_SPARE = 97;
const HARD_REAL = 2;
const SOFT_CAP = 75;

/**
 * @param pair { a, b, same_description, days_apart, in_overlap }
 *   a, b: { id, printed: true|false|null, needed: bool|null, spare: bool|null, in_period: bool }
 *   null = the check couldn't be run (a locked PDF, a statement with no balances)
 */
export function scoreDuplicate({ a, b, same_description, days_apart, in_overlap }) {
  // Each copy's own checks, for the card that shows it; ok true = evidence it's real.
  const copyChecks = (c) => [
    c.printed === true && { ok: true, text: 'Printed on its statement' },
    c.printed === false && { ok: false, text: "Not printed on its statement" },
    c.printed === null && { ok: null, text: "Its statement couldn't be re-read" },
    c.needed && { ok: true, text: 'Its statement only adds up with it' },
    c.spare && { ok: false, text: 'Its statement only adds up without it' },
    !c.in_period && { ok: null, text: "Dated outside its statement's period" },
  ].filter(Boolean);
  const checks = {
    [a.id]: copyChecks(a),
    [b.id]: copyChecks(b),
    pair: [
      { ok: null, text: same_description ? 'Same description' : 'Different descriptions' },
      in_overlap && { ok: null, text: 'Both statements cover that day' },
      { ok: null, text: days_apart === 0 ? 'Same day' : `${days_apart} day${days_apart === 1 ? '' : 's'} apart` },
    ].filter(Boolean),
  };

  // Hard evidence: a copy that isn't printed, or that its statement doesn't need.
  const extra = [a, b].find((c) => c.printed === false) ?? [a, b].find((c) => c.spare);
  if (extra) {
    const score = extra.printed === false ? HARD_DUPLICATE : HARD_SPARE;
    return { score, verdict: 'duplicate', remove_id: extra.id, checks };
  }
  if (a.needed && b.needed) return { score: HARD_REAL, verdict: 'real', remove_id: null, checks };

  // Soft only: how much the two copies look like one row.
  let score = 30;
  score += same_description ? 25 : -20;
  if (a.in_period !== b.in_period) score += 15;
  if (in_overlap) score += 15;
  if (days_apart === 0) score += 10;
  if (a.needed || b.needed) score -= 25; // one copy is proven real; the other might still be its echo
  score = Math.max(5, Math.min(SOFT_CAP, score));
  // The copy to offer for removal: the one outside its own period, else the later
  // one; never a copy its statement is proven to need.
  const first = a.in_period && !b.in_period ? b : !a.in_period && b.in_period ? a : b;
  const remove = [first, first === a ? b : a].find((c) => !c.needed);
  return { score, verdict: 'unsure', remove_id: remove?.id ?? null, checks };
}
