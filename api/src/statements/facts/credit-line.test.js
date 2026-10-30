import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readCreditLine, creditLineAddsUp } from './credit-line.js';

// Each bank's real wording; the figures are invented.
test('Amex: limit, available, cash advance limit; "Available Cash" is not the cash advance limit', () => {
  const text = 'Credit Limit $9,000.00\nAvailable Credit $8,750.25\nCash Advance Limit $1,800.00\nAvailable Cash $1,800.00';
  assert.deepEqual(readCreditLine(text), { available_credit_cents: 875025, cash_advance_limit_cents: 180000, credit_limit_cents: 900000 });
});

test('Bank of America prints the figure before its label', () => {
  const text = '$ 40,000.00 Total Credit Line\n$ 39,512.10 Total Credit Available\n$ 200.00 Cash Credit Line\nPortion of Credit Available';
  assert.deepEqual(readCreditLine(text), { available_credit_cents: 3951210, cash_advance_limit_cents: 20000, credit_limit_cents: 4000000 });
});

test('Bank of America: the summary box shares a line with the next column; the figure starting the line is the limit', () => {
  const text = '$ 40,000.00 Total Credit Line $40.00 and your APRs may be increased up to the Penalty APR of 29.99%.\n$ 39,512.10 Total Credit Available';
  assert.equal(readCreditLine(text).credit_limit_cents, 4000000);
  // A merged Amex line: the figure before a label isn't its figure unless it starts the line.
  assert.equal(readCreditLine('Minimum Payment Due $35.00 Credit Limit $9,000.00').credit_limit_cents, 900000);
});

test('Barclays, both layouts, with the cash advance line inside the limit\'s sentence', () => {
  assert.deepEqual(readCreditLine('Total Revolving Credit Line $5,000.00\nIncludes $1,000.00 cash advance line\nAvailable Revolving Credit Line $4,900.00'),
    { available_credit_cents: 490000, cash_advance_limit_cents: 100000, credit_limit_cents: 500000 });
  assert.deepEqual(readCreditLine('… total of… Total Credit Line $3,000.00\nAvailable Credit Line $2,500.00'),
    { available_credit_cents: 250000, cash_advance_limit_cents: null, credit_limit_cents: 300000 });
});

test('Zolve prints no dollar sign, and its available limit is not its limit', () => {
  const text = 'Credit Limit   4,000.00 section for important information about your account.\nAvailable Credit Limit   3,600.00\nCash Advance Limit $400.00\nAvailable Cash Advance Limit $400.00';
  assert.deepEqual(readCreditLine(text), { available_credit_cents: 360000, cash_advance_limit_cents: 40000, credit_limit_cents: 400000 });
});

test('Robinhood and Bilt', () => {
  assert.deepEqual(readCreditLine('Credit Limit $10,000.00 New Balance $120.00\nCredit Available $9,880.00'),
    { available_credit_cents: 988000, cash_advance_limit_cents: null, credit_limit_cents: 1000000 });
  assert.equal(readCreditLine('Credit limit $2,500.00\nAvailable credit $2,400.00').credit_limit_cents, 250000);
});

test('a terms-page sentence with no figure reads as not printed (Apple)', () => {
  assert.deepEqual(readCreditLine('We can apply any unpaid amount against your credit limit.'),
    { available_credit_cents: null, cash_advance_limit_cents: null, credit_limit_cents: null });
});

test('available squares with limit less balance only when exact; a credit balance counts as zero owed', () => {
  assert.equal(creditLineAddsUp({ credit_limit_cents: 100000, available_credit_cents: 75000, closing_balance_cents: 25000 }), true);
  assert.equal(creditLineAddsUp({ credit_limit_cents: 100000, available_credit_cents: 70000, closing_balance_cents: 25000 }), false);
  assert.equal(creditLineAddsUp({ credit_limit_cents: 100000, available_credit_cents: 100000, closing_balance_cents: -500 }), true);
  assert.equal(creditLineAddsUp({ credit_limit_cents: null, available_credit_cents: 1, closing_balance_cents: 1 }), null);
});
