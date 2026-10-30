import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSavings } from './savings.js';

// Each bank's real wording; the figures are invented.
test('Robinhood Savings: each figure beside its label', () => {
  const text = 'Beginning Balance (Sep 1, 2026) $10,000.00\nInterest Earned (Sep 2026) $30.12\nTax Withheld $0.00\nTotal Ending Balance (Sep 30, 2026) $10,030.12\nAnnual Percentage Yield Earned 3.61%\nInterest Paid This Year $250.40\nTax Withheld This Year $0.00';
  assert.deepEqual(readSavings(text), { apy_bps: 361, interest_cents: 3012, interest_ytd_cents: 25040, tax_withheld_ytd_cents: 0, tax_withheld_cents: 0 });
});

test('SoFi: figures on the line under their labels, the first block only', () => {
  const block = (bal, int, apy, ytd) => `Current Balance Monthly Interest Paid Annual Percentage Yield Earned\n$${bal} $${int}${apy}%\nas of Sep 30, 2026\nBeginning Balance Year-to-date Interest Paid\n$900.00 $${ytd}\nas of Sep 1, 2026`;
  assert.deepEqual(readSavings(`${block('1,000.00', '1.23', '0.50', '9.87')}\n${block('5.00', '0.00', '4.00', '0.10')}`),
    { apy_bps: 50, interest_cents: 123, interest_ytd_cents: 987 });
});

test('a checking statement that prints none of it', () => {
  assert.equal(readSavings('Beginning balance on September 1, 2026 $1.00\nEnding balance on September 30, 2026 $2.00'), null);
});
