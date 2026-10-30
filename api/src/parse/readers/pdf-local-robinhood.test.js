import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractRobinhoodLocally } from './pdf-local-robinhood.js';

// An invented statement in Robinhood's layout (the real one stays private).
const PAGE_1 = ` ALEX J MORGAN   Account Number: XXXX XXXX XXXX 4321
 ACCOUNT SUMMARY  PAYMENT INFORMATION
 Credit Limit   $5,000.00  New Balance   $171.50
Statement Closing Date   January 12, 2027
Days in Billing Cycle   31
Late Payment Warning:   Failure to make the minimum payment by the Previous Balance   $100.00
date listed above may result in a late fee -   Payments & Credits   $140.00
consequences + Purchases & Other Charges   $211.50
 = New Balance   $171.50
 TRANSACTIONS
 Tran Post
Date Date   Reference Number   Transaction Description   Amount
12/14   12/14   2411641L7TNRTVVE9   TRADER JOE S #552 SPRINGFIELD IL   64.18
12/20   12/20   2471705LAGYFVQDTZ   FRONTIER AI QWERTY   720-5550100 CO   127.32
01/26/27 1 F9 R   DENVER   SPRINGFIELD
12/21   12/21   7471705LAGYFVHFSE   SHOP.EXAMPLE.COM   555-0100 CREDIT   40.00-
01/02   01/02   F583800LT000MX265   PAYMENT - THANK YOU   100.00-
Transactions continued on next page
1200   NZJ   001   7   16   270112   0   PAGE   1 of 2   1 0   5838   2000   T124`;
const PAGE_2 = `ALEX J MORGAN   Account Number: XXXX XXXX XXXX 4321
 TRANSACTIONS (continued)
01/05   01/05   F583800LT000MX266   GOLD ANNUAL SUBSCRIPTIO   20.00
 TOTAL FEES FOR THIS PERIOD   0.00
INTEREST CHARGED
 01/12   01/12   INTEREST CHARGE ON PURCHASES   0.00
 TOTAL INTEREST FOR THIS PERIOD   0.00
 Totals 2027 Year-to-Date
 Total fees charged in 2027   $0.00`;

const pages = [{ pageNumber: 1, text: PAGE_1 }, { pageNumber: 2, text: PAGE_2 }];
const roles = [{ pageNumber: 1, role: 'TRANSACTIONS' }, { pageNumber: 2, role: 'TRANSACTIONS' }];
const run = (p = pages) => extractRobinhoodLocally(p, roles, (d) => (/TRADER JOE/.test(d) ? "Trader Joe's" : null));

test('account, period and balances off page 1', () => {
  const r = run();
  assert.deepEqual(r.account, { name: 'Robinhood Gold Card', issuer: 'Robinhood', mask: '4321', account_type: 'CREDIT_CARD', holder_name: 'ALEX J MORGAN' });
  assert.equal(r.statement.period_start, '2026-12-13'); // 31 days back from Jan 12, across the year
  assert.equal(r.statement.period_end, '2027-01-12');
  assert.equal(r.statement.opening_balance_cents, 10000);
  assert.equal(r.statement.closing_balance_cents, 17150);
});

test('rows: signs, December rows in last year, credit vs payment, itinerary kept off the description', () => {
  const rows = run().rows;
  assert.deepEqual(
    rows.map((x) => [x.posted_date, x.amount_cents, x.txn_type]),
    [
      ['2026-12-14', -6418, 'purchase'],
      ['2026-12-20', -12732, 'purchase'],
      ['2026-12-21', 4000, 'refund'],
      ['2027-01-02', 10000, 'payment'],
      ['2027-01-05', -2000, 'purchase'],
      ['2027-01-12', 0, 'interest'],
    ]
  );
  assert.equal(rows[0].merchant, "Trader Joe's");
  assert.equal(rows[1].description, 'FRONTIER AI QWERTY   720-5550100 CO');
  assert.match(rows[1].raw_text, /DENVER/);
  assert.equal(rows[3].suggested_category, 'Card Payment');
  assert.equal(rows[4].merchant, 'Robinhood');
});

test("every printed total is checked, and they all agree", () => {
  assert.deepEqual(run().reconciliation, { payments_match: true, purchases_match: true, balances_reconcile: true });
});

test('a line it cannot read inside a section fails the parse instead of being dropped', () => {
  const broken = [{ pageNumber: 1, text: PAGE_1.replace(' TRANSACTIONS\n', ' TRANSACTIONS\nSOMETHING UNEXPECTED\n') }, pages[1]];
  assert.throws(() => run(broken), /Couldn't parse a transactions line/);
});
