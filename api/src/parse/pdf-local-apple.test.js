import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractAppleLocally } from './pdf-local-apple.js';
import { guessIssuerFromPageOne } from './layout-cache.js';

// The layout is real Apple Card text (D219); names, emails, merchants and
// amounts are invented. Two co-owners, a return with its Daily Cash
// clawback, a wrapped description, and a bonus line that isn't a charge.
const SUMMARY = `Statement
Apple Card Co-Owners
Alex Morgan, alex@example.com
Sam Lee, sam@example.com  May 1 — May 31, 2026
Previous Total Balance   $100.00
 as of Apr 30, 2026
 Total Balance   $186.30
 as of May 31, 2026
Total payments for this period   -$50.00
 Total charges, credits, and returns for this period   $136.30
 Total interest for this month   $0.00
 Total Daily Cash to account   $2.10
Apple Card is issued by Goldman Sachs Bank USA, Salt Lake City Branch.`;

const ACTIVITY = `Payments made by Alex Morgan
 Date   Description   Amount
-$40.00 ACH Deposit Internet transfer from account ending in 1234    05/24/2026
-$10.00 Daily Cash redemption    05/01/2026
 Total payments for this period   -$50.00
 Transactions by Alex Morgan
 Date   Description   Daily Cash   Amount
 05/02/2026   CORNER CAFE 1 MAIN ST ANYTOWN 30000 GA USA   2%   $1.00   $50.00
05/04/2026   AMAZON PAY INDIA Pvt 26 Brigade Gateway Bangalore 560055 1%   $0.20   $20.00
INDIND
05/06/2026   ChargePoint, Inc. 240 East Hacienda Avenue Campbell 95008 CA USA   2%   $0.02   $1.00
ChargePoint 3% Daily Cash   1%   $0.01
05/09/2026   SHOE STORE 9 MAIN ST ANYTOWN 30000 GA USA (RETURN)   -$30.00
Daily Cash Adjustment   -2%   $0.60
Apple Card is issued by Goldman Sachs Bank USA, Salt Lake City Branch.
Page 3 /6
Statement
Apple Card Co-Owners
Alex Morgan, alex@example.com
Sam Lee, sam@example.com  May 1 — May 31, 2026
Transactions by Alex Morgan
 Date   Description   Daily Cash   Amount
 05/20/2026   GROCER 5 ELM ST ANYTOWN 30000 GA USA   2%   $1.80   $90.00
 Total charges, credits and returns   $131.60
 Transactions by Sam Lee
 Date   Description   Daily Cash   Amount
 05/21/2026   BAKERY 7 OAK ST ANYTOWN 30000 GA USA   2%   $0.09   $4.70
 Total charges, credits and returns   $4.70`;

const pages = () => [{ pageNumber: 1, text: SUMMARY }, { pageNumber: 2, text: ACTIVITY }];
const noCleanup = () => null;

test('Apple Card is recognised by its footer, even when its activity names another bank', () => {
  assert.equal(guessIssuerFromPageOne(`${SUMMARY}\nACH Deposit Internet transfer from account ending in 1234 BANK OF AMERICA`), 'apple card');
});

test('period, balances, totals, Daily Cash, and the first co-owner as holder', () => {
  const r = extractAppleLocally(pages(), [], noCleanup);
  assert.equal(r.account.holder_name, 'Alex Morgan');
  assert.equal(r.account.mask, null); // Apple prints no card number
  assert.deepEqual(r.statement, {
    period_start: '2026-05-01', period_end: '2026-05-31', opening_balance_cents: 10000, closing_balance_cents: 18630,
    total_spend_cents: -13630, total_payments_cents: 5000, cashback_earned_cents: 210, cashback_balance_cents: null,
  });
});

test('payments, charges for both co-owners, a return, its Daily Cash clawback, and a wrapped description', () => {
  const r = extractAppleLocally(pages(), [], noCleanup);
  assert.deepEqual(r.rows.map((x) => [x.posted_date, x.amount_cents, x.txn_type]), [
    ['2026-05-24', 4000, 'payment'],
    ['2026-05-01', 1000, 'cashback'], // Daily Cash redemption: a credit on the card
    ['2026-05-02', -5000, 'purchase'],
    ['2026-05-04', -2000, 'purchase'],
    ['2026-05-06', -100, 'purchase'], // its "3% Daily Cash" bonus line goes to Apple Cash, not a row
    ['2026-05-09', 3000, 'refund'],
    ['2026-05-09', -60, 'cashback'], // the Daily Cash taken back on that return, charged to the card
    ['2026-05-20', -9000, 'purchase'],
    ['2026-05-21', -470, 'purchase'],
  ]);
  assert.match(r.rows[3].description, /Bangalore 560055 INDIND$/);
  assert.match(r.rows[6].description, /^Daily Cash Adjustment · SHOE STORE/);
});

test('reconciles payments, charges and balances: the clawback is what makes the charges add up', () => {
  const r = extractAppleLocally(pages(), [], noCleanup);
  assert.deepEqual(r.reconciliation, { payments_match: true, charges_match: true, balances_reconcile: true });
  // Without the clawback line the charges come up $0.60 short, the shape of the old gaps.
  const noAdj = extractAppleLocally([{ pageNumber: 1, text: SUMMARY }, { pageNumber: 2, text: ACTIVITY.replace('Daily Cash Adjustment   -2%   $0.60\n', '') }], [], noCleanup);
  assert.equal(noAdj.reconciliation.charges_match, false);
});

test('a month with interest gets an interest row', () => {
  const withInterest = SUMMARY.replace('Total interest for this month   $0.00', 'Total interest for this month   $3.21').replace('Total Balance   $186.30', 'Total Balance   $189.51');
  const r = extractAppleLocally([{ pageNumber: 1, text: withInterest }, { pageNumber: 2, text: ACTIVITY }], [], noCleanup);
  const interest = r.rows.find((x) => x.txn_type === 'interest');
  assert.deepEqual([interest.posted_date, interest.amount_cents], ['2026-05-31', -321]);
  assert.equal(r.reconciliation.balances_reconcile, true);
});
