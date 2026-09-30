import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractBofaLocally } from './pdf-local-bofa.js';

// The layout is real text captured via stage-1 extraction (pdf-pages.js)
// from a BofA statement; the holder, address, card number and amounts
// have been replaced with invented ones.
// api/scripts/verify-local-bofa.mjs re-checks every real statement on
// disk against the transactions already approved from the AI path;
// this is the fast, no-database unit test for the same parsing logic.
const PAGE_ONE = ` Customer Service Information:
www.bankofamerica.com
1.800.421.2110
Mail billing inquiries to:
P.O. BOX 15284
Bank of America
WILMINGTON, DE 19850
 ALEX JAMES MORGAN
123 SAMPLE ST
ANYTOWN NC 27000-0001
Visa Signature®
Account# 4111 2222 3333 2468
August 14 - September 13, 2026
-$ 305.98  New Balance Total
 Account Summary/Payment Information
$ 0.00  Current Payment Due
$ 512.35  Previous Balance
$ 0.00  Total Minimum Payment Due   -$ 982.00
 Payments and Other Credits
 Payment Due Date   10/10/2026 $ 341.20  Purchases and Adjustments
 Fees Charged   $ 0.00
$ 0.00  Interest Charged  `;

const REWARDS_PAGE = ` ALEX JAMES MORGAN   !   Account # 4111 2222 3333 2468   !   August 14 - September 13, 2026
 Important Messages
 Your Reward Summary
 1.42   Base Cash Back Earned
 Make the most of your
1.18   Category Bonus Earned
rewards program today!
.33   Relationship Bonus Earned
187.64   Total Cash Back Available`;

const TXN_PAGE = `ALEX JAMES MORGAN   !   Account # 4111 2222 3333 2468   !   August 14 - September 13, 2026
 Transactions
 Transaction Posting Reference Account
Date Date   Description Number Number   Amount   Total
Payments and Other Credits
08/21   08/24   BA ELECTRONIC PAYMENT   5147   2468   - 850.00
09/02   09/03   ALLSTATE   *PAYMENT   800-255-7828 IL   3021   2468   - 132.00
TOTAL PAYMENTS AND OTHER CREDITS FOR THIS PERIOD   - $982.00
Purchases and Adjustments
08/14   08/15   WAL-MART #1234   ANYTOWN   NC   4410   2468   14.27
08/20   08/21   Cinemark   800-2463627 TX   6093   2468   18.40
08/20   08/21   ALLSTATE   *PAYMENT   800-255-7828 IL   2288   2468   132.00
TOTAL PURCHASES AND ADJUSTMENTS FOR THIS PERIOD   $164.67
Interest Charged
09/13   09/13   INTEREST CHARGED ON PURCHASES   0.00
09/13   09/13   INTEREST CHARGED ON BALANCE TRANSFERS   0.00
TOTAL INTEREST CHARGED FOR THIS PERIOD   $0.00
 2026 Totals Year-to-Date
 Interest Charge Calculation
 Your Annual Percentage Rate (APR) is the annual interest rate on your account.`;

function buildPages() {
  return [
    { pageNumber: 1, text: PAGE_ONE },
    { pageNumber: 2, text: 'boilerplate terms and conditions...' },
    { pageNumber: 3, text: TXN_PAGE },
    { pageNumber: 4, text: REWARDS_PAGE },
  ];
}

const CLASSIFICATIONS = [
  { pageNumber: 1, role: 'SUMMARY' },
  { pageNumber: 2, role: 'BOILERPLATE' },
  { pageNumber: 3, role: 'TRANSACTIONS' },
  { pageNumber: 4, role: 'SUMMARY' },
];

const noCleanup = () => null;

test('extracts account identity', () => {
  const r = extractBofaLocally(buildPages(), CLASSIFICATIONS, noCleanup);
  assert.equal(r.account.issuer, 'Bank of America');
  assert.equal(r.account.mask, '2468');
  assert.equal(r.account.account_type, 'CREDIT_CARD');
  assert.equal(r.account.holder_name, 'ALEX JAMES MORGAN');
});

test('extracts the statement period, handling no year rollover', () => {
  const r = extractBofaLocally(buildPages(), CLASSIFICATIONS, noCleanup);
  assert.equal(r.statement.period_start, '2026-08-14');
  assert.equal(r.statement.period_end, '2026-09-13');
});

