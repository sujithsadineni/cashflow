import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractRobinhoodSavingsLocally, isRobinhoodSavings, classifySavings } from './pdf-local-robinhood-savings.js';

// The layout is real text captured via stage-1 extraction (pdf-pages.js)
// from a Robinhood Banking savings statement; the holder, address, account
// number and amounts have been replaced with invented ones. The multiple
// spaces are real column artifacts.
const COVER = `Personal Savings 1234
Statement
 March, 2026
 Robinhood Banking services provided by Coastal Community Bank, Member FDIC`;
const SUMMARY = ` Personal Savings 1234
Statement Period
Mar 1 - Mar 31, 2026
Alex James Morgan
 456 Example Ave
Anytown, NC 27000
 Total Ending Balance  Account Summary
 Personal Savings 1234
 Beginning Balance (Mar 1, 2026)   $1,000.00
 $3,452.34
Deposits and Other Credits   $2,550.00
Interest Earned (Mar 2026)   $2.34
Withdrawals and Other Debits   $100.00
Fees   $0.00
 Total Ending Balance (Mar 31, 2026)   $3,452.34
 Robinhood Banking services provided by Coastal Community Bank, Member FDIC   Page 1 of 3`;
const ACTIVITY = ` Personal Savings 1234
Statement Period
Mar 1 - Mar 31, 2026
Account Activity
 DATE   DESCRIPTION   CATEGORY   AMOUNT   BALANCE
 3/1/26   Beginning Balance   $1,000.00
Inter-Entity Transfer from Robinhood
 3/2/26   Credit   $1,050.00 +$50.00  
Investing  
3/5/26   ACH Deposit from Example Bank   Credit   $3,550.00 +$2,500.00  
3/20/26   EXAMPLE-REMIT 1a2b3c4d   Debit   -$100.00   $3,450.00
3/31/26   Interest Payment   Credit   $3,452.34 +$2.34  
 3/31/26   Ending Balance   $3,452.34
 Robinhood Banking services provided by Coastal Community Bank, Member FDIC   Page 2 of 3`;

const pages = (activity = ACTIVITY) => [COVER, SUMMARY, activity].map((text, i) => ({ pageNumber: i + 1, text }));
const read = (activity) => extractRobinhoodSavingsLocally(pages(activity), [], () => null);

test('tells a savings statement from the Gold Card', () => {
  assert.equal(isRobinhoodSavings(COVER), true);
  assert.equal(isRobinhoodSavings('Robinhood Gold Card\nStatement Closing Date September 24, 2026'), false);
});

test('account, period and balances', () => {
  const r = read();
  assert.deepEqual([r.account.mask, r.account.account_type, r.account.holder_name], ['1234', 'SAVINGS', 'Alex James Morgan']);
  assert.deepEqual([r.statement.period_start, r.statement.period_end], ['2026-03-01', '2026-03-31']);
  assert.deepEqual([r.statement.opening_balance_cents, r.statement.closing_balance_cents], [100000, 345234]);
  assert.deepEqual(r.reconciliation, { balances_reconcile: true, running_balance_ok: true });
});

test('a credit prints its balance before its amount, a debit after: the signed one is the amount', () => {
  assert.deepEqual(read().rows.map((x) => x.amount_cents), [5000, 250000, -10000, 234]);
});

test('a description wrapped above and below its row comes back whole', () => {
  assert.equal(read().rows[0].description, 'Inter-Entity Transfer from Robinhood Investing');
  assert.equal(read().rows[1].description, 'ACH Deposit from Example Bank');
});

test('money in from your own accounts is a transfer; interest is interest', () => {
  assert.deepEqual(read().rows.map((x) => [x.txn_type, x.suggested_category]), [['transfer', null], ['transfer', null], ['purchase', null], ['interest', 'Interest']]);
  assert.equal(classifySavings('BARCLAYCARD US ACHBT', 2000000).txn_type, 'transfer');
  assert.equal(classifySavings('SOME EMPLOYER PAYROLL', 100).txn_type, 'deposit');
});

test('a misread balance is caught, and a line it does not know fails the read', () => {
  const r = read(ACTIVITY.replace('$3,450.00', '$3,451.00'));
  assert.equal(r.reconciliation.running_balance_ok, false);
  assert.throws(() => read(ACTIVITY.replace(' 3/31/26   Ending Balance   $3,452.34\n', '')), /Ending Balance/);
  assert.throws(() => read(ACTIVITY.replace('Debit   -$100.00', 'Credit   -$100.00')), /sign/);
});
