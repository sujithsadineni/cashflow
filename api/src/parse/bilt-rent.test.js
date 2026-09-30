import { test } from 'node:test';
import assert from 'node:assert/strict';

import { biltRentRuleFor } from './bilt-rent.js';

test('card-side rent charge is Rent, and does not count as spend (reversed same day)', () => {
  assert.deepEqual(
    biltRentRuleFor('BPS*BILT HOUSING 100 Sample Ave New York 10001 NY USA'),
    { category: 'Rent', txn_type: 'transfer' }
  );
});

test('card-side reversal of the rent charge is Rent, also not spend', () => {
  assert.deepEqual(
    biltRentRuleFor('BILT RENT CHARGE ADJUSTMENT'),
    { category: 'Rent', txn_type: 'transfer' }
  );
});

test('bank-side ACH debit that actually pulls the rent money counts as real spend', () => {
  assert.deepEqual(
    biltRentRuleFor('BILT CARD HOUSING'),
    { category: 'Rent', txn_type: 'purchase' }
  );
});

test('the fixed recurring rent-linked bank charge also counts as real spend', () => {
  assert.deepEqual(
    biltRentRuleFor('BILT PAYMENT BILTRENT'),
    { category: 'Rent', txn_type: 'purchase' }
  );
});

test('the real card statement payment stays Card Payment and excluded from spend', () => {
  assert.deepEqual(
    biltRentRuleFor('BILT CARD PMT'),
    { category: 'Card Payment', txn_type: 'payment' }
  );
});

test('an unrelated description is left alone', () => {
  assert.equal(biltRentRuleFor('COSTCO WHSE #0187 770-622-1330 GA'), null);
});

test('null/empty description does not throw', () => {
  assert.equal(biltRentRuleFor(null), null);
  assert.equal(biltRentRuleFor(''), null);
});
