import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_ACTIVITY, ALL_TRANSACTIONS, keyFor, lookup } from './demo.js';

const RESPONSES = {
  'GET /summary?month=2026-09': { month: '2026-09' },
  'GET /transactions?limit=50': [{ id: 1 }],
  'GET /people': [{ id: 1 }],
  'POST /recurring/detect': [{ name: 'Netflix' }],
};

test('an exact recorded request replays as-is', () => {
  assert.deepEqual(lookup(RESPONSES, keyFor('/summary?month=2026-09')), { month: '2026-09' });
  assert.deepEqual(lookup(RESPONSES, keyFor('/recurring/detect', 'post')), [{ name: 'Netflix' }]);
});

test('an unrecorded filter falls back to the same endpoint', () => {
  assert.deepEqual(lookup(RESPONSES, keyFor('/transactions?limit=50&search=zzz')), [{ id: 1 }]);
  assert.deepEqual(lookup(RESPONSES, keyFor('/people?x=1')), [{ id: 1 }]);
});

test('an unrecorded write has no fallback', () => {
  assert.equal(lookup(RESPONSES, keyFor('/people', 'POST')), undefined);
});

test('the closest recorded filter wins: same merchant, other category', () => {
  const responses = {
    'GET /transactions/merchant-summary?merchant=Costco': { merchant: 'Costco' },
    'GET /transactions/merchant-summary?merchant=Target': { merchant: 'Target' },
  };
  assert.deepEqual(lookup(responses, keyFor('/transactions/merchant-summary?merchant=Target&category_id=4')), { merchant: 'Target' });
});

const ROWS = [
  { id: 3, posted_date: '2026-09-20', description: 'TARGET T-1234', merchant: 'Target', amount_cents: -2500, txn_type: 'purchase', account_id: 2, person_id: 1, category_id: 7, category_name: 'Shopping' },
  { id: 2, posted_date: '2026-09-05', description: 'ACME PAYROLL', merchant: 'Acme Corp', amount_cents: 284000, txn_type: 'deposit', account_id: 1, person_id: 1, category_id: 9, category_name: 'Salary' },
  { id: 1, posted_date: '2026-08-20', description: 'TARGET T-1234', merchant: 'Target', amount_cents: -4000, txn_type: 'purchase', account_id: 2, person_id: 1, category_id: null, category_name: null },
];

test('the transaction list is filtered, totalled and paged from every recorded row', () => {
  const res = lookup({ [ALL_TRANSACTIONS]: ROWS }, keyFor('/transactions?q=target&limit=1'));
  assert.equal(res.total, 2);
  assert.equal(res.out_cents, -6500);
  assert.deepEqual(res.months, { '2026-09': { count: 1, out_cents: -2500, in_cents: 0 }, '2026-08': { count: 1, out_cents: -4000, in_cents: 0 } });
  assert.deepEqual(res.rows.map((r) => r.id), [3]);
  assert.equal(lookup({ [ALL_TRANSACTIONS]: ROWS }, keyFor('/transactions?category_id=none')).total, 1);
  assert.equal(lookup({ [ALL_TRANSACTIONS]: ROWS }, keyFor('/transactions?from=2026-09-01&to=2026-09-30&txn_type=deposit')).rows[0].id, 2);
});

test("a card's category totals come from its rows in the range", () => {
  const res = lookup({ [ALL_TRANSACTIONS]: ROWS }, keyFor('/transactions/category-summary?account_id=2&from=2026-09-01'));
  assert.deepEqual(res.total, { count: 1, in_cents: 0, out_cents: 2500 });
  assert.equal(res.categories[0].category_name, 'Shopping');
});

test("Activity answers one row's own history, an area, and the next page", () => {
  const log = [
    { id: 9, action: 'transaction.edited', entity_type: 'transaction', entity_id: 3 },
    { id: 8, action: 'bill.created', entity_type: 'recurring', entity_id: 1 },
    { id: 7, action: 'transaction.edited', entity_type: 'transaction', entity_id: 4 },
  ];
  const responses = { [ALL_ACTIVITY]: log, [`${ALL_ACTIVITY}?area=recurring`]: [log[1]] };
  assert.deepEqual(lookup(responses, keyFor('/activity?limit=50&entity=transaction%3A3')).map((e) => e.id), [9]);
  assert.deepEqual(lookup(responses, keyFor('/activity?limit=100&area=recurring')).map((e) => e.id), [8]);
  assert.deepEqual(lookup(responses, keyFor('/activity?limit=1&before=9')).map((e) => e.id), [8]);
});
