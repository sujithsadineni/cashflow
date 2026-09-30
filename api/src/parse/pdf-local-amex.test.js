import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractAmexLocally } from './pdf-local-amex.js';

// The layout is real text captured via stage-1 extraction from an Amex
// statement; names, card number, merchants' locations and amounts have
// been replaced with invented ones.
// api/scripts/verify-local-amex.mjs re-checks every real statement on
// disk against the transactions already approved from the AI path
// (131/131 matched as of this build); this is the fast, no-database
// unit test for the same parsing logic.
const PAGE_ONE = `p. 1/7 Blue Cash Preferred® from American Express
 Customer Care:   1-888-258-3741  ALEX MORGAN
 TTY:   Use Relay 711 Closing Date 04/24/26
Account Ending 7-21357
 New Balance   $845.20
 Account Summary
 Previous Balance $312.40
Payments/Credits -$879.10
New Charges +$1,428.55`;

const TXN_PAGE = `Blue Cash Preferred® from American Express p. 3/7
 ALEX MORGAN
Account Ending 7-21357 Closing Date 04/24/26
 Payments and Credits
 Summary
 Total
Payments   -$312.40
 Credits
-$5.39
 Total Payments and Credits   -$816.79
 Detail   *Indicates posting date
 Payments   Amount
 03/31/26*   S RIVERA   MOBILE PAYMENT - THANK YOU   -$312.40
 Credits   Amount
$120 Disney Streaming Credit  03/25/26   ALEX MORGAN   -$5.39
DISNEYPLUS
AplPay APPLE STORE R259 R259 04/06/26   S RIVERA   -$499.00
SPRINGFIELD   GA
 New Charges
 Summary
 Total
 ALEX MORGAN 7-21357   $201.33
 Total New Charges   $168.65
 Detail
 ALEX MORGAN
 Card Ending 7-21357
 Amount
AplPay FOOD LION #0123   ANYTOWN   NC  03/28/26   $126.48
GROCERY STORE
AplPay SPICE CORNER   ANYTOWN   NC $42.17  04/03/26
5550100123
 Fees
 Amount
Total Fees for this Period   $0.00
 Interest Charged
 Amount
Total Interest Charged for this Period   $0.00
 About Trailing Interest
 boilerplate legal text follows, not a transaction.`;

function buildPages() {
  return [
    { pageNumber: 1, text: PAGE_ONE },
    { pageNumber: 2, text: 'boilerplate terms and conditions...' },
    { pageNumber: 3, text: TXN_PAGE },
  ];
}

const CLASSIFICATIONS = [
  { pageNumber: 1, role: 'SUMMARY' },
  { pageNumber: 2, role: 'BOILERPLATE' },
  { pageNumber: 3, role: 'TRANSACTIONS' },
];

const noCleanup = () => null;

test('extracts account identity from "Account Ending" (not a clean 4-digit block)', () => {
  const r = extractAmexLocally(buildPages(), CLASSIFICATIONS, noCleanup);
  assert.equal(r.account.issuer, 'American Express');
  assert.equal(r.account.mask, '1357'); // last 4 digits of "7-21357"
  assert.equal(r.account.account_type, 'CREDIT_CARD');
  assert.equal(r.account.holder_name, 'ALEX MORGAN');
});

test('period_end comes from Closing Date; period_start is inferred from the earliest row', () => {
  const r = extractAmexLocally(buildPages(), CLASSIFICATIONS, noCleanup);
  assert.equal(r.statement.period_end, '2026-04-24');
  assert.equal(r.statement.period_start, '2026-03-25'); // earliest of the parsed rows below
});

test('a New Charges line becomes a negative purchase, date-then-amount order', () => {
  const r = extractAmexLocally(buildPages(), CLASSIFICATIONS, noCleanup);
  const foodLion = r.rows.find((row) => row.description.includes('FOOD LION'));
  assert.equal(foodLion.amount_cents, -12648);
  assert.equal(foodLion.txn_type, 'purchase');
  assert.equal(foodLion.posted_date, '2026-03-28');
});

test('the SAME New Charges section also parses amount-then-date order (the household\'s statements mix both)', () => {
  const r = extractAmexLocally(buildPages(), CLASSIFICATIONS, noCleanup);
  const spice = r.rows.find((row) => row.description.includes('SPICE CORNER'));
  assert.equal(spice.amount_cents, -4217);
  assert.equal(spice.posted_date, '2026-04-03');
});

test('a generic bank payment line becomes a positive Card Payment, cardholder name kept in the description', () => {
  const r = extractAmexLocally(buildPages(), CLASSIFICATIONS, noCleanup);
  const payment = r.rows.find((row) => row.txn_type === 'payment');
  assert.equal(payment.amount_cents, 31240);
  assert.equal(payment.suggested_category, 'Card Payment');
  assert.match(payment.description, /MOBILE PAYMENT/);
});

test('a real merchant credit in the Credits section is a Refund, not lumped in with card payments', () => {
  const r = extractAmexLocally(buildPages(), CLASSIFICATIONS, noCleanup);
  const apple = r.rows.find((row) => row.description.includes('APPLE STORE'));
  assert.equal(apple.amount_cents, 49900);
  assert.equal(apple.txn_type, 'refund');
  assert.equal(apple.suggested_category, 'Refund');
});

test('an Amex Offer / Streaming Credit line is a Refund typed as Cashback, distinct from a genuine merchant return', () => {
  const r = extractAmexLocally(buildPages(), CLASSIFICATIONS, noCleanup);
  const disney = r.rows.find((row) => row.description.includes('Streaming Credit'));
  assert.equal(disney.amount_cents, 539);
  assert.equal(disney.txn_type, 'refund');
  assert.equal(disney.suggested_category, 'Cashback');
});

test('a duplicated text-layer line (same content, different incidental whitespace) is not double-counted', () => {
  const dupedPages = buildPages();
  dupedPages[2] = {
    pageNumber: 3,
    text: TXN_PAGE.replace(
      'AplPay FOOD LION #0123   ANYTOWN   NC  03/28/26   $126.48',
      'AplPay FOOD LION #0123   ANYTOWN   NC  03/28/26   $126.48\nAplPay FOOD LION #0123 ANYTOWN NC 03/28/26 $126.48'
    ),
  };
  const r = extractAmexLocally(dupedPages, CLASSIFICATIONS, noCleanup);
  const foodLionRows = r.rows.filter((row) => row.description.includes('FOOD LION'));
  assert.equal(foodLionRows.length, 1);
});

test('reconciliation matches the printed section totals against the summed rows', () => {
  // The fixture's "Total Payments and Credits"/"Total New Charges"
  // lines are set to match this trimmed row set exactly (not copied
  // verbatim from the full real statement, which has more rows than
  // this excerpt keeps) — that's what this test is actually checking.
  const r = extractAmexLocally(buildPages(), CLASSIFICATIONS, noCleanup);
  assert.equal(r.reconciliation.payments_match, true);
  assert.equal(r.reconciliation.charges_match, true);
});
