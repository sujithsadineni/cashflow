/**
 * What a statement line in an upload's review needs from a person (D335),
 * worked out once for the row's button and its panel: the one thing to look
 * at (the button's word), and every reason in full (the panel). Pure, so it's
 * tested without a browser.
 *
 * Order matters: the button names the first. A line already saved exactly
 * (the approve was refused) beats a possible duplicate, which beats a line
 * read unsure, which beats a missing date.
 */

export const FLAG_WORDS = {
  conflict: 'Already saved',
  duplicate: 'Duplicate?',
  unsure: 'Unsure',
  'no-date': 'No date',
};

export function lineFlags(row, { conflict = false } = {}) {
  if (row.review_status !== 'PENDING') return [];
  const flags = [];
  if (conflict) flags.push('conflict');
  else if (row.duplicate_of_id != null) flags.push('duplicate');
  if (row.confidence === 'LOW') flags.push('unsure');
  if (!row.posted_date) flags.push('no-date');
  return flags;
}

/** A pending line nothing's wrong with: ticked to start with. */
export const readsCleanly = (row) => row.review_status === 'PENDING' && lineFlags(row).length === 0;

/**
 * The two sides of a possible duplicate, field by field, and whether each
 * matches. `same` drives the panel's tint: what differs is what to look at.
 */
export function duplicateSides(row) {
  if (row.duplicate_of_id == null) return null;
  const fields = [
    ['date', row.posted_date, row.duplicate_posted_date],
    ['merchant', row.merchant ?? row.description, row.duplicate_merchant ?? row.duplicate_description],
    ['line', row.description, row.duplicate_description],
    ['amount', row.amount_cents, row.duplicate_amount_cents],
  ];
  return Object.fromEntries(fields.map(([key, here, saved]) => [key, { here, saved, same: here === saved }]));
}

/** Days between the two dates, for "3 days apart"; 0 when the same day. */
export function daysApart(a, b) {
  if (!a || !b) return null;
  return Math.round(Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}

/** Lines flagged and still pending: what "Approve all" would let through without a look. */
export const flaggedPending = (rows) => rows.filter((r) => r.review_status === 'PENDING' && lineFlags(r).length > 0);
