import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractBarclaysLocally } from './pdf-local-barclays.js';

// An invented statement in Barclays' layout (the real ones stay private).
const PAGE_1 = `®
Frontier Airlines World Mastercard Statement
ALEX J MORGAN    |   Account Ending 4321   | Statement Period 12/06/25 - 01/05/26   Page 1 of 5
Account Activity Payment Information
Previous Balance as of 12/06/25   $100.00 Statement Balance:   $95.65
Payments - Thank You   -   $100.00 Minimum Payment Due:   $29.00
Other Credits   -   $9.66 Payment Due Date:   02/02/26
Purchases   +   $105.31 Late Payment Warning: If we do not receive your minimum payment by the
Fees Charged   +   $0.00
Interest Charged   +   $0.00 Minimum Payment Warning: If you make only the minimum payment each
Statement Balance as of 01/05/26   =   $95.65
Download the Barclays US App for fast,`;
const PAGE_3 = `®
Frontier Airlines World Mastercard Statement
ALEX J MORGAN   |   Account Ending 4321   | Statement Period 12/06/25 - 01/05/26   Page 3 of 5
Transactions
Transaction Date   Posting Date   Description   Miles   Amount
Payments
Dec 23   Dec 23   Payment Received EXAMPLE BANK   N/A   -$100.00
Total payments for this period   N/A   -$100.00
Other Credits
Dec 27   Dec 28   Subway 12345 5550100 NC   -29   -$9.66
Total other credits for this period   -29   -$9.66
Purchase Activity for ALEX J MORGAN card ending 4321
Dec 27   Dec 28   Subway 12345 5550100 NC   29   $9.66
Jan 02   Jan 03   FRONTIER SH52VW DENVER CO 225   $45.00
MORGAN/A 01/26/2026 RDU   DEN   RDU
Agency: FRONTIER #SH52VW
Purchase activity for ALEX J MORGAN card ending 4321   254   $54.66
Purchase Activity for SAM RIVERA card ending 8765
Dec 18   Dec 19   TRADER JOE S #552 SPRINGFIELD IL   50   $50.65
Purchase activity for SAM RIVERA card ending 8765   50   $50.65
Total purchase activity for this period   304   $105.31
Fees and Interest
Transaction Date   Posting Date   Description   Amount
Fees Charged
No fees charged for this period   $0.00
Total fees for this period   $0.00
Interest Charged
No interest charged for this period   $0.00
Total interest for this period   $0.00
2026 Year-to-Date Totals
Total fees charged in 2026   $0.00`;

const pages = [{ pageNumber: 1, text: PAGE_1 }, { pageNumber: 3, text: PAGE_3 }];
const roles = [{ pageNumber: 3, role: 'TRANSACTIONS' }];
const run = (p = pages) => extractBarclaysLocally(p, roles, (d) => (/TRADER JOE/.test(d) ? "Trader Joe's" : null));

test('account, period and balances off page 1', () => {
  const r = run();
  assert.deepEqual(r.account, { name: 'Frontier Airlines World Mastercard', issuer: 'Barclays', mask: '4321', account_type: 'CREDIT_CARD', holder_name: 'ALEX J MORGAN' });
  assert.equal(r.statement.period_start, '2025-12-06');
  assert.equal(r.statement.period_end, '2026-01-05');
  assert.equal(r.statement.opening_balance_cents, 10000);
  assert.equal(r.statement.closing_balance_cents, 9565);
});

test('rows: every card on the account, December in last year, miles glued to the description, itinerary kept off it', () => {
  const rows = run().rows;
  assert.deepEqual(rows.map((x) => [x.posted_date, x.amount_cents, x.txn_type]), [
    ['2025-12-23', 10000, 'payment'],
    ['2025-12-28', 966, 'refund'],
    ['2025-12-28', -966, 'purchase'],
    ['2026-01-03', -4500, 'purchase'],
    ['2025-12-19', -5065, 'purchase'], // the second card's purchases count too
  ]);
  assert.equal(rows[3].description, 'FRONTIER SH52VW DENVER CO');
  assert.match(rows[3].raw_text, /Agency: FRONTIER/);
  assert.equal(rows[0].suggested_category, 'Card Payment');
  assert.equal(rows[4].merchant, "Trader Joe's");
});

test('every printed total is checked, and they all agree', () => {
  assert.deepEqual(run().reconciliation, { payments_match: true, purchases_match: true, transfers_match: true, balances_reconcile: true });
});

test('a line it cannot read inside a section fails the parse instead of being dropped', () => {
  const broken = [pages[0], { pageNumber: 3, text: PAGE_3.replace('Payments\n', 'Payments\nSOMETHING UNEXPECTED\n') }];
  assert.throws(() => run(broken), /Couldn't parse a payments line/);
});

// An invented balance-transfer month, in the same layout as the real one.
const BT_PAGE_1 = `Frontier Airlines World Mastercard Statement
ALEX J MORGAN    |   Account Ending 4321   | Statement Period 09/06/26 - 10/05/26   Page 1 of 5
Previous Balance as of 09/06/26   $0.00 Statement Balance:   $5,050.00
Payments - Thank You   -   $100.00 Minimum Payment Due:   $50.50
Balance Transfers   +   $5,000.00 Payment Due Date:   11/02/26
Fees Charged   +   $150.00 Late Payment Warning: If we do not receive your minimum payment by the
Interest Charged   +   $0.00
Statement Balance as of 10/05/26   =   $5,050.00 Minimum Payment Warning:`;
const BT_PAGE_3 = `Transactions
Transaction Date   Posting Date   Description   Miles   Amount
Payments
Sep 11   Sep 11   Payment Received EXAMPLE BANK   N/A   -$100.00
Total payments for this period   N/A   -$100.00
Purchase Activity for ALEX J MORGAN card ending 4321
No Transaction Activity at This Time   $0.00
Total purchase activity for this period   N/A   $0.00
Balance Transfers
Sep 10   Sep 10   BT TO CK ACCT - 1234   0 5678   N/A   $5,000.00
Total balance transfer activity for this period   N/A   $5,000.00
To see activity after this statement period, visit BarclaysUS.com
Fees and Interest
Transaction Date   Posting Date   Description   Amount
Fees Charged
Sep 10   Sep 10   BALANCE TRANSFER FEE   $150.00
Total fees for this period   $150.00
Interest Charged
No interest charged for this period   $0.00
Total interest for this period   $0.00
2026 Year-to-Date Totals`;

test('a balance transfer is new debt on the card: negative, a transfer, its fee a Balance Transfer fee (D191)', () => {
  const r = run([{ pageNumber: 1, text: BT_PAGE_1 }, { pageNumber: 3, text: BT_PAGE_3 }]);
  assert.deepEqual(r.rows.map((x) => [x.posted_date, x.amount_cents, x.txn_type, x.suggested_category]), [
    ['2026-09-11', 10000, 'payment', 'Card Payment'],
    ['2026-09-10', -500000, 'transfer', 'Balance Transfer'],
    ['2026-09-10', -15000, 'fee', 'Balance Transfer'],
  ]);
  assert.deepEqual(r.reconciliation, { payments_match: true, purchases_match: true, transfers_match: true, balances_reconcile: true });
});
