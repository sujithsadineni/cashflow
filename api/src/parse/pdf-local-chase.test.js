import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractChaseLocally } from './pdf-local-chase.js';

// The layout is real text captured via stage-1 extraction (pdf-pages.js)
// from a Chase statement; the holder, address, account number, employer
// and amounts have been replaced with invented ones.
// api/scripts/verify-local-chase.mjs re-checks every real statement on
// disk against the transactions already approved from the AI path;
// this is the fast, no-database unit test for the same parsing logic.
//
// The multiple internal spaces ("June   23,   2026") are real, not a
// typo — a column-layout artifact of this issuer's text extraction
// that every regex in the parser has to tolerate.
const PAGE_ONE = `June 23, 2026 through July 21, 2026
 JPMorgan Chase Bank, N.A.
Account Number: 000000123455678
P O Box 44959
Indianapolis, IN 46244 - 4959
CUSTOMER   SERVICE   INFORMATION
Web   site:  Chase.com
Service   Center: 1-800-935-9935
International   Calls:   1-713-262-1679 ALEX   JAMES   MORGAN
We   accept   operator   relay   calls 456   EXAMPLE   AVE   APT   100
ANYTOWN   NC   27000-0002
 *start*summary
Chase   Total   Checking
CHECKING   SUMMARY
 AMOUNT
Beginning   Balance   $318.40
Deposits   and   Additions   5,420.00
Electronic   Withdrawals   -5,312.75
Ending   Balance   $425.65
*end*summary
*start*transaction detail
TRANSACTION   DETAIL
DATE   DESCRIPTION   AMOUNT   BALANCE
Beginning   Balance   $318.40
06/30   Acme   Corp   Payroll   PPD   ID:   9000000001   5,420.00 5,738.40
07/01   Robinhood   Money   Payment   PPD   ID:   1823032817   -4,800.00   938.40
07/13   Wells   Fargo   Auto   Draft   PPD   ID:   0122287170   -512.75   425.65
Ending   Balance   $425.65
*end*transaction detail
Page   1   of 2`;

const BOILERPLATE_PAGE = `June 23, 2026 through July 21, 2026
IN CASE OF ERRORS OR QUESTIONS ABOUT YOUR ELECTRONIC FUNDS TRANSFERS:
JPMorgan Chase Bank, N.A. Member FDIC
Page   2   of 2`;

function buildPages() {
  return [
    { pageNumber: 1, text: PAGE_ONE },
    { pageNumber: 2, text: BOILERPLATE_PAGE },
  ];
}

// classify.js's real role for page 2 here is BOILERPLATE, not
// TRANSACTIONS — the whole reason extractChaseLocally scans every
// page's text for Chase's own "*start*transaction detail" marker
// instead of trusting this classification array for page selection
// (confirmed against a real statement with a sparse continuation
// page — see this file's own comment in pdf-local-chase.js).
const CLASSIFICATIONS = [
  { pageNumber: 1, role: 'TRANSACTIONS' },
  { pageNumber: 2, role: 'BOILERPLATE' },
];

const noCleanup = () => null;

test('extracts account identity', () => {
  const r = extractChaseLocally(buildPages(), CLASSIFICATIONS, noCleanup);
  assert.equal(r.account.issuer, 'Chase');
  assert.equal(r.account.mask, '5678');
  assert.equal(r.account.account_type, 'CHECKING');
  assert.equal(r.account.holder_name, 'ALEX JAMES MORGAN');
});

test('extracts the statement period from a "through" date range', () => {
  const r = extractChaseLocally(buildPages(), CLASSIFICATIONS, noCleanup);
  assert.equal(r.statement.period_start, '2026-06-23');
  assert.equal(r.statement.period_end, '2026-07-21');
});

test('amounts are taken as printed, no sign inversion (unlike a credit card)', () => {
  const r = extractChaseLocally(buildPages(), CLASSIFICATIONS, noCleanup);
  const payroll = r.rows.find((row) => row.description.includes('Payroll'));
  assert.equal(payroll.amount_cents, 542000);
  assert.equal(payroll.txn_type, 'deposit');

  const wellsFargo = r.rows.find((row) => row.description.includes('Wells Fargo'));
  assert.equal(wellsFargo.amount_cents, -51275);
});

