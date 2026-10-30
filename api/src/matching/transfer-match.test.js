import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchTransfers } from './transfer-match.js';

let id = 0;
const row = (o) => ({ id: ++id, account_id: 1, posted_date: '2026-07-01', amount_cents: -600000, txn_type: 'savings', ...o });

test('money out of one account and the same amount into another a day later are one transfer', () => {
  const out = row({});
  const into = row({ account_id: 2, posted_date: '2026-07-02', amount_cents: 600000, txn_type: 'transfer' });
  assert.deepEqual(matchTransfers([out, into]), [{ out_transaction_id: out.id, in_transaction_id: into.id }]);
});

test('the arrival may post a day before the departure', () => {
  const out = row({ posted_date: '2026-03-25', amount_cents: -10000, txn_type: 'transfer' });
  const into = row({ account_id: 2, posted_date: '2026-03-24', amount_cents: 10000, txn_type: 'transfer' });
  assert.equal(matchTransfers([out, into]).length, 1);
});

test('no link across a week, within one account, or with a different amount', () => {
  const out = row({});
  assert.deepEqual(matchTransfers([out, row({ account_id: 2, posted_date: '2026-07-09', amount_cents: 600000 })]), []);
  assert.deepEqual(matchTransfers([out, row({ posted_date: '2026-07-02', amount_cents: 600000 })]), []);
  assert.deepEqual(matchTransfers([out, row({ account_id: 2, posted_date: '2026-07-02', amount_cents: 599900 })]), []);
});

test('spending and income are never a transfer half', () => {
  const out = row({ txn_type: 'purchase' });
  const into = row({ account_id: 2, posted_date: '2026-07-02', amount_cents: 600000, txn_type: 'deposit' });
  assert.deepEqual(matchTransfers([out, into]), []);
});

test('two arrivals that fit equally leave the departure unlinked', () => {
  const out = row({ amount_cents: -10000, txn_type: 'transfer' });
  const a = row({ account_id: 2, posted_date: '2026-07-02', amount_cents: 10000, txn_type: 'transfer' });
  const b = row({ account_id: 3, posted_date: '2026-07-02', amount_cents: 10000, txn_type: 'transfer' });
  assert.deepEqual(matchTransfers([out, a, b]), []);
});

test('two departures that fit one arrival leave it unlinked', () => {
  const a = row({ amount_cents: -10000, txn_type: 'transfer' });
  const b = row({ account_id: 3, amount_cents: -10000, txn_type: 'transfer' });
  const into = row({ account_id: 2, posted_date: '2026-07-02', amount_cents: 10000, txn_type: 'transfer' });
  assert.deepEqual(matchTransfers([a, b, into]), []);
});

test('account-verification cents are not transfers', () => {
  const out = row({ amount_cents: -45, txn_type: 'transfer' });
  const into = row({ account_id: 2, amount_cents: 45, txn_type: 'transfer' });
  assert.deepEqual(matchTransfers([out, into]), []);
});
