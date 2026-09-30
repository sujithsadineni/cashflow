import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractBiltLocally } from './pdf-local-bilt.js';

// The layout is real text captured via stage-1 extraction (pdf-pages.js)
// from a Bilt statement; the holder, email, addresses and amounts have
// been replaced with invented ones.
// api/scripts/verify-local-bilt.mjs re-checks every real statement on
// disk against the transactions already approved from the AI path;
// this is the fast, no-database unit test for the same parsing logic.
const PAGE_ONE = ` Sam Rivera
Bilt Blue Card
sam.rivera@example.com
May 11 – Jun 11, 2026
New balance   as of Jun 11, 2026  Balance breakdown
 Previous balance   $0.00
 $1,512.40
Payments and credits   -$2,550.00
Purchases (Including New Card Purchases)   $4,062.40
 Minimum payment due  Payment information
 $30.00
 Payment due by  Account summary
 Credit limit   $10,000.00
 Jul 6, 2026
Available credit   $8,487.60
Cardless Inc. is the servicer of the Bilt Cards. Cardless is a financial technology company, not a bank. Bilt Cards
are issued by Column N.A. Member FDIC, pursuant to license from Mastercard International Incorporated.   Page 1 of 6`;

const TXN_PAGE = `Sam Rivera
Bilt Blue Card
sam.rivera@example.com
May 11 – Jun 11, 2026
Payments and credits
 Date   Description   Amount
 May 30, 2026   BILT RENT CHARGE ADJUSTMENT   -$1,650.00
May 12, 2026   BILT RENT CHARGE ADJUSTMENT   -$900.00
Jun 5, 2026   PAYMENT   -$1,512.40
Total payments and credits in this period   -$4,062.40
 Transactions
 Date   Description   Amount
 May 12, 2026   BPS*BILT HOUSING 100 Sample Ave New York 10001 NY $900.00
USA
May 20, 2026   USPS CHANGE OF ADDRESS6060 E PRIMACY PKWY $1.25
800-2383150 38119 TN USA
May 22, 2026   H&M 0123SPRINGFIELD 100 Mall Road $61.20
SPRINGFIELD 30000 GA USA
Total new charges in this period   $962.45
 Cardless Inc. is the servicer of the Bilt Cards. Cardless is a financial technology company, not a bank. Bilt Cards are
Page 2 of 6 issued by Column N.A. Member FDIC, pursuant to license from Mastercard International Incorporated.  `;

const FEES_PAGE = `Sam Rivera
Bilt Blue Card
sam.rivera@example.com
May 11 – Jun 11, 2026
Fees
 Date   Description   Amount
 -   $0.00
Total fees charged in this period   $0.00
 Interest charged
 Date   Description   Amount
 -   $0.00
Total interest for this period   $0.00
Page 3 of 6`;

function buildPages() {
  return [
    { pageNumber: 1, text: PAGE_ONE },
    { pageNumber: 2, text: TXN_PAGE },
    { pageNumber: 3, text: FEES_PAGE },
  ];
}

const CLASSIFICATIONS = [
  { pageNumber: 1, role: 'SUMMARY' },
  { pageNumber: 2, role: 'TRANSACTIONS' },
  { pageNumber: 3, role: 'TRANSACTIONS' },
];

const noCleanup = () => null;

test('extracts account identity by name — Bilt prints no account number anywhere', () => {
  const r = extractBiltLocally(buildPages(), CLASSIFICATIONS, noCleanup);
  assert.equal(r.account.name, 'Bilt Blue Card');
  assert.equal(r.account.mask, null);
  assert.equal(r.account.issuer, 'Bilt');
  assert.equal(r.account.holder_name, 'Sam Rivera');
});

test('extracts the statement period from an en-dash, abbreviated-month range', () => {
  const r = extractBiltLocally(buildPages(), CLASSIFICATIONS, noCleanup);
  assert.equal(r.statement.period_start, '2026-05-11');
  assert.equal(r.statement.period_end, '2026-06-11');
});

test('a purchase-section line becomes a negative purchase row (sign inverted, like BofA)', () => {
  const r = extractBiltLocally(buildPages(), CLASSIFICATIONS, noCleanup);
  const hm = r.rows.find((row) => row.description.startsWith('H&M'));
  assert.equal(hm.amount_cents, -6120);
  assert.equal(hm.txn_type, 'purchase');
});

test('a bare "PAYMENT" line becomes a positive Card Payment, not the generic refund default', () => {
  const r = extractBiltLocally(buildPages(), CLASSIFICATIONS, noCleanup);
  const payment = r.rows.find((row) => row.description === 'PAYMENT');
  assert.equal(payment.amount_cents, 151240);
  assert.equal(payment.txn_type, 'payment');
  assert.equal(payment.suggested_category, 'Card Payment');
});

test('a rent-reversal credit defaults to refund — bilt-rent.js overrides it downstream, not this parser', () => {
  const r = extractBiltLocally(buildPages(), CLASSIFICATIONS, noCleanup);
  const rent = r.rows.find((row) => row.description === 'BILT RENT CHARGE ADJUSTMENT' && row.amount_cents === 165000);
  assert.equal(rent.txn_type, 'refund');
});

test('an address wrapping onto a second physical line merges into the transaction above it, not a new row', () => {
  const r = extractBiltLocally(buildPages(), CLASSIFICATIONS, noCleanup);
  const bilt = r.rows.find((row) => row.description.startsWith('BPS*BILT HOUSING'));
  assert.match(bilt.description, /USA$/);
  assert.equal(r.rows.filter((row) => row.description.startsWith('BPS*BILT HOUSING')).length, 1);
});

test('the empty-fees "-   $0.00" placeholder row is skipped, not parsed as a transaction', () => {
  const r = extractBiltLocally(buildPages(), CLASSIFICATIONS, noCleanup);
  assert.equal(r.rows.some((row) => row.description === '-'), false);
});

test('reconciliation matches the printed section totals against the summed rows', () => {
  const r = extractBiltLocally(buildPages(), CLASSIFICATIONS, noCleanup);
  assert.equal(r.reconciliation.payments_match, true);
  assert.equal(r.reconciliation.purchases_match, true);
});

test('an unparseable FIRST line in a section fails loudly — no prior row in that section to (wrongly) merge it into', () => {
  const brokenPages = buildPages();
  brokenPages[1] = {
    pageNumber: 2,
    text: TXN_PAGE.replace(
      'May 12, 2026   BPS*BILT HOUSING 100 Sample Ave New York 10001 NY $900.00',
      'this is not a transaction line'
    ),
  };
  assert.throws(() => extractBiltLocally(brokenPages, CLASSIFICATIONS, noCleanup), /Couldn't parse/);
});
