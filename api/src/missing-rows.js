/**
 * Rows a re-read of a stored statement finds that its saved rows don't
 * have (D207). Matched by date and amount as a multiset: a statement with
 * two identical $53.23 charges keeps both, and only the extra one a new
 * read finds counts as missing. Zero-amount lines (BofA's "INTEREST
 * CHARGED ... 0.00") are never "missing". Pure: tested in missing-rows.test.js.
 *
 * @param parsed  rows from a fresh read: { posted_date, amount_cents, ... }
 * @param saved   the batch's staged rows, any status: { posted_date, amount_cents }
 * @returns the parsed rows with no saved counterpart
 */
export function missingRows(parsed, saved) {
  const left = new Map();
  for (const s of saved) {
    const k = `${String(s.posted_date).slice(0, 10)}|${s.amount_cents}`;
    left.set(k, (left.get(k) ?? 0) + 1);
  }
  const out = [];
  for (const p of parsed) {
    if (!p.amount_cents) continue;
    const k = `${String(p.posted_date).slice(0, 10)}|${p.amount_cents}`;
    if ((left.get(k) ?? 0) > 0) left.set(k, left.get(k) - 1);
    else out.push(p);
  }
  return out;
}
