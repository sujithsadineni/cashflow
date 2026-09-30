import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countsAsSpend, spendCents } from './spend.js';

test('purchases, fees and interest charged are spend; card payments, transfers and savings are not', () => {
  assert.equal(countsAsSpend({ amount_cents: -5000, txn_type: 'purchase' }), true);
  assert.equal(countsAsSpend({ amount_cents: -9500, txn_type: 'fee' }), true);
  assert.equal(countsAsSpend({ amount_cents: -5000, txn_type: null }), true);
  assert.equal(countsAsSpend({ amount_cents: -73226, txn_type: 'payment' }), false);
  assert.equal(countsAsSpend({ amount_cents: -50000, txn_type: 'transfer' }), false);
  assert.equal(countsAsSpend({ amount_cents: -20000, txn_type: 'savings' }), false);
  assert.equal(countsAsSpend({ amount_cents: 284000, txn_type: 'deposit' }), false);
});

test('a refund reduces spend', () => {
  assert.equal(countsAsSpend({ amount_cents: 2210, txn_type: 'refund' }), true);
  assert.equal(spendCents([{ amount_cents: -5000, txn_type: 'purchase' }, { amount_cents: 2000, txn_type: 'refund' }]), -3000);
});

test('the card-bill case: a purchase and the payment of it count once, not twice', () => {
  const rows = [
    { amount_cents: -12000, txn_type: 'purchase' }, // on the card
    { amount_cents: 12000, txn_type: 'payment' }, // the card receiving the payment
    { amount_cents: -12000, txn_type: 'payment' }, // checking paying the card
  ];
  assert.equal(spendCents(rows), -12000);
});

test('never positive, like summary.js: a refund-only day is zero spend, not income', () => {
  assert.equal(spendCents([{ amount_cents: 4500, txn_type: 'refund' }]), 0);
  assert.equal(spendCents([]), 0);
});
