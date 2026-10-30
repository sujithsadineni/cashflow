import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  savingsAmountOf,
  savingsBreakdown,
  savingsKindOf,
  savingsKindLabel,
  savingsYear,
  destinationOf,
  linkDestinations,
} from './savings-breakdown.js';
import { spendCents } from './spend.js';

const r = (amount_cents, txn_type, category_name = null, description = 'X', merchant = null) => ({ amount_cents, txn_type, category_name, description, merchant });

test('the lines add up to Savings exactly (income + spend + loan payments)', () => {
  const rows = [
    r(500000, 'deposit', 'Salary'),
    r(-120000, 'purchase', 'Rent'),
    r(2000, 'refund', 'Refund'),
    r(-50000, 'payment', 'Loan'),
    r(-156000, 'savings', 'Savings', 'Apple Gs Savings Transfer 123456789012 Web ID: 2222'),
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

test('Savings explorer kinds reuse the breakdown buckets and present each row’s Savings contribution', () => {
  const rows = [
    { id: 1, account_id: 1, posted_date: '2026-01-02', amount_cents: 50000, txn_type: 'deposit', category_name: null, description: 'Sample Payroll' },
    { id: 2, account_id: 1, posted_date: '2026-01-03', amount_cents: -12000, txn_type: 'purchase', category_name: 'Groceries', description: 'Sample Market' },
    { id: 3, account_id: 1, posted_date: '2026-01-04', amount_cents: -5000, txn_type: 'payment', category_name: 'Loan', description: 'Sample Loan' },
    { id: 4, account_id: 1, posted_date: '2026-01-05', amount_cents: -20000, txn_type: 'savings', category_name: 'Savings', description: 'Sample Reserve Transfer 1234' },
    { id: 5, account_id: 1, posted_date: '2026-01-06', amount_cents: 30000, txn_type: 'transfer', category_name: 'Balance Transfer', description: 'Sample Transfer' },
    { id: 6, account_id: 1, posted_date: '2026-01-07', amount_cents: 1000, txn_type: 'interest', category_name: null, description: 'Sample Interest' },
  ];

  assert.deepEqual(rows.map(savingsKindOf), [
    'income', 'spending', 'loan', 'moved:Sample Reserve', 'borrowed', 'earned',
  ]);
  assert.deepEqual(rows.map(savingsAmountOf), [50000, -12000, -5000, 20000, -30000, -1000]);

  const year = savingsYear({ rows, accounts: [{ id: 1, name: 'Sample Checking' }], year: '2026' });
  assert.equal(year.total_cents, 33000);
  assert.equal(year.months[0].total, 33000);
  assert.equal(year.by_kind['moved:Sample Reserve'], 20000);
  assert.equal(year.items.find((item) => item.id === 4).amount_cents, -20000);
  assert.equal(year.items.find((item) => item.id === 4).measure_cents, 20000);
  assert.equal(year.kind_labels['moved:Sample Reserve'], 'Moved to Sample Reserve');
  assert.equal(savingsKindLabel('card_bills'), 'Card bills between your accounts');
});

test('Savings explorer applies the existing spend clamp to each month and the full year', () => {
  const rows = [
    { id: 1, account_id: 1, posted_date: '2025-01-01', amount_cents: -100, txn_type: 'purchase', category_name: 'Groceries' },
    { id: 2, account_id: 1, posted_date: '2025-02-01', amount_cents: 150, txn_type: 'refund', category_name: 'Groceries' },
  ];
  const year = savingsYear({ rows, accounts: [], year: '2025' });
  assert.equal(year.months[0].total, -100);
  assert.equal(year.months[1].total, 0);
  assert.equal(year.total_cents, 0);
});


test('linkDestinations: a savings move finds its savings/investment account, never a same-brand credit card', () => {
  const lines = [
    { key: 'moved:Robinhood Money', label: 'Moved to Robinhood Money', cents: 2000000 },
    { key: 'moved:Apple Gs Savings', label: 'Moved to Apple Gs Savings', cents: 1560000 },
    { key: 'borrowed', label: 'Borrowed', cents: -100 },
  ];
  const accounts = [
    { id: 16, name: 'Robinhood Gold Card', issuer: 'Robinhood', account_type: 'CREDIT_CARD' },
    { id: 20, name: 'Robinhood', issuer: 'Robinhood', account_type: 'INVESTMENT', balance_cents: 2134000, balance_as_of: '2026-09-30' },
  ];
  const out = linkDestinations(lines, accounts);
  assert.equal(out[0].account.id, 20);
  assert.equal(out[0].account.balance_cents, 2134000);
  assert.equal(out[1].account, undefined);
  assert.equal(out[1].destination, 'Apple Gs Savings');
  assert.equal(out[2].account, undefined);
});
