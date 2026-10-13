import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statementHint } from './statement-hints.js';

const row = (id, cents, extra = {}) => ({ transaction_id: id, amount_cents: cents, description: `ROW ${id}`, posted_date: '2026-01-10', txn_type: 'purchase', category_name: null, ...extra });

test('adds up: no hint', () => {
  assert.equal(statementHint({ tally: { diff_cents: 0 }, rows: [] }), null);
});

test('a pending wrong-sign finding that closes the gap exactly', () => {
  const s = { tally: { diff_cents: 4000000 }, rows: [row(1, 2000000, { txn_type: 'transfer' }), row(2, -1000)] };
  assert.deepEqual(statementHint(s, [{ id: 77, transaction_id: 1 }]), { kind: 'sign_fix', review_id: 77, transaction_id: 1, cents: 2000000 });
  // Without the finding it's just rows short of money out.
  assert.equal(statementHint(s).kind, 'missing_out');
});

test('a duplicate row worth exactly the gap', () => {
  const s = { tally: { diff_cents: -5323 }, rows: [row(1, -5323, { description: 'AMAZON PAY INDIA' }), row(2, -5323, { description: 'Amazon Pay  India', posted_date: '2026-01-11' }), row(3, -100)] };
  assert.deepEqual(statementHint(s), { kind: 'duplicate', transaction_id: 1, description: 'AMAZON PAY INDIA', posted_date: '2026-01-10', cents: -5323 });
  // Same amount, but weeks apart: two real purchases, not a duplicate.
  const apart = { ...s, rows: [s.rows[0], { ...s.rows[1], posted_date: '2026-02-20' }] };
  assert.equal(statementHint(apart).kind, 'extra_out');
});

test("a transfer fee with no draw beside it: the draw wasn't read", () => {
  const s = { tally: { diff_cents: 760000 }, rows: [row(1, -22800, { txn_type: 'fee', description: 'CASH ADVANCE FEE', category_name: 'Balance Transfer' }), row(2, 5000, { txn_type: 'payment' })] };
  assert.deepEqual(statementHint(s), { kind: 'missing_draw', fee_count: 1, cents: 760000 });
});

test('small gaps, and which way a large one goes', () => {
  assert.deepEqual(statementHint({ tally: { diff_cents: -53 }, rows: [] }), { kind: 'small', cents: 53 });
  assert.deepEqual(statementHint({ tally: { diff_cents: 100000 }, rows: [] }), { kind: 'missing_out', cents: 100000 });
  assert.deepEqual(statementHint({ tally: { diff_cents: -2400 }, rows: [] }), { kind: 'extra_out', cents: 2400 });
});
