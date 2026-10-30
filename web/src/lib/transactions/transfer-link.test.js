import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transferName, transferExplanation } from './transfer-link.js';

const link = (o) => ({ direction: 'from', account_name: 'Chase Total Checking', mask: '5106', accounts_with_name: 1, posted_date: '2026-07-01', description: 'ROBINHOOD MONEY PAYMENT', amount_cents: -600000, ...o });

test('the arrival names where the money came from, the departure where it went', () => {
  assert.equal(transferName(link()), 'From Chase Total Checking');
  assert.equal(transferName(link({ direction: 'to', account_name: 'Personal Savings' })), 'To Personal Savings');
});

test('the last four only when two accounts share the name', () => {
  assert.equal(transferName(link({ account_name: 'Adv SafeBalance Banking', mask: '5115', accounts_with_name: 2 })), 'From Adv SafeBalance Banking ···5115');
});

test('the opened row says when the other half moved and quotes its line', () => {
  const e = transferExplanation(link());
  assert.equal(e.title, 'From Chase Total Checking');
  assert.match(e.lines[0], /left Chase Total Checking on Jul 1, 2026/);
  assert.equal(e.lines[1], 'On that statement: ROBINHOOD MONEY PAYMENT');
  assert.equal(transferExplanation(null), null);
});
