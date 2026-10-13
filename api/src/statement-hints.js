/**
 * Why a statement doesn't add up (D197): the likeliest cause of its gap,
 * read from its own rows, so the Review page can say more than "off by
 * $X". A hint, never a fix: nothing here writes anything. Pure: tested
 * in statement-hints.test.js.
 *
 * Checked in order, first match wins:
 *   - sign_fix:     a pending wrong-sign finding (D178) on one of its rows
 *                   closes the gap exactly
 *   - duplicate:    a row with a twin (same amount and description, within
 *                   3 days) whose amount is exactly the gap
 *   - missing_draw: a transfer or cash-advance fee with no draw beside it,
 *                   and the rows short of money out (the CCR case)
 *   - small:        under $10, usually an interest, rounding or cashback
 *                   line the reader skipped
 *   - missing_out / extra_out: which way the rows are off
 *
 * diff_cents is rows − expected (tally.js). Rows are negative for money
 * out on every account type, so diff > 0 means the rows are short of
 * money out, and diff < 0 means they have too much.
 */

import { isDraw, isDrawFee } from './balance-transfer.js';

const SMALL_CENTS = 1000;
const DAY = 86_400_000;
const normalize = (s) => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * @param statement     { tally: { diff_cents }, rows: [{ transaction_id, amount_cents, description, posted_date, txn_type, category_name }] }
 * @param signFindings  pending amount_sign findings: [{ id, transaction_id }]
 * @returns { kind, ... } | null
 */
export function statementHint({ tally, rows }, signFindings = []) {
  const diff = tally?.diff_cents;
  if (!diff) return null;

  const bySign = new Map(signFindings.map((f) => [f.transaction_id, f.id]));
  const flip = rows.find((r) => bySign.has(r.transaction_id) && 2 * r.amount_cents === diff);
  if (flip) return { kind: 'sign_fix', review_id: bySign.get(flip.transaction_id), transaction_id: flip.transaction_id, cents: flip.amount_cents };

  const twin = rows.find((r) => r.amount_cents === diff && rows.some((o) =>
    o !== r && o.amount_cents === r.amount_cents && normalize(o.description) === normalize(r.description)
    && Math.abs(new Date(o.posted_date) - new Date(r.posted_date)) <= 3 * DAY));
  if (twin) return { kind: 'duplicate', transaction_id: twin.transaction_id, description: twin.description, posted_date: twin.posted_date, cents: twin.amount_cents };

  const fees = rows.filter((r) => isDrawFee(r) && r.amount_cents < 0);
  if (diff > 0 && fees.length > 0 && !rows.some(isDraw)) return { kind: 'missing_draw', fee_count: fees.length, cents: diff };

  if (Math.abs(diff) < SMALL_CENTS) return { kind: 'small', cents: Math.abs(diff) };
  return diff > 0 ? { kind: 'missing_out', cents: diff } : { kind: 'extra_out', cents: -diff };
}
