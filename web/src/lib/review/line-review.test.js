import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineFlags, readsCleanly, duplicateSides, daysApart, flaggedPending } from './line-review.js';

const row = (over = {}) => ({ review_status: 'PENDING', posted_date: '2026-09-02', description: 'CHIPOTLE 123', merchant: 'Chipotle', amount_cents: -1250, confidence: 'HIGH', duplicate_of_id: null, ...over });

test('a clean pending line has no flags and starts ticked', () => {
  assert.deepEqual(lineFlags(row()), []);
  assert.equal(readsCleanly(row()), true);
});

test('flags come in order: already saved, duplicate, unsure, no date', () => {
  assert.deepEqual(lineFlags(row({ duplicate_of_id: 7, confidence: 'LOW', posted_date: null })), ['duplicate', 'unsure', 'no-date']);
  assert.deepEqual(lineFlags(row({ duplicate_of_id: 7 }), { conflict: true }), ['conflict'], 'a refused approve replaces the fuzzy flag');
});

test('saved and skipped lines are never flagged', () => {
  assert.deepEqual(lineFlags(row({ review_status: 'APPROVED', duplicate_of_id: 7 })), []);
  assert.deepEqual(lineFlags(row({ review_status: 'REJECTED', confidence: 'LOW' })), []);
  assert.equal(readsCleanly(row({ review_status: 'REJECTED' })), false);
});

test('a duplicate is set side by side, field by field', () => {
  const sides = duplicateSides(row({ duplicate_of_id: 7, duplicate_posted_date: '2026-08-31', duplicate_merchant: 'Chipotle', duplicate_description: 'CHIPOTLE 123', duplicate_amount_cents: -1250 }));
  assert.equal(sides.date.same, false);
  assert.equal(sides.merchant.same, true);
  assert.equal(sides.amount.same, true);
  assert.equal(duplicateSides(row()), null);
});

test('days apart, and what Approve all would let through', () => {
  assert.equal(daysApart('2026-09-02', '2026-08-31'), 2);
  assert.equal(daysApart('2026-09-02', '2026-09-02'), 0);
  assert.equal(daysApart(null, '2026-09-02'), null);
  assert.equal(flaggedPending([row(), row({ confidence: 'LOW' }), row({ review_status: 'REJECTED', confidence: 'LOW' })]).length, 1);
});
