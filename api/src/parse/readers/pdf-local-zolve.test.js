import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, extractZolveLocally } from './pdf-local-zolve.js';
import { guessIssuerFromPageOne } from '../layout-cache.js';

// Both real Zolve layouts (D221); names, addresses, card numbers, merchants
// and amounts are invented.
const LAYOUT_A_P1 = ` ALEX MORGAN
 1 Main St, Apt 2,
Anytown, NC, 27000
Monthly Credit Card Statement
July 18, 2026 - August 17, 2026  MasterCard ending in ••• 1111
 PAYMENT INFO  ACCOUNT SUMMARY
 Previous Balance   $300.00  New Balance  Minimum Payment Due  Payment Due Date
- Payments   $300.00
- Other Credits   $99.99
+ Purchases   $107.74
+ Cash Advance   $0.00
+ Interest Charged   $0.00
+ Fees Charged   $0.00
will pay more in interest and it will take you longer to pay off your balance.  New Balance   \u0000 7.75
 Zolve Credit Cards are issued by Continental Bank, Member FDIC, pursuant to license by Mastercard International.`;
const LAYOUT_A_P2 = ` PAYMENTS & OTHER CREDITS
 Transaction Date   Description   Amount
 07/20/2026   ANNUAL FEE REVERSAL   $99.99
 07/30/2026   [GP] BILL PAYMENT   $300.00
 Sub Total   $399.99
 TRANSACTIONS
 Transaction Date   Description   Amount
 07/27/2026   WWW COSTCO COM WA USA   $107.74
 Sub Total   $107.74
 FEES CHARGED
 Transaction Date   Description   Amount
 Total fees for this period   $0.00`;

const LAYOUT_B_P1 = ` ALEX MORGAN   - Card Ending in - * 2222
Credit Card Statement
Bill Period: 03/15/2026   - 04/14/2026
 Previous Balance   $307.39
 Payments   $307.39
 Other Credits   $0.00  $1,439.39  05/10/2026  $25.00
 Purchases   $1,439.39
 Cash Advance   $0.00
of up to $40.00  Interest Charged   $0.00
 Minimum Payment Warning:  Fee Charged   $0.00
New Balance   $1,439.39
 Pay or manage your account on our mobile app or at www.zolve.com.`;
const LAYOUT_B_P2 = `ALEX MORGAN   Card Ending in * 2222
 Posted Date   Transaction Date   Description   Amount(USD)
Payments and Other Credits
ACH Payment from Bank of
 04/03/2026   04/03/2026   $307.39
America account ending 1234
 Sub Total:   $307.39
 Purchases and Cash Advances
 03/15/2026   03/14/2026   Cosmetics Co Midvale Midvale TXUSA   $22.80
SPI*DUKE-ENERGY
03/18/2026   03/16/2026   $140.47
CHARLOTTE NCUSA
GEICO *AUTO WASHINGTON
03/19/2026   03/18/2026   $371.48
DCUSA
WWW COSTCO COM ISSAQUAH
03/24/2026   03/19/2026   $904.64
WAUSA
 Sub Total:   $1,439.39
 Fees Charged
 No transaction available for card ending in 2222
 Interest Charged
 No transaction available for card ending in 2222`;

const pages = (...t) => t.map((text, i) => ({ pageNumber: i + 1, text }));
const noCleanup = () => null;

test('both layouts are recognised as Zolve', () => {
  assert.equal(guessIssuerFromPageOne(LAYOUT_A_P1), 'zolve');
  assert.equal(guessIssuerFromPageOne(LAYOUT_B_P1), 'zolve');
});

test('layout A: period, card, balances (its "$" can arrive as NUL), credits and charges', () => {
  const r = extractZolveLocally(pages(LAYOUT_A_P1, LAYOUT_A_P2), [], noCleanup);
  assert.deepEqual([r.account.mask, r.account.holder_name], ['1111', 'ALEX MORGAN']);
  assert.deepEqual([r.statement.period_start, r.statement.period_end], ['2026-07-18', '2026-08-17']);
  assert.deepEqual([r.statement.opening_balance_cents, r.statement.closing_balance_cents], [30000, 775]);
  assert.deepEqual(r.rows.map((x) => [x.posted_date, x.amount_cents, x.txn_type, x.suggested_category]), [
    ['2026-07-20', 9999, 'refund', 'Annual Fee'],
    ['2026-07-30', 30000, 'payment', 'Card Payment'],
    ['2026-07-27', -10774, 'purchase', null],
  ]);
  assert.ok(Object.values(r.reconciliation).every((v) => v === true));
});

