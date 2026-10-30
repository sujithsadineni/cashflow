import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readTermsNotice } from './notice.js';

// Each bank's real notice wording, shortened.
test('Amex: the effective date and the sections it changes', () => {
  const text = [
    'Notice of Important Changes to Your Card Member Agreement',
    'Summary of Changes, Effective October 8, 2025',
    'Penalty APR and When it Applies We are clarifying the Penalty APR and When it Applies section on page',
    '1 of Part 1 of the Agreement.',
    'Penalty APR for new transactions We are deleting the Penalty APR for new transactions section from',
    'Words we use in the Agreement We are renaming the section Words we use in the Agreement to',
  ].join('\n');
  assert.deepEqual(readTermsNotice(text), {
    effective_on: '2025-10-08', reject_by: null,
    points: ['Penalty APR and When it Applies', 'Penalty APR for new transactions', 'Words we use in the Agreement'],
  });
});

test('Bank of America: slashed dates, bullets, and a reject-by date', () => {
  const text = [
    'Important Changes to Your Account Terms',
    'Revised Terms as of 11/12/2026',
    'Transaction Fees',
    '· Balance Transfer 5% of the amount of each transaction',
    '· Cash Advance',
    'º Direct Deposit and Cash Advance Checks: 5% of the amount of each transaction',
    'Penalty Fee',
    'You can reject the increase to the Transaction Fees by calling us at 866.300.3122 by 11/11/2026, 8:00 PM Eastern',
  ].join('\n');
  assert.deepEqual(readTermsNotice(text), {
    effective_on: '2026-11-12', reject_by: '2026-11-11',
    points: ['Balance Transfer 5% of the amount of each transaction', 'Cash Advance', 'Direct Deposit and Cash Advance Checks: 5% of the amount of each transaction'],
  });
});

test('Barclays: "effective on or after", a reject-by date wrapped onto the next line', () => {
  const text = [
    'You have the right to reject the changes in the Revised Terms table. You can reject the changes by',
    'calling us or writing to us at Card Services, P.O. Box 8804, Wilmington, DE by February 05,',
    '2026 to close your account.',
    'Revised Terms effective on or after February 06, 2026',
    '• Late Payment Up to $41',
    '• Returned Payment Up to $41',
    'Other Changes to Your Cardmember Agreement',
    '• Something past the table',
  ].join('\n');
  assert.deepEqual(readTermsNotice(text), {
    effective_on: '2026-02-06', reject_by: '2026-02-05', points: ['Late Payment Up to $41', 'Returned Payment Up to $41'],
  });
});

test('no notice: a pointer to one elsewhere is not a notice', () => {
  assert.equal(readTermsNotice('Please review the Important Changes to Your Account Terms information detailed at the end.'), null);
});
