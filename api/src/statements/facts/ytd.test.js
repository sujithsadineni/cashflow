import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readYtd, ytdAddsUp, periodCharges } from './ytd.js';

// Each bank's real wording; the figures are invented.
test('Amex', () => {
  assert.deepEqual(readYtd('2026 Fees and Interest Totals Year-to-Date\nTotal Fees in 2026 $39.00\nTotal Interest in 2026 $12.34'),
    { ytd_year: 2026, ytd_fees_cents: 3900, ytd_interest_cents: 1234 });
});

test('Bank of America, Barclays, Bilt, Robinhood', () => {
  assert.deepEqual(readYtd('2026 Totals Year-to-Date\nTotal fees charged in 2026 $0.00\nTotal interest charged in 2026 $5.67'),
    { ytd_year: 2026, ytd_fees_cents: 0, ytd_interest_cents: 567 });
});

test('Zolve: both labels on one line, both figures on the next', () => {
  assert.deepEqual(readYtd('TOTALS YEAR-TO-DATE\nTotal Fees Charged in 2026 Total Interest Charged in 2026\n$25.00 $1,002.50\nDETAILS ABOUT APR'),
    { ytd_year: 2026, ytd_fees_cents: 2500, ytd_interest_cents: 100250 });
});

test('Apple: the figure first, interest only', () => {
  assert.deepEqual(readYtd('2026 Total Year-to-Date: Annual Percentage Rate (APR) 19.49 % (variable)\n$3.21 – Total interest charged in 2026 Balance subject to interest rate $100.00'),
    { ytd_year: 2026, ytd_fees_cents: null, ytd_interest_cents: 321 });
});

test('a statement without the box', () => {
  assert.deepEqual(readYtd('Previous Balance $1.00'), { ytd_year: null, ytd_fees_cents: null, ytd_interest_cents: null });
});

const ytd = (year, fees, interest) => ({ year, ytd_fees_cents: fees, ytd_interest_cents: interest });

test('this year-to-date less the previous one is what this period charged', () => {
  assert.deepEqual(ytdAddsUp(ytd(2026, 3900, 1234), ytd(2026, 3900, 1000), { fees_cents: 0, interest_cents: 234 }), { fees: true, interest: true });
  assert.deepEqual(ytdAddsUp(ytd(2026, 3900, 1234), ytd(2026, 0, 1000), { fees_cents: 0, interest_cents: 234 }), { fees: false, interest: true }, 'a fee the rows don\'t have');
});

test('the first statement of a year compares with zero; with no previous statement it can\'t be checked', () => {
  assert.deepEqual(ytdAddsUp(ytd(2026, 0, 500), ytd(2025, 900, 9000), { fees_cents: 0, interest_cents: 500 }), { fees: true, interest: true });
  assert.equal(ytdAddsUp(ytd(2026, 0, 500), null, { fees_cents: 0, interest_cents: 500 }), null);
  assert.equal(ytdAddsUp(ytd(2026, null, null), ytd(2026, 0, 0), { fees_cents: 0, interest_cents: 0 }), null);
  assert.deepEqual(ytdAddsUp(ytd(2026, null, 500), ytd(2026, null, 200), { fees_cents: 0, interest_cents: 300 }), { fees: null, interest: true }, 'Apple has no fees line');
});

const row = (txn_type, amount_cents, description = '', category_name = null) => ({ txn_type, amount_cents, description, category_name });

test('a period\'s fees and interest are net of the ones the bank gave back', () => {
  assert.deepEqual(periodCharges([
    row('fee', -2900, 'RETURNED PAYMENT FEE', 'Bank Fees'),
    row('refund', 2900, 'Credit Adjustment for Returned Payment Fee', 'Interest'), // the words win over the category
    row('interest', -1094, 'Financial Charges - Interest', 'Interest'),
    row('refund', 1020, 'Reversal Transaction [Financial Charges - Interest', 'Refund'),
    row('interest', 0, 'INTEREST CHARGED ON PURCHASES', 'Interest'),
    row('refund', 500, 'SHOE STORE RETURN', 'Refund'), // a merchant's refund counts for neither
    row('purchase', -900, 'CAFE', 'Dining'),
  ]), { fees_cents: 0, interest_cents: 74, fees_charged_cents: 2900, interest_charged_cents: 1094 });
});

test('a bank that counts a reversed fee as still charged passes too', () => {
  const period = periodCharges([row('refund', 9999, 'ANNUAL FEE REVERSAL', 'Annual Fee')]);
  assert.deepEqual(ytdAddsUp(ytd(2026, 9999, 0), ytd(2026, 9999, 0), period), { fees: true, interest: true }, 'Zolve: fees charged stays');
  assert.deepEqual(ytdAddsUp(ytd(2026, 0, 0), ytd(2026, 9999, 0), period), { fees: true, interest: true }, 'a bank that nets it');
  assert.deepEqual(ytdAddsUp(ytd(2026, 5000, 0), ytd(2026, 9999, 0), period).fees, false);
});