test('layout B: the posted date, and descriptions split around their date line', () => {
  const r = extractZolveLocally(pages(LAYOUT_B_P1, LAYOUT_B_P2), [], noCleanup);
  assert.deepEqual([r.account.mask, r.account.holder_name], ['2222', 'ALEX MORGAN']);
  assert.deepEqual([r.statement.period_start, r.statement.period_end], ['2026-03-15', '2026-04-14']);
  assert.deepEqual(r.rows.map((x) => [x.posted_date, x.amount_cents, x.description]), [
    ['2026-04-03', 30739, 'ACH Payment from Bank of America account ending 1234'],
    ['2026-03-15', -2280, 'Cosmetics Co Midvale Midvale TXUSA'],
    ['2026-03-18', -14047, 'SPI*DUKE-ENERGY CHARLOTTE NCUSA'],
    ['2026-03-19', -37148, 'GEICO *AUTO WASHINGTON DCUSA'],
    ['2026-03-24', -90464, 'WWW COSTCO COM ISSAQUAH WAUSA'],
  ]);
  assert.equal(r.rows[0].txn_type, 'payment');
  assert.deepEqual(r.reconciliation, { credits_match: true, charges_match: true, fees_match: true, interest_match: true, balances_reconcile: true });
});

test('a misread amount fails its own section total', () => {
  const r = extractZolveLocally(pages(LAYOUT_B_P1, LAYOUT_B_P2.replace('$371.48', '$317.48')), [], noCleanup);
  assert.equal(r.reconciliation.charges_match, false);
  assert.equal(r.reconciliation.balances_reconcile, false);
});

test('layout B: one "Fees and Interest Charged" section, and a credit balance in brackets', () => {
  const p1 = LAYOUT_B_P1.replace('Previous Balance   $307.39', 'Previous Balance   $54.00')
    .replace('Payments   $307.39', 'Payments   $360.00').replace('Purchases   $1,439.39', 'Purchases   $11.00')
    .replace('Fee Charged   $0.00', 'Fee Charged   $95.00').replace('New Balance   $1,439.39', 'New Balance   ($200.00)');
  const p2 = `ALEX MORGAN   Card Ending in * 2222
 Payments and Other Credits
 04/03/2026   04/03/2026   Bill Payment from Bank   $360.00
 Sub Total:   $360.00
 Purchases and Cash Advances
 03/15/2026   03/14/2026   Cosmetics Co Midvale Midvale TXUSA   $11.00
 Sub Total:   $11.00
 Fees and Interest Charged
 03/26/2026   03/26/2026   Annual Fee   $95.00
 Sub Total:   $95.00
 2026 Totals Year-to-Date`;
  const r = extractZolveLocally(pages(p1, p2), [], noCleanup);
  assert.equal(r.statement.closing_balance_cents, -20000);
  assert.deepEqual(r.rows.at(-1), { ...r.rows.at(-1), amount_cents: -9500, txn_type: 'fee', suggested_category: 'Annual Fee' });
  assert.deepEqual(r.reconciliation, { credits_match: true, charges_match: true, fees_match: true, interest_match: true, balances_reconcile: true });
});

test('a return printed three times nets to the return; a waived fee is a fee (D337)', () => {
  assert.deepEqual(classify('credits', 'Pending Credit Transaction- POS Signature Return'), { txn_type: 'refund', category: 'Refund' });
  assert.deepEqual(classify('charges', 'Reversal Transaction [Pending Credit Transaction- POS Signature Return]'), { txn_type: 'refund', category: 'Refund' });
  assert.deepEqual(classify('credits', 'Purchase Returns - SOME STORE'), { txn_type: 'refund', category: 'Refund' });
  assert.deepEqual(classify('credits', 'Reversal Transaction [Fee - Late Payment Fee]'), { txn_type: 'fee', category: 'Bank Fees' });
  assert.deepEqual(classify('fees', 'Fee - Late Payment Fee'), { txn_type: 'fee', category: 'Bank Fees' });
  assert.deepEqual(classify('credits', 'Bill Payment from Bank of America'), { txn_type: 'payment', category: 'Card Payment' });
  assert.deepEqual(classify('charges', 'SHELL OIL 123'), { txn_type: 'purchase', category: null });
});

test('layout B: the holder under the plan line, in either case (D414)', () => {
  const p1 = LAYOUT_B_P1.replace(' ALEX MORGAN   - Card Ending in - * 2222', 'Zolve Physical Credit APR V1\n Alex Morgan   - Card Ending in - * 2222');
  const r = extractZolveLocally(pages(p1, LAYOUT_B_P2), [], noCleanup);
  assert.equal(r.account.holder_name, 'Alex Morgan');
  assert.equal(r.account.mask, '2222');
});
