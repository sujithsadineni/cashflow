/**
 * A statement as printed (D360): its rows in the order they sit on the pages,
 * and on a shared card the sections each person's rows were printed under,
 * with a check of each section against the total the statement prints for it.
 * The reading plays rows in this order; organizing then sorts them by date.
 * Pure; tested in printed-order.test.js.
 */

/**
 * Rows in printed order: by page and height on the page where the row's line
 * was found (GET /imports/:id/pages); a row with no line found keeps its place
 * after the row the reader saved before it. Without pages (a CSV, a locked
 * PDF) that's the reader's own order, which is the printed one on 104 of 105
 * statements measured.
 * @param rows    staged rows
 * @param located { [id]: { page, top } } or null
 */
export function printedOrder(rows, located) {
  let last = [0, 0];
  const keyed = [...rows].sort((a, b) => a.id - b.id).map((row, i) => {
    const box = located?.[row.id];
    if (box) last = [box.page, box.top];
    return { row, key: [...last, i] };
  });
  return keyed
    .sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.key[2] - b.key[2])
    .map((k) => k.row);
}

/** Whose section a row was printed in, or null for rows outside every section (payments, credits). */
export const sectionKey = (row) => {
  if (row.person_id != null) return `p${row.person_id}`;
  return row.card_ending ?? row.spender_name ?? null;
};

/**
 * The runs of rows printed under one person, in printed order. Only a shared
 * card has them: with fewer than two people printed, every row is one plain
 * run and nothing gets a divider.
 * @returns [{ key, name, card_ending, rows }]; key null for rows outside every section
 */
export function printedSections(ordered) {
  const people = new Set(ordered.map(sectionKey).filter(Boolean));
  if (people.size < 2) return [{ key: null, name: null, card_ending: null, rows: ordered }];
  const out = [];
  for (const row of ordered) {
    const key = sectionKey(row);
    const run = out.at(-1);
    if (run && run.key === key) run.rows.push(row);
    else out.push({ key, name: key ? row.person_name ?? row.spender_name ?? null : null, card_ending: key ? row.card_ending ?? null : null, rows: [row] });
  }
  return out;
}

const norm = (s) => (s ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

/**
 * One section's figures and its check against what the statement prints for
 * that person (D360). A person printed in two runs is checked once, over all
 * their rows, on the last run. kind 'charges' (Amex) counts money out, 'all'
 * (Apple) everything but payments.
 * @param run     a section from printedSections
 * @param all     every section, so a person's other runs count too
 * @param printed [{ printed_name, card_ending, total_cents, kind }] from the pages
 * @returns { count, total_cents, check: null | { ok, printed_cents } }
 */
export function sectionFigures(run, all, printed = []) {
  const total = (rows, kind) => rows
    .filter((r) => r.review_status !== 'REJECTED')
    .filter((r) => (kind === 'charges' ? r.amount_cents < 0 : r.txn_type !== 'payment'))
    .reduce((sum, r) => sum + r.amount_cents, 0);
  const runs = all.filter((s) => s.key === run.key);
  const mine = run.key ? runs.flatMap((s) => s.rows) : run.rows;
  const match = run.key && printed.find((p) => (p.card_ending && mine.some((r) => r.card_ending === p.card_ending))
    || (!p.card_ending && mine.some((r) => norm(r.spender_name) === norm(p.printed_name))));
  const last = runs.at(-1) === run;
  return {
    count: run.rows.length,
    total_cents: total(run.rows, 'all'),
    check: match && last ? { ok: total(mine, match.kind) === match.total_cents, printed_cents: match.total_cents } : null,
  };
}
