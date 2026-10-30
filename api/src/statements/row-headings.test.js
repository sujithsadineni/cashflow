import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowHeadings, isHeading } from './row-headings.js';

// Real heading shapes from several banks; rows and names invented.
const line = (text, top) => ({ text, top });

test('what counts as a heading', () => {
  for (const h of ['Payments', 'Credits', 'New Charges', 'Fees', 'Interest Charged', 'Payments and Other Credits', 'Purchases and Adjustments', 'DEPOSITS AND ADDITIONS', 'Transactions',
    'Credits Amount', 'Other Subtractions - Continued', 'Transactions by Alex Lee']) assert.equal(isHeading(h), true, h);
  for (const h of ['Total New Charges $455.71', 'Summary', 'Detail', 'Detail Continued', 'ALEX LEE', 'Card Ending 7-31111', 'Total Fees for this Period', '2026 Fees and Interest Totals Year-to-Date',
    'Please see the important notices about interest charges on your account below', 'Mobile Payment - Thank You',
    'Updates to Our Deposit Account Agreement', 'Amex Offer Credit', 'Purchase Returns - Samsung', 'ALLSTATE *PAYMENT', 'ACH PAYMENT FROM CHASE ACCOUNT', '(RETURN)']) assert.equal(isHeading(h), false, h);
});

test('each row takes the nearest heading above it, carried onto the next page', () => {
  const pages = [
    { n: 3, lines: [line('Payments and Credits', 0.2), line('Summary', 0.22), line('Payments', 0.4), line('Credits', 0.5), line('New Charges', 0.7), line('Detail', 0.72)] },
    { n: 4, lines: [line('Detail Continued', 0.1), line('Fees', 0.6), line('Interest Charged', 0.8)] },
  ];
  const located = { 1: { page: 3, top: 0.45 }, 2: { page: 3, top: 0.55 }, 3: { page: 3, top: 0.8 }, 4: { page: 4, top: 0.3 }, 5: { page: 4, top: 0.65 }, 6: { page: 4, top: 0.85 }, 7: { page: 3, top: 0.1 } };
  assert.deepEqual(rowHeadings(pages, located), { 1: 'Payments', 2: 'Credits', 3: 'New Charges', 4: 'New Charges', 5: 'Fees', 6: 'Interest Charged' }, 'row 7 has nothing above it');
});

test('a bank statement\'s shouting headings read as titles', () => {
  const pages = [{ n: 1, lines: [line('DEPOSITS AND ADDITIONS', 0.3), line('ELECTRONIC WITHDRAWALS', 0.6), line('Credits Amount', 0.8)] }];
  assert.deepEqual(rowHeadings(pages, { 1: { page: 1, top: 0.4 }, 2: { page: 1, top: 0.7 }, 3: { page: 1, top: 0.9 } }), { 1: 'Deposits and Additions', 2: 'Electronic Withdrawals', 3: 'Credits' });
});
