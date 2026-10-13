import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractSofiLocally, classifySofi } from './pdf-local-sofi.js';
import { guessIssuerFromPageOne } from './layout-cache.js';

// The layout is real SoFi text (D216); the name, address, account
// numbers, merchants and amounts are invented. A Savings section with no
// rows follows the Checking one, as on every real statement.
const PAGE_ONE = `Primary Account Holder Address Account Number
Alex James Morgan 12 Elm St 411060000123
Member since Mar 24, 2026 Monthly Statement Period
Anytown, GA 30000 Aug 1, 2026 - Aug 31, 2026
 Checking Account - 0123
1 1
 Current Balance Monthly Interest Paid  Annual Percentage Yield Earned
 $1,904.90  $4.90  0.50%
 as of Aug 31, 2026
 Beginning Balance Year-to-date Interest Paid
 $2,000.00  $17.18
 as of Aug 1, 2026
 Transaction Details
 Checking Account - 0123
 DATE   TYPE   DESCRIPTION   AMOUNT   BALANCE
 Aug 31, 2026   Interest Earned   Interest earned $4.90   $1,904.90
Transaction ID: 9-1
Aug 30, 2026   Direct Payment   BILT CARD HOUSING -$1,500.00   $1,900.00
Transaction ID: 8-1
Aug 27, 2026   Direct Deposit   ACME CORP PAYROLL $2,000.00   $3,400.00
Transaction ID: 7-1
Aug 18, 2026   Direct Payment   AMEX EPAYMENT ACH PMT -$100.00   $1,400.00
Transaction ID: 6-1
Aug 18, 2026   Direct Payment   AMEX EPAYMENT ACH PMT -$100.00   $1,500.00
Transaction ID: 5-1
 SoFi Checking and Savings accounts are offered through SoFi Bank, N.A., Member FDIC   Page 1 of 3`;

const PAGE_TWO = `Checking Account - 0123
 Aug 12, 2026   Direct Payment   Zelle® Payment from Sam Lee $200.00   $1,600.00
Transaction ID: 4-1
Aug 6, 2026   Withdrawal   BANK OF AMERICA, N.A. -$600.00   $1,400.00
Transaction ID: 3-1
 SoFi Checking and Savings accounts are offered through SoFi Bank, N.A., Member FDIC   Page 2 of 3`;

const SAVINGS = `Primary Account Holder Address Account Number
Alex James Morgan 12 Elm St 310070000456
 Savings Account - 0456
 Current Balance Monthly Interest Paid  Annual Percentage Yield Earned
 $0.00  $0.00  0.00%
 Beginning Balance Year-to-date Interest Paid
 $0.00  $0.00
 DATE   TYPE   DESCRIPTION   AMOUNT   BALANCE`;

const pages = (...texts) => texts.map((text, i) => ({ pageNumber: i + 1, text }));
const noCleanup = () => null;

test('SoFi is recognised by its own footer, not by a card payment on page 1', () => {
  // Page 1 lists "AMEX EPAYMENT" and "BILT CARD HOUSING"; the name search alone guessed another bank.
  assert.equal(guessIssuerFromPageOne(PAGE_ONE), 'sofi');
});

test('account, holder, period and balances from the Checking section', () => {
  const r = extractSofiLocally(pages(PAGE_ONE, PAGE_TWO, SAVINGS), [], noCleanup);
  assert.deepEqual(r.account, { name: null, issuer: 'SoFi', mask: '0123', account_type: 'CHECKING', holder_name: 'Alex James Morgan' });
  assert.equal(r.statement.period_start, '2026-08-01');
  assert.equal(r.statement.period_end, '2026-08-31');
  assert.equal(r.statement.opening_balance_cents, 200000);
  assert.equal(r.statement.closing_balance_cents, 190490);
});

test('rows oldest first, across pages, with the printed sign; two identical payments both kept', () => {
  const r = extractSofiLocally(pages(PAGE_ONE, PAGE_TWO, SAVINGS), [], noCleanup);
  assert.deepEqual(r.rows.map((x) => [x.posted_date, x.amount_cents]), [
    ['2026-08-06', -60000], ['2026-08-12', 20000], ['2026-08-18', -10000], ['2026-08-18', -10000],
    ['2026-08-27', 200000], ['2026-08-30', -150000], ['2026-08-31', 490],
  ]);
  assert.equal(r.rows[0].description, 'BANK OF AMERICA, N.A.');
  assert.equal(r.rows.at(-1).description, 'Interest earned');
});

test('reconciles: opening + rows = closing, and every printed running balance', () => {
  const r = extractSofiLocally(pages(PAGE_ONE, PAGE_TWO, SAVINGS), [], noCleanup);
  assert.deepEqual(r.reconciliation, { balances_reconcile: true, running_balance_ok: true });
  // A misread amount breaks the running balance at that row.
  const broken = extractSofiLocally(pages(PAGE_ONE.replace('ACME CORP PAYROLL $2,000.00', 'ACME CORP PAYROLL $2,100.00'), PAGE_TWO, SAVINGS), [], noCleanup);
  assert.equal(broken.reconciliation.running_balance_ok, false);
  assert.match(broken.reconciliation.running_balance_breaks[0], /ACME CORP PAYROLL/);
});

test('types: interest, card bill, rent through Bilt, payroll, Zelle in, transfer to another bank, bonus', () => {
  const t = (type, desc, cents) => classifySofi(type, desc, cents).txn_type;
  assert.equal(t('Interest Earned', 'Interest earned', 490), 'interest');
  assert.equal(t('Direct Payment', 'AMEX EPAYMENT ACH PMT', -10000), 'payment');
  assert.equal(t('Direct Payment', 'BILT CARD PMT', -10000), 'payment');
  assert.equal(t('Direct Payment', 'BANK OF AMERICA PAYMENT', -10000), 'payment');
  assert.equal(t('Direct Payment', 'BILT CARD HOUSING', -150000), 'purchase'); // rent, not a card bill
  assert.equal(t('Direct Payment', 'BILT PAYMENT BILTRENT', -25000), 'purchase');
  assert.equal(t('Direct Deposit', 'ACME CORP PAYROLL', 200000), 'deposit');
  assert.equal(t('Withdrawal', 'BANK OF AMERICA, N.A.', -60000), 'transfer');
  assert.equal(t('Deposit', 'BANK OF AMERICA, N.A.', 10000), 'transfer');
  assert.equal(t('Deposit', 'BANK OF AMERICA ACCTVERIFY', 31), 'deposit'); // left to the verification rule
  assert.equal(t('Bonus', 'Money Referral Bonus', 10000), 'cashback');
  assert.equal(t('Other', 'SoFi Rewards Redemption', 205), 'cashback');
  assert.equal(t('Debit Card', 'CORNER CAFE', -1200), 'purchase');
});

test("a row type it doesn't know stops the read instead of guessing", () => {
  const odd = PAGE_ONE.replace('Direct Deposit   ACME', 'Crypto Sale   ACME');
  assert.throws(() => extractSofiLocally(pages(odd, PAGE_TWO, SAVINGS), [], noCleanup), /type this reader doesn't know yet: "Crypto Sale"/);
});

test('rows in another account’s section are never dropped silently', () => {
  const savingsWithRow = `${SAVINGS}\n Aug 15, 2026   Deposit   ACME CORP $50.00   $50.00\nTransaction ID: 1-1`;
  const r = extractSofiLocally(pages(PAGE_ONE, PAGE_TWO, savingsWithRow), [], noCleanup);
  assert.equal(r.reconciliation.other_account_rows_not_read, 1);
  assert.equal(r.rows.length, 7);
});