test('balance fields keep the printed sign; totals get negated to match this app', () => {
  const r = extractBofaLocally(buildPages(), CLASSIFICATIONS, noCleanup);
  assert.equal(r.statement.opening_balance_cents, 51235); // printed positive, stays positive
  assert.equal(r.statement.closing_balance_cents, -30598); // printed negative, stays negative
  assert.equal(r.statement.total_spend_cents, -16467); // printed +$164.67, negated
  assert.equal(r.statement.total_payments_cents, 98200); // printed -$982.00, negated
});

test('cashback earned sums the three printed components, not the lifetime balance', () => {
  const r = extractBofaLocally(buildPages(), CLASSIFICATIONS, noCleanup);
  assert.equal(r.statement.cashback_earned_cents, 293); // 1.42 + 1.18 + 0.33
  assert.equal(r.statement.cashback_balance_cents, 18764);
});

test('a purchase-section line becomes a negative purchase row', () => {
  const r = extractBofaLocally(buildPages(), CLASSIFICATIONS, noCleanup);
  const walmart = r.rows.find((row) => row.description.startsWith('WAL-MART'));
  assert.equal(walmart.amount_cents, -1427);
  assert.equal(walmart.txn_type, 'purchase');
  assert.equal(walmart.posted_date, '2026-08-15'); // the POSTING date, second column
});

test('a generic electronic payment in the credits section becomes a positive Card Payment', () => {
  const r = extractBofaLocally(buildPages(), CLASSIFICATIONS, noCleanup);
  const payment = r.rows.find((row) => row.description === 'BA ELECTRONIC PAYMENT');
  assert.equal(payment.amount_cents, 85000);
  assert.equal(payment.txn_type, 'payment');
  assert.equal(payment.suggested_category, 'Card Payment');
});

test('the SAME merchant appearing as both a purchase and a credit gets different txn_types', () => {
  // The exact real-world case that would break a rule like "everything
  // in Payments and Other Credits is a card payment" — Allstate shows
  // up once as a real purchase and once as a credit for it.
  const r = extractBofaLocally(buildPages(), CLASSIFICATIONS, noCleanup);
  const allstateRows = r.rows.filter((row) => row.description.includes('ALLSTATE'));
  assert.equal(allstateRows.length, 2);
  const purchase = allstateRows.find((row) => row.amount_cents < 0);
  const credit = allstateRows.find((row) => row.amount_cents > 0);
  assert.equal(purchase.txn_type, 'purchase');
  assert.equal(credit.txn_type, 'refund');
});

test('interest lines use the issuer as merchant and the simple (no ref#) column form', () => {
  const r = extractBofaLocally(buildPages(), CLASSIFICATIONS, noCleanup);
  const interest = r.rows.filter((row) => row.txn_type === 'interest');
  assert.equal(interest.length, 2);
  assert.equal(interest[0].merchant, 'Bank of America');
  assert.equal(interest[0].suggested_category, 'Interest');
});

test('reconciliation matches the printed section totals against the summed rows', () => {
  // This fixture is a trimmed excerpt (fewer rows than the real
  // statement), so its opening/closing balance figures — carried over
  // verbatim from the source statement's layout — don't reconcile against this
  // shorter row set; that's an artifact of trimming the fixture, not
  // something this test is meant to prove. The full balance identity
  // (opening - net of every row = closing) is checked against real,
  // untrimmed statements by api/scripts/verify-local-bofa.mjs instead.
  const r = extractBofaLocally(buildPages(), CLASSIFICATIONS, noCleanup);
  assert.equal(r.reconciliation.payments_match, true);
  assert.equal(r.reconciliation.purchases_match, true);
});

test('an unparseable line inside a known section fails loudly instead of dropping it', () => {
  const brokenPages = buildPages();
  brokenPages[2] = {
    pageNumber: 3,
    text: TXN_PAGE.replace('08/14   08/15   WAL-MART #1234   ANYTOWN   NC   4410   2468   14.27', 'this is not a transaction line'),
  };
  assert.throws(() => extractBofaLocally(brokenPages, CLASSIFICATIONS, noCleanup), /Couldn't parse/);
});