test('a card-payment pattern in the description becomes txn_type payment, not a raw purchase', () => {
  const r = extractChaseLocally(buildPages(), CLASSIFICATIONS, noCleanup);
  const robinhood = r.rows.find((row) => row.description.includes('Robinhood'));
  assert.equal(robinhood.txn_type, 'payment');
  assert.equal(robinhood.suggested_category, 'Card Payment');
});

test('balance reconciliation: opening + net of every row lands on the printed closing balance', () => {
  const r = extractChaseLocally(buildPages(), CLASSIFICATIONS, noCleanup);
  assert.equal(r.statement.opening_balance_cents, 31840);
  assert.equal(r.statement.closing_balance_cents, 42565);
  assert.equal(r.reconciliation.balances_reconcile, true);
});

test('scans every page for the transaction-detail marker, not just ones classify.js scored as TRANSACTIONS', () => {
  // Regression check for the real bug: a sparse continuation page
  // classified BOILERPLATE was silently dropping its own rows.
  const r = extractChaseLocally(buildPages(), CLASSIFICATIONS, noCleanup);
  assert.equal(r.rows.length, 3);
});

test('an unparseable FIRST line in the block fails loudly — no prior row yet to (wrongly) merge it into', () => {
  const brokenPages = buildPages();
  brokenPages[0] = {
    pageNumber: 1,
    text: PAGE_ONE.replace(
      '06/30   Acme   Corp   Payroll   PPD   ID:   9000000001   5,420.00 5,738.40',
      'this is not a transaction line'
    ),
  };
  assert.throws(() => extractChaseLocally(brokenPages, CLASSIFICATIONS, noCleanup), /Couldn't parse/);
});

test('a minus sign printed with a space before the amount is still a negative, not a lost sign', () => {
  // Real, not hypothetical: "08/31   Zolve   Zolve   Bill ...   - 7.75   512.40"
  // — confirmed on a real Chase statement. Without tolerating the
  // space, the "-" was left behind in the description and a real
  // $7.75 payment landed in the ledger as a positive deposit.
  const pages = buildPages();
  pages[0] = {
    pageNumber: 1,
    text: PAGE_ONE.replace(
      '07/13   Wells   Fargo   Auto   Draft   PPD   ID:   0122287170   -512.75   425.65',
      '07/13   Wells   Fargo   Auto   Draft   PPD   ID:   0122287170   -512.75   425.65\n08/31   Zolve   Zolve   Bill   Web   ID:   1384169127   - 7.75   417.90'
    ).replace('Ending   Balance   $425.65\n*end*transaction detail', 'Ending   Balance   $417.90\n*end*transaction detail'),
  };
  const r = extractChaseLocally(pages, CLASSIFICATIONS, noCleanup);
  const zolve = r.rows.find((row) => row.description.startsWith('Zolve'));
  assert.equal(zolve.amount_cents, -775);
  assert.equal(zolve.description, 'Zolve Zolve Bill Web ID: 1384169127');
});

test('a card\'s last 4 digits wrapping onto their own line merges into the row above, not a new one', () => {
  // Real, not hypothetical: an ATM/debit line's "Card" label and its
  // last-4 digits print on the SAME line as the amount/balance, but
  // the digits themselves sometimes wrap onto the next physical line
  // alone ("...TX Card 930.00 1,930.00" / next line just "4321") —
  // confirmed on a real Chase statement. Without merging it, this
  // orphaned line had nothing to parse as (no date, no amount) and
  // the whole import failed outright: "Couldn't parse a transaction
  // detail line: \"4321\"".
  const pages = buildPages();
  pages[0] = {
    pageNumber: 1,
    text: PAGE_ONE.replace(
      '07/13   Wells   Fargo   Auto   Draft   PPD   ID:   0122287170   -512.75   425.65',
      '07/13   Wells   Fargo   Auto   Draft   PPD   ID:   0122287170   -512.75   425.65\n02/24   Card   Purchase   With   Pin   02/24   Kroger   #0   100   Main   St   Anytown   TX   Card - 76.75   348.90\n4321'
    ).replace('Ending   Balance   $425.65\n*end*transaction detail', 'Ending   Balance   $348.90\n*end*transaction detail'),
  };
  const r = extractChaseLocally(pages, CLASSIFICATIONS, noCleanup);
  const kroger = r.rows.find((row) => row.description.includes('Kroger'));
  assert.equal(kroger.amount_cents, -7675);
  assert.equal(kroger.description, 'Card Purchase With Pin 02/24 Kroger #0 100 Main St Anytown TX Card 4321');
  assert.equal(r.rows.length, 4); // the "4321" line must not become its own row
});
