import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findDuplicatePairs, pairKey, inOwnPeriod } from './duplicates.js';

// Invented rows in the shapes found in the household's ledger (D328).
const JAN = { period_start: '2025-12-27', period_end: '2026-01-24' };
const FEB = { period_start: '2026-01-25', period_end: '2026-02-24' };
const MAR = { period_start: '2026-02-25', period_end: '2026-03-25' };
let next = 1;
const row = (over) => ({ id: next++, account_id: 9, import_batch_id: 1, posted_date: '2026-01-06', amount_cents: -10000, description: 'AplPay CORNER GROCER #1234 ANYTOWN NC', ...JAN, ...over });

test('two identical rows on the same statement are never a candidate (the same $100 twice for a 5%-back offer)', () => {
  assert.deepEqual(findDuplicatePairs([row({}), row({})]), []);
});

test('the same amount on two statements is a candidate, earlier row first, with its facts', () => {
  const a = row({ import_batch_id: 1, posted_date: '2026-01-24' });
  const b = row({ import_batch_id: 2, posted_date: '2026-01-24', period_start: '2026-01-24', period_end: '2026-02-23' });
  assert.deepEqual(findDuplicatePairs([b, a]), [{ a_id: a.id, b_id: b.id, same_description: true, days_apart: 0, in_overlap: true }]);
});

test('a different description is still a candidate, marked as different (two readers word one purchase differently)', () => {
  const a = row({ import_batch_id: 1, posted_date: '2026-01-23', description: 'CORNER GROCER #1234' });
  const b = row({ import_batch_id: 2, posted_date: '2026-01-25', description: 'Corner Grocer, Anytown', ...FEB });
  assert.deepEqual(findDuplicatePairs([a, b]), [{ a_id: a.id, b_id: b.id, same_description: false, days_apart: 2, in_overlap: false }]);
});

test('descriptions compare the way the import-time flag does: case and punctuation aside', () => {
  const a = row({ import_batch_id: 1, description: 'CORNER GROCER #1234', posted_date: '2026-01-24' });
  const b = row({ import_batch_id: 2, description: 'Corner Grocer 1234', ...FEB, posted_date: '2026-01-25' });
  assert.equal(findDuplicatePairs([a, b])[0].same_description, true);
});

test('never a candidate: another account, another amount, more than 3 days, $0 rows', () => {
  const base = row({ import_batch_id: 1 });
  assert.deepEqual(findDuplicatePairs([base, row({ import_batch_id: 2, account_id: 10 })]), [], 'another card');
  assert.deepEqual(findDuplicatePairs([base, row({ import_batch_id: 2, amount_cents: -10001 })]), [], 'another amount');
  assert.deepEqual(findDuplicatePairs([base, row({ import_batch_id: 2, posted_date: '2026-01-10' })]), [], '4 days apart');
  const zero = { amount_cents: 0, description: 'INTEREST CHARGED ON PURCHASES' };
  assert.deepEqual(findDuplicatePairs([row({ import_batch_id: 1, ...zero }), row({ import_batch_id: 2, ...zero })]), [], '$0.00');
});

test('a pair the household already answered is not asked again', () => {
  const a = row({ import_batch_id: 1 });
  const b = row({ import_batch_id: 2, ...MAR });
  assert.deepEqual(findDuplicatePairs([a, b], new Set([pairKey(b.id, a.id)])), []);
});

test('a day either side of the period is the bank rounding; further out is outside', () => {
  assert.equal(inOwnPeriod(row({ posted_date: '2026-01-25' })), true);
  assert.equal(inOwnPeriod(row({ posted_date: '2026-01-06', ...MAR })), false);
});
