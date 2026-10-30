import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractAmexLocally } from './pdf-local-amex.js';

// The layout is real text captured via stage-1 extraction from an Amex
// statement; names, card number, merchants' locations and amounts have
// been replaced with invented ones.
// api/scripts/verify/verify-local-amex.mjs re-checks every real statement on
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

test('each New Charges row keeps its card member block: name and card ending; payments and credits name nobody (D344)', () => {
  // A second member's block after the first, as Blue Cash Preferred prints an additional card member.
  const twoMembers = TXN_PAGE.replace(' Fees\n Amount', ' S RIVERA\n Card Ending 7-25678\n Amount\nNETFLIX.COM LOS GATOS CA 04/01/26 $15.49\n Fees\n Amount');
  const pages = buildPages().map((p) => (p.pageNumber === 3 ? { ...p, text: twoMembers } : p));
  const r = extractAmexLocally(pages, CLASSIFICATIONS, noCleanup);
  const tagged = r.rows.map((x) => [x.txn_type, x.spender_name ?? null, x.card_ending ?? null]);
  assert.deepEqual(tagged.filter(([t]) => t === 'purchase'), [
    ['purchase', 'ALEX MORGAN', '1357'],
    ['purchase', 'ALEX MORGAN', '1357'],
    ['purchase', 'S RIVERA', '5678'],
  ]);
  assert.ok(tagged.filter(([t]) => t !== 'purchase').every(([, n, c]) => n === null && c === null));
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

test('an Amex Offer / Streaming Credit line is cashback, distinct from a genuine merchant return', () => {
  const r = extractAmexLocally(buildPages(), CLASSIFICATIONS, noCleanup);
  const disney = r.rows.find((row) => row.description.includes('Streaming Credit'));
  assert.equal(disney.amount_cents, 539);
  assert.equal(disney.txn_type, 'cashback');
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

// D214: two genuine identical charges (Spectrum $50 twice on 12/31) vs. pdf.js printing one line twice.
const withCharges = (lines) => buildPages().map((p) => (p.pageNumber === 3
  ? { ...p, text: p.text.replace('AplPay FOOD LION #0123   ANYTOWN   NC  03/28/26   $126.48\nGROCERY STORE\n', lines) }
  : p));
const spectrum = (r) => r.rows.filter((row) => row.description.startsWith('SPECTRUM'));

test('two identical charges with a line between them are both kept', () => {
  const r = extractAmexLocally(withCharges('SPECTRUM   855-707-7328   MO  03/28/26   $50.00\nCABLE SVC\nSPECTRUM   855-707-7328   MO 03/28/26   $50.00\nCABLE SVC\n'), CLASSIFICATIONS, noCleanup);
  assert.deepEqual(spectrum(r).map((row) => row.amount_cents), [-5000, -5000]);
});

test('the same line printed twice in a row is a rendering artifact, dropped', () => {
  const r = extractAmexLocally(withCharges('SPECTRUM   855-707-7328   MO  03/28/26   $50.00\nSPECTRUM   855-707-7328   MO 03/28/26   $50.00\nCABLE SVC\n'), CLASSIFICATIONS, noCleanup);
  assert.equal(spectrum(r).length, 1);
});

// D271: a Plan It statement's opening balance is the plan's and the rest's together.
test('Plan It: the opening balance adds the plan\'s Previous Balance to the rest\'s', async () => {
  const { extractOpeningBalance } = await import('./pdf-local-amex.js');
  const planPage = [
    'Previous Balance $0.00', 'Payments/Credits -$0.00', 'New Plan Principal +$800.00', 'Plan Balance = $800.00',
    'Previous Balance $310.25', 'Payments/Credits -$310.25', 'New Charges +$1,020.40', 'Non-Plan Balance = $1,020.40',
  ].join('\n');
  assert.equal(extractOpeningBalance(planPage), 31025);
  const plain = ['New Balance $512.40', 'Previous Balance $410.00', 'Payments/Credits -$410.00', 'Previous Balance $410.00 (as of last statement)'].join('\n');
  assert.equal(extractOpeningBalance(plain), 41000, 'no plan: the first one only');
});

// D271: the detail listing starts on a page scored as a summary.
test('rows on a summary-scored page that starts the detail listing are read', async () => {
  const { extractAmexLocally } = await import('./pdf-local-amex.js');
  const pageOne = 'Closing Date 08/25/24\nAccount Ending 7-11111\nPrevious Balance $100.00\nNew Balance $150.00';
  const pageTwo = [
    'Payments and Credits', 'Summary', 'Total', 'Credits -$10.00', 'Detail', 'Credits Amount',
    'AplPay TEST SHOP 08/02/24 -$10.00', 'SOMEWHERE TX',
    'New Charges', 'Summary', 'Total New Charges $60.00', 'Detail', 'Amount',
    'AplPay TEST GROCER SOMEWHERE TX 07/25/24 $15.00', '555-0100',
  ].join('\n');
  const pageThree = ['Detail Continued', 'Amount', 'TEST HARDWARE SOMEWHERE TX $45.00 07/29/24', '555-0101'].join('\n');
  const pages = [{ text: pageOne }, { text: pageTwo }, { text: pageThree }];
  const classifications = [{ pageNumber: 1, role: 'SUMMARY' }, { pageNumber: 2, role: 'SUMMARY' }, { pageNumber: 3, role: 'TRANSACTIONS' }];
  const out = extractAmexLocally(pages, classifications, (d) => d);
  assert.deepEqual(out.rows.map((r) => [r.posted_date, r.amount_cents, r.txn_type]), [
    ['2024-08-02', 1000, 'refund'],
    ['2024-07-25', -1500, 'purchase'],
    ['2024-07-29', -4500, 'purchase'],
  ]);
});

// D273: an untouched card's statement, and a balance in the holder's favour.
test('a statement with no activity reads as zero rows with its credit balance; any activity without rows still fails', async () => {
  const { extractAmexLocally, extractOpeningBalance, noActivity } = await import('./pdf-local-amex.js');
  const pageOne = ['Closing Date 04/07/25', 'Account Ending 5-91111', 'New Balance CR$2.49', 'Previous Balance CR$2.49',
    'Payments/Credits -$0.00', 'New Charges +$0.00', 'Fees +$0.00', 'Interest Charged +$0.00'].join('\n');
  const out = extractAmexLocally([{ text: pageOne }, { text: 'Interest Charge Calculation' }], [{ pageNumber: 1, role: 'TRANSACTIONS' }, { pageNumber: 2, role: 'TRANSACTIONS' }], (d) => d);
  assert.equal(out.rows.length, 0);
  assert.deepEqual([out.statement.period_start, out.statement.period_end, out.statement.opening_balance_cents, out.statement.closing_balance_cents], ['2025-03-08', '2025-04-07', -249, -249]);
  assert.equal(extractOpeningBalance('Previous Balance $60.53CR'), -6053, 'the trailing CR form too');
  assert.equal(noActivity(pageOne.replace('New Charges +$0.00', 'New Charges +$12.00')), false);
  assert.throws(() => extractAmexLocally([{ text: pageOne.replace('New Charges +$0.00', 'New Charges +$12.00') }], [{ pageNumber: 1, role: 'TRANSACTIONS' }], (d) => d), /No transaction lines matched/);
});

test('reads the product printed at the top of page 1, which an upgrade changes (D275)', async () => {
  const { extractProductName } = await import('./pdf-local-amex.js');
  assert.equal(extractProductName('p. 1/7 Blue Cash Everyday® from American Express\nCustomer Care: 1-800-000-0000'), 'Blue Cash Everyday');
  assert.equal(extractProductName('p. 1/8   Blue   Cash   Preferred®   from   American   Express'), 'Blue Cash Preferred');
  assert.equal(extractProductName(' American Express Cash Magnet® Card\nTTY: Use Relay 711'), 'Cash Magnet Card');
  assert.equal(extractProductName('Closing Date 01/25/24'), null);
});

test("a dispute or refund dated weeks before the cycle doesn't move the start (D275)", async () => {
  const { amexPeriodStart } = await import('./pdf-local-amex.js');
  const row = (posted_date) => ({ posted_date });
  // Closed Feb 21: the dispute credit dated Jan 6 is the original purchase's date.
  assert.equal(amexPeriodStart([row('2025-01-06'), row('2025-01-25'), row('2025-01-27')], '2025-02-21'), '2025-01-25');
  // Closed Mar 25: its reversal, also dated Jan 6; the cycle's first charge is Feb 21.
  assert.equal(amexPeriodStart([row('2025-03-02'), row('2025-01-06'), row('2025-02-21')], '2025-03-25'), '2025-02-21');
  // Only an old-dated row: a month before the close.
  assert.equal(amexPeriodStart([row('2025-01-06')], '2025-03-25'), '2025-02-26');
  assert.equal(amexPeriodStart([], '2025-04-07'), '2025-03-08');
});

test('"Amex Offer Credit" printed on the line under the merchant makes that credit cashback (D303)', () => {
  const pages = buildPages();
  pages[2] = { pageNumber: 3, text: pages[2].text.replace(/Credits {3}Amount/, 'Credits   Amount\nGROUPON   03/20/26   -$10.00\nCHICAGO\nAmex Offer Credit') };
  const r = extractAmexLocally(pages, CLASSIFICATIONS, noCleanup);
  const offer = r.rows.find((row) => row.description.startsWith('GROUPON'));
  assert.equal(offer.amount_cents, 1000);
  assert.equal(offer.txn_type, 'cashback');
  assert.equal(offer.suggested_category, 'Cashback');
  // A plain return in the same section stays a refund.
  assert.equal(r.rows.find((row) => row.description.includes('APPLE STORE')).txn_type, 'refund');
});

test("the Reward Dollars box: the figure under 'as of', not the card's New Balance beside it (D331)", async () => {
  const { extractRewardDollars } = await import('./pdf-local-amex.js');
  const pageOne = 'Account Ending 7-01234\n Reward Dollars\n New Balance   $512.40\n as of 08/25/2026\n 143.27\nMinimum Payment Due   $40.00';
  assert.deepEqual(extractRewardDollars(pageOne), { cents: 14327, as_of: '2026-08-25' });
  assert.deepEqual(extractRewardDollars(pageOne.replace('143.27', '1,143.27')), { cents: 114327, as_of: '2026-08-25' });
  assert.equal(extractRewardDollars('Account Ending 7-01234\n New Balance   $512.40'), null, 'no box printed');
});

test('a repeated line is put back only when the printed total proves it is real (D340)', async () => {
  const { restoreProvenRepeats } = await import('./pdf-local-amex.js');
  const credit = (c) => ({ txn_type: 'refund', amount_cents: c });
  const rows = [credit(4547), credit(904)];
  const twin = [credit(904)];
  assert.equal(restoreProvenRepeats(rows, twin, { payments: 6355, charges: null }).length, 3, 'two real $9.04 credits');
  assert.equal(restoreProvenRepeats(rows, twin, { payments: 5451, charges: null }).length, 2, 'the total says it was a glitch');
  assert.equal(restoreProvenRepeats(rows, twin, { payments: null, charges: null }).length, 2, 'no total, no guess');
});

test('with a Plan It plan, payments are checked against the Total column (D340)', async () => {
  const { lastAmountAfterLabel } = await import('./pdf-local-amex.js');
  assert.equal(lastAmountAfterLabel('Total Payments and Credits -$377.74 -$122.26 -$500.00', 'Total Payments and Credits'), -50000);
  assert.equal(lastAmountAfterLabel('Total Payments and Credits -$500.00', 'Total Payments and Credits'), -50000, 'one column: the same');
  assert.equal(lastAmountAfterLabel('Plan It Credit -$112.75 $0.00 -$112.75', 'Plan It Credit'), -11275);
  assert.equal(lastAmountAfterLabel('nothing here', 'Plan It Credit'), null);
});

test("the cycle's start is the printed Days in Billing Period, not the first purchase (D341)", async () => {
  const { amexPeriodStart } = await import('./pdf-local-amex.js');
  assert.equal(amexPeriodStart([{ posted_date: '2024-03-18' }], '2024-03-25', 31), '2024-02-24');
  assert.equal(amexPeriodStart([{ posted_date: '2024-03-01' }], '2024-03-01', 29), '2024-02-02', 'across a short month');
  assert.equal(amexPeriodStart([{ posted_date: '2024-03-18' }], '2024-03-25'), '2024-03-18', 'without it, the old guess');
});
