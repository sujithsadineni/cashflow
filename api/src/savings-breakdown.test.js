import { test } from 'node:test';
import assert from 'node:assert/strict';
import { savingsBreakdown, destinationOf, linkDestinations } from './savings-breakdown.js';
import { spendCents } from './spend.js';

const r = (amount_cents, txn_type, category_name = null, description = 'X', merchant = null) => ({ amount_cents, txn_type, category_name, description, merchant });

test('the lines add up to Savings exactly (income + spend + loan payments)', () => {
  const rows = [
    r(500000, 'deposit', 'Salary'),
    r(-120000, 'purchase', 'Rent'),
    r(2000, 'refund', 'Refund'),
    r(-50000, 'payment', 'Loan'),
    r(-156000, 'savings', 'Savings', 'Apple Gs Savings Transfer 910152086830 Web ID: 2222'),
    r(-200000, 'savings', 'Savings', 'Robinhood Money DES:Payment ID: x'),
    r(300000, 'transfer', 'Balance Transfer'),
    r(-30000, 'payment', 'Card Payment'),
    r(30000, 'payment', 'Card Payment'),
    r(1500, 'cashback', 'Cashback'),
  ];
  const savings = 500000 + spendCents(rows) - 50000;
  const { accounts_change_cents, lines } = savingsBreakdown(rows);
  assert.equal(accounts_change_cents + lines.reduce((s, l) => s + l.cents, 0), savings);
  assert.deepEqual(lines.map((l) => [l.label, l.cents]), [
    ['Borrowed (balance transfers)', -300000],
    ['Moved to Robinhood Money', 200000],
    ['Moved to Apple Gs Savings', 156000],
    ['Cashback & interest (not counted as income)', -1500],
  ]); // card bills between own accounts net to zero and are left out
});

test('destinationOf: the name before the bank codes', () => {
  assert.equal(destinationOf(r(0, 'savings', null, 'Robinhood Money Payment PPD ID: 1823032817')), 'Robinhood Money');
  assert.equal(destinationOf(r(0, 'savings', null, 'Apple Gs Savings Transfer 9101', 'Apple')), 'Apple Gs Savings');
});


test('linkDestinations: a savings move finds its savings/investment account, never a same-brand credit card', () => {
  const lines = [
    { key: 'moved:Robinhood Money', label: 'Moved to Robinhood Money', cents: 2000000 },
    { key: 'moved:Apple Gs Savings', label: 'Moved to Apple Gs Savings', cents: 1560000 },
    { key: 'borrowed', label: 'Borrowed', cents: -100 },
  ];
  const accounts = [
    { id: 16, name: 'Robinhood Gold Card', issuer: 'Robinhood', account_type: 'CREDIT_CARD' },
    { id: 20, name: 'Robinhood', issuer: 'Robinhood', account_type: 'INVESTMENT', manual_balance_cents: 2134000, manual_balance_as_of: '2026-09-30' },
  ];
  const out = linkDestinations(lines, accounts);
  assert.equal(out[0].account.id, 20);
  assert.equal(out[0].account.balance_cents, 2134000);
  assert.equal(out[1].account, undefined);
  assert.equal(out[1].destination, 'Apple Gs Savings');
  assert.equal(out[2].account, undefined);
});
