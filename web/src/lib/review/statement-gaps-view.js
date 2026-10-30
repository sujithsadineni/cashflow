/**
 * Review's words for statement gaps (D268): the API's per-card verdicts
 * turned into the groups the Statements tab shows. Pure: tested in
 * statement-gaps-view.test.js.
 *
 *   upload    statements really missing, per card
 *   ask       cycles only you can settle: likely quiet, or can't tell
 *   problems  statements saved wrong (overlapping, details not saved)
 *   quiet     quiet months, proven or answered; answered ones can be undone
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const parts = (iso) => iso.split('-').map(Number);
const short = (iso) => {
  const [, m, d] = parts(iso);
  return `${MONTHS[m - 1]} ${d}`;
};

/** "Sep 2026": the month the cycle stands for, the one whose 15th it holds (D269, from the server), else the month it closed in. */
export const cycleMonth = (cycle) => {
  const keys = cycle.months ?? [cycle.month ?? cycle.end.slice(0, 7)];
  const [y1, m1] = parts(keys[0]);
  if (keys.length === 1) return `${MONTHS[m1 - 1]} ${y1}`;
  const [y2, m2] = parts(keys.at(-1));
  // A long gap cycle can hold two months' 15ths: "Jun – Jul 2025".
  return y1 === y2 ? `${MONTHS[m1 - 1]} – ${MONTHS[m2 - 1]} ${y2}` : `${MONTHS[m1 - 1]} ${y1} – ${MONTHS[m2 - 1]} ${y2}`;
};
/**
 * "Feb 2025": the month a statement closes in, which is how banks name it
 * (D307). Barclays' "January 2025 statement" closes Jan 5 and covers
 * December; asking for "Jan 2025" by the 15th rule sent the owner to the
 * wrong file. Review's upload asks use this; the calendars keep cycleMonth.
 */
export const statementMonth = (cycle) => {
  const [y, m] = parts(cycle.end);
  return `${MONTHS[m - 1]} ${y}`;
};
/** "Feb 5, 2025": the date the statement closes. */
export const closingDate = (cycle) => `${short(cycle.end)}, ${cycle.end.slice(0, 4)}`;
/** "May 9 – Jun 8". */
export const cycleRange = (cycle) => `${short(cycle.start)} – ${short(cycle.end)}`;

export function gapView(cards = []) {
  const upload = [];
  const ask = [];
  const quiet = [];
  const problems = [];
  for (const c of cards) {
    const card = { account_id: c.account_id, name: c.name, mask: c.mask };
    const cycles = c.gaps.flatMap((g) => g.cycles.map((cy) => ({ ...cy, trailing: g.trailing })));
    const missing = cycles.filter((cy) => cy.verdict === 'missing');
    if (missing.length > 0) upload.push({ ...card, cycles: missing });
    for (const cy of cycles.filter((x) => x.verdict === 'likely_quiet' || x.verdict === 'unknown')) ask.push({ ...card, cycle: cy });
    for (const cy of cycles.filter((x) => x.verdict === 'quiet')) quiet.push({ ...card, cycle: cy });
    // A statement on file that shows no activity is a silent month too (D273).
    for (const cy of c.quiet_statements ?? []) quiet.push({ ...card, cycle: cy });
    for (const p of c.problems) problems.push({ ...card, problem: p });
  }
  const newestFirst = (a, b) => (b.cycle?.end ?? '').localeCompare(a.cycle?.end ?? '');
  ask.sort(newestFirst);
  quiet.sort(newestFirst);
  upload.sort((a, b) => b.cycles.at(-1).end.localeCompare(a.cycles.at(-1).end));
  const toUpload = upload.reduce((n, u) => n + u.cycles.length, 0);
  // Statements tab: what to upload and what was saved wrong. Silent months: the rest (D269).
  return { upload, ask, problems, quiet, count: toUpload + problems.length, toUpload };
}

/** The Silent months tab's unanswered cycles, grouped by card newest first. */
export function groupAskedByCard(ask = []) {
  const byCard = new Map();
  for (const item of ask) {
    if (!byCard.has(item.account_id)) {
      byCard.set(item.account_id, { account_id: item.account_id, name: item.name, mask: item.mask, months: [] });
    }
    byCard.get(item.account_id).months.push(item);
  }
  return [...byCard.values()]
    .map((card) => ({ ...card, months: card.months.sort((a, b) => b.cycle.end.localeCompare(a.cycle.end)) }))
    .sort((a, b) => b.months[0].cycle.end.localeCompare(a.months[0].cycle.end));
}

/**
 * The Silent months tab (D269): the questions only you can answer, then each
 * card's silent months, oldest first, answered ones marked so they can be undone.
 */
export function silentView(cards = []) {
  const { ask, quiet } = gapView(cards);
  const byCard = new Map();
  for (const q of quiet) {
    if (!byCard.has(q.account_id)) byCard.set(q.account_id, { account_id: q.account_id, name: q.name, mask: q.mask, months: [] });
    byCard.get(q.account_id).months.push(q.cycle);
  }
  const silent = [...byCard.values()].map((c) => ({ ...c, months: c.months.sort((a, b) => a.end.localeCompare(b.end)) })).sort((a, b) => a.name.localeCompare(b.name));
  return { ask, silent, count: ask.length, months: quiet.length };
}
