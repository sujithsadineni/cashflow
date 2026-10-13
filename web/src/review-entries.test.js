import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entriesFrom, preselect, activeFinding, siblingsOf, approvalsFor } from './review-entries.js';

const finding = (id, transaction_id, check_kind, field, extra = {}) => ({
  id, transaction_id, check_kind, field, current_value: null, suggested_value: null, options: [],
  posted_date: '2026-09-01', description: 'X', merchant: 'Ross', amount_cents: -3751, account_name: 'Card', ...extra,
});

test('entriesFrom: one entry per transaction, type before category, worst tier first then newest', () => {
  const items = [
    finding(1, 10, 'category_missing', 'category', { posted_date: '2026-09-05' }),
    finding(2, 10, 'type_missing', 'txn_type', { posted_date: '2026-09-05' }),
    finding(3, 11, 'type_missing', 'txn_type', { posted_date: '2026-09-09' }),
    finding(4, 12, 'amount_sign', 'amount', { posted_date: '2026-01-01' }),
  ];
  const entries = entriesFrom(items);
  assert.deepEqual(entries.map((e) => e.id), [12, 11, 10]);
  assert.deepEqual(entries[2].findings.map((f) => f.field), ['txn_type', 'category']);
  assert.equal(entries[0].tier, 'fix');
});

test('preselect: the type and strong category evidence, never a "commonly used" guess', () => {
  assert.equal(preselect({ field: 'txn_type', options: [{ value: 'purchase', why: 'Money out on a card' }] }), 'purchase');
  assert.equal(preselect({ field: 'category', options: [{ value: 'Shopping', why: 'Like your other 9 rows from here' }] }), 'Shopping');
  assert.equal(preselect({ field: 'category', options: [{ value: 'Dining', why: 'Often used for purchases' }] }), null);
  assert.equal(preselect({ field: 'category', suggested_value: 'Groceries', options: [] }), 'Groceries');
  assert.equal(preselect({ field: 'category', options: [] }), null);
});

test('activeFinding: number keys go to the first finding not yet picked, then stay on the last', () => {
  const f = [{ id: 1, field: 'txn_type' }, { id: 2, field: 'category' }];
  assert.equal(activeFinding(f, new Set()).id, 1);
  assert.equal(activeFinding(f, new Set([1])).id, 2);
  assert.equal(activeFinding(f, new Set([1, 2])).id, 2);
});

test('siblingsOf: same merchant, same direction of money, same kind of finding', () => {
  const entries = entriesFrom([
    finding(1, 10, 'category_missing', 'category', { merchant: 'Apple', amount_cents: -5000 }),
    finding(2, 11, 'category_missing', 'category', { merchant: 'Apple', amount_cents: -5000 }),
    finding(3, 12, 'category_missing', 'category', { merchant: 'Apple', amount_cents: 500 }),
    finding(4, 13, 'type_missing', 'txn_type', { merchant: 'Apple', amount_cents: -5000 }),
    finding(5, 14, 'category_missing', 'category', { merchant: 'Ross', amount_cents: -5000 }),
  ]);
  const me = entries.find((e) => e.id === 10);
  assert.deepEqual(siblingsOf(me, entries).map((e) => e.id), [11]);
});

test('approvalsFor: the entry and its siblings, but a sibling only gets a type it could have', () => {
  const entry = { findings: [{ id: 1, check_kind: 'type_missing', field: 'txn_type' }, { id: 2, check_kind: 'category_missing', field: 'category' }] };
  const sib = { findings: [
    { id: 3, check_kind: 'type_missing', field: 'txn_type', options: [{ value: 'refund' }] },
    { id: 4, check_kind: 'category_missing', field: 'category' },
  ] };
  assert.deepEqual(approvalsFor(entry, { 1: 'purchase', 2: 'Shopping' }, [sib]), [
    { id: 1, value: 'purchase' }, { id: 2, value: 'Shopping' }, { id: 4, value: 'Shopping' },
  ]);
  assert.deepEqual(approvalsFor(entry, { 1: 'purchase' }), [{ id: 1, value: 'purchase' }]);
});

test('bulkApprovals: a type only goes on rows it fits; a category goes on all (D253)', async () => {
  const { bulkApprovals } = await import('./review-entries.js');
  const out = { findings: [{ id: 1, field: 'txn_type', options: [{ value: 'purchase' }, { value: 'fee' }] }, { id: 2, field: 'category', options: [] }] };
  const back = { findings: [{ id: 3, field: 'txn_type', options: [{ value: 'refund' }] }, { id: 4, field: 'category', options: [] }] };
  assert.deepEqual(bulkApprovals([out, back], 'txn_type', 'purchase'), { approve: [{ id: 1, value: 'purchase' }], skipped: 1 });
  assert.deepEqual(bulkApprovals([out, back], 'category', 'Shopping'), { approve: [{ id: 2, value: 'Shopping' }, { id: 4, value: 'Shopping' }], skipped: 0 });
  assert.deepEqual(bulkApprovals([out, back], 'txn_type', undefined), { approve: [], skipped: 0 });
});
