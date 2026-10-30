import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readingLabel } from './reading-label.js';

const first = (n) => n.split(' ')[0];

test('the statement\'s own heading, as words', () => {
  assert.equal(readingLabel({ txn_type: 'payment' }, 'Payments and Other Credits'), 'payments and other credits');
  assert.equal(readingLabel({ txn_type: 'purchase' }, 'New Charges'), 'new charges');
  assert.equal(readingLabel({ txn_type: 'interest' }, 'Interest Charged'), 'interest charged');
  assert.equal(readingLabel({ txn_type: 'purchase' }, 'Transactions by Alex Lee'), 'transactions', 'a card nobody shares');
});

test('a shared card: whose section it is', () => {
  assert.equal(readingLabel({ txn_type: 'purchase', person_name: 'Alex Lee' }, 'New Charges', first), "Alex's transactions");
  assert.equal(readingLabel({ txn_type: 'payment', person_name: 'Jo Lee' }, 'Payments Made by Jo Lee', first), "Jo's payments");
});

test('no heading to go by: the row\'s kind', () => {
  assert.equal(readingLabel({ txn_type: 'fee' }, null), 'fees');
  assert.equal(readingLabel({ txn_type: 'cashback' }, ''), 'credits');
  assert.equal(readingLabel({ txn_type: null }, null), 'the statement');
  assert.equal(readingLabel(null, 'Fees'), null);
});
