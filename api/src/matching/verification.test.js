import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findVerification } from './verification.js';

const r = (posted_date, amount_cents, description = 'SOMETHING', account_id = 1) => ({ account_id, posted_date, amount_cents, description });
const idx = (rows) => [...findVerification(rows)].sort((a, b) => a - b);

test("the bank's own label marks it, on small amounts only", () => {
  assert.deepEqual(idx([r('2026-04-30', 9, 'APPLE GS SAVINGS ACCTVERIFY'), r('2026-05-01', -26, 'APPLE GS SAVINGS ACCTVERIFY')]), [0, 1]);
  assert.deepEqual(idx([r('2026-04-30', 50000, 'ACCTVERIFY')]), []); // $500 is not a micro-deposit
});

test('no label: two small credits and a debit of exactly their sum within a week', () => {
  const rows = [r('2026-05-04', 31), r('2026-05-04', 37), r('2026-05-05', -68), r('2026-05-06', -40)];
  assert.deepEqual(idx(rows), [0, 1, 2]);
});

test('small cashback, interest and purchases that happen not to sum are left alone', () => {
  assert.deepEqual(idx([r('2026-03-05', 30, 'BANKAMERIDEALS CASHBACK'), r('2026-03-19', 40, 'BANKAMERIDEALS CASHBACK'), r('2026-03-20', -70)]), []); // credits 14 days apart
  assert.deepEqual(idx([r('2026-01-01', 20), r('2026-01-02', 30), r('2026-01-03', -49)]), []); // not the exact sum
  assert.deepEqual(idx([r('2026-01-01', 20), r('2026-01-02', 30, 'x', 2), r('2026-01-03', -50)]), []); // different accounts
  assert.deepEqual(idx([r('2026-01-01', 20), r('2026-01-02', 30), r('2026-01-20', -50)]), []); // pulled back too late
});
