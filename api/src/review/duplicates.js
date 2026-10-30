/**
 * Possible duplicate transactions in the saved ledger (D328, D329).
 *
 * Every row comes from a statement, so a duplicate can only be the same
 * purchase saved from two statements. This finds the candidates; how sure
 * the app is comes from the evidence about each copy (duplicate-score.js:
 * is it printed on its own PDF, does its statement add up without it).
 *
 * What the household's own data says about candidates:
 *   - Two rows on the SAME statement are both real. The bank printed both,
 *     and the statement only adds up with both (the same purchase made
 *     twice in a day, on purpose, for a "spend $X, get 5% back" offer).
 *   - Rows on different accounts are different purchases.
 *   - $0.00 rows (interest lines) say nothing.
 * So a candidate is the same account and amount within 3 days from two
 * different imports, whatever the description says: the same purchase can
 * be worded differently by the free reader and by Claude. The description
 * is one of the facts handed on, not a filter.
 *
 * Pure: rows in, candidate pairs out. Tested in duplicates.test.js.
 */

export const WINDOW_DAYS = 3;
// A posted date a day either side of the period is the bank's own rounding
// (transaction vs. posting date), not a sign of a reprint.
const SLACK_DAYS = 1;
const DAY = 86_400_000;

export const normalizeDescription = (s) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const days = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / DAY);

export function inOwnPeriod(row) {
  if (!row.period_start || !row.period_end) return true; // no period to judge by
  return days(row.posted_date, row.period_start) >= -SLACK_DAYS && days(row.period_end, row.posted_date) >= -SLACK_DAYS;
}

function inOverlap(a, b) {
  if (!a.period_start || !b.period_start) return false;
  const start = a.period_start > b.period_start ? a.period_start : b.period_start;
  const end = a.period_end < b.period_end ? a.period_end : b.period_end;
  return start <= end && [a, b].every((r) => r.posted_date >= start && r.posted_date <= end);
}

/**
 * @param rows [{ id, account_id, import_batch_id, posted_date 'YYYY-MM-DD', amount_cents,
 *   description, period_start, period_end }] — period_* of the row's own statement
 * @param settled Set of "lowId:highId" pairs the household already answered
 * @returns [{ a_id, b_id, same_description, days_apart, in_overlap }], a the earlier row
 */
export function findDuplicatePairs(rows, settled = new Set()) {
  const groups = new Map();
  for (const r of rows) {
    if (!r.amount_cents || r.import_batch_id == null) continue;
    const key = `${r.account_id}|${r.amount_cents}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  const pairs = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => (a.posted_date < b.posted_date ? -1 : a.posted_date > b.posted_date ? 1 : a.id - b.id));
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i], b = group[j];
        const apart = days(b.posted_date, a.posted_date);
        if (apart > WINDOW_DAYS) break;
        if (a.import_batch_id === b.import_batch_id) continue;
        if (settled.has(pairKey(a.id, b.id))) continue;
        pairs.push({
          a_id: a.id,
          b_id: b.id,
          same_description: normalizeDescription(a.description) === normalizeDescription(b.description),
          days_apart: apart,
          in_overlap: inOverlap(a, b),
        });
      }
    }
  }
  return pairs;
}

export const pairKey = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);
