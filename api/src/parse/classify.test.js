import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { scorePage, classifyFromScore, classifyPages, findRepeatingLines } from './classify.js';

/* ------------------------------------------------------------------
   Synthetic fixtures — committed to the repo.
   Fabricated data with the same structural shape as real statements
   (see the ground-truth table in docs/DECISIONS.md for the real
   numbers this classifier was tuned against). No real names, no real
   account numbers.
   ------------------------------------------------------------------ */

const SUMMARY_PAGE = `
Customer Service Information
JPMorgan Test Bank, N.A.
JANE Q TESTPERSON
123 FAKE ST
TESTVILLE ZZ 00000
Visa Signature Account# 4111 1111 1111 1111
July 14 - August 13, 2026
Account Summary
New Balance Total $627.87
Previous Balance $2,644.19
Current Payment Due $35.00
Payment Due Date 09/10/2026
Total Credit Line $30,000.00
Available Credit $29,372.13
Statement Closing Date 08/13/2026
`.trim().split('\n');

const BOILERPLATE_PAGE = `
IMPORTANT INFORMATION ABOUT THIS ACCOUNT
PAYING INTEREST - We will not charge you any interest on Purchases if you always pay your entire Grace Period Balance
Specifically you will not pay interest for an entire billing cycle on Purchases if you Paid in Full
CALCULATION OF BALANCES SUBJECT TO INTEREST RATE using the Daily Periodic Rate and Annual Percentage Rate for each balance type
HOW WE ALLOCATE YOUR PAYMENTS - Monthly minimum payments are required when you carry a balance across billing cycles
For the complete terms and conditions of your account consult your Credit Card Agreement for the full Billing Rights summary
`.trim().split('\n');

const TRANSACTIONS_PAGE_WITH_HEADER = `
JANE Q TESTPERSON Account # 4111 1111 1111 1111 July 14 - August 13, 2026
Transactions
Transaction Date Posting Date Description Amount
07/13 07/14 GENERIC STORE #100 55.25
07/18 07/20 GENERIC STORE #200 133.27
07/20 07/21 COFFEE SHOP TEST 12.86
07/22 07/23 GENERIC STORE #100 323.52
07/29 07/30 GENERIC STORE #100 433.92
08/01 08/01 STREAMING SERVICE 106.43
08/11 08/12 RETAIL STORE #300 4.81
`.trim().split('\n');

// A continuation page of the same transaction table — no header
// repeats, only the ratio of dates/amounts to lines carries it.
const TRANSACTIONS_PAGE_NO_HEADER = `
JANE Q TESTPERSON Account # 4111 1111 1111 1111 July 14 - August 13, 2026
Aug 22, 2026 SANDWICH SHOP TEST 27.43
Aug 23, 2026 BAKERY TEST PLACE 9.17
Aug 26, 2026 RIDESHARE TEST 11.18
Aug 27, 2026 RIDESHARE TEST 23.74
Aug 28, 2026 RENT PAYMENT TEST 2101.50
Aug 30, 2026 DEPARTMENT STORE TEST 63.31
`.trim().split('\n');

// A real-but-sparse transactions page: only two rows, surrounded by
// section headers and a trailing unrelated blurb. Ratio alone reads
// closer to a summary page; the header phrase has to save it. (No
// running header line here — that interaction is covered separately
// by the repeating-header test below.)
const SPARSE_TRANSACTIONS_PAGE = `
Deposits and other additions
Date Description Amount
08/17/26 Transfer from a friend for trip 196.00
Total deposits and other additions $196.00
Withdrawals and other subtractions
Date Description Amount
07/27/26 Transfer to a friend -500.00
Total other subtractions -$500.00
Tips to help protect yourself from trending scams
Do not be pressured to act quickly, pause and verify
Never grant remote access or click links from unknown senders
`.trim().split('\n');

// The interest-rate trap: repeated "$0.00" gives it a high currency
// ratio despite carrying zero real transactions.
const INTEREST_RATE_TRAP_PAGE = `
Interest charge calculation
Type of balance Annual Percentage Rate Balance Subject to Interest Interest Charged
Purchases 26.49% $0.00 $0.00
Balance Transfers 26.49% $0.00 $0.00
Cash Advances 28.24% $0.00 $0.00
Direct Deposit Advances 28.24% $0.00 $0.00
`.trim().split('\n');

const LEGAL_BOILERPLATE_PAGE = `
Billing Rights Summary
What To Do If You Think You Find A Mistake On Your Statement
In case of errors or questions about your bill write to us at the address shown on your statement
You must contact us within sixty days after the error first appeared on your statement
While we investigate you do not have to pay the amount in question
Your Rights If You Are Dissatisfied With Your Purchase are described in this section
`.trim().split('\n');

const CASHBACK_SUMMARY_PAGE = `
Your Reward Summary
9.92 Base Cash Back Earned
23.09 Category Bonus Earned
Make the most of your rewards program today
`.trim().split('\n');

/* ------------------------------------------------------------------
   Individual page classification
   ------------------------------------------------------------------ */

test('classifies a balance summary page as SUMMARY', () => {
  const { role } = classifyFromScore(scorePage(SUMMARY_PAGE));
  assert.equal(role, 'SUMMARY');
});

test('classifies interest/payment terms as BOILERPLATE', () => {
  const { role } = classifyFromScore(scorePage(BOILERPLATE_PAGE));
  assert.equal(role, 'BOILERPLATE');
});

test('classifies a dense transaction grid with a header as TRANSACTIONS', () => {
  const { role, reason } = classifyFromScore(scorePage(TRANSACTIONS_PAGE_WITH_HEADER));
  assert.equal(role, 'TRANSACTIONS');
  assert.match(reason, /header/);
});

test('classifies a transaction continuation page with no repeated header as TRANSACTIONS', () => {
  // This is the case that rules out "require the header phrase":
  // date-ratio alone must carry a continuation page.
  const { role, reason } = classifyFromScore(scorePage(TRANSACTIONS_PAGE_NO_HEADER));
  assert.equal(role, 'TRANSACTIONS');
  assert.match(reason, /date density/);
});

test('a sparse real transactions page is saved by the header phrase, not the ratio', () => {
  const score = scorePage(SPARSE_TRANSACTIONS_PAGE);
  assert.ok(score.dateRatio < 0.3, 'ratio alone should not be enough here');
  const { role } = classifyFromScore(score);
  assert.equal(role, 'TRANSACTIONS');
});

test('an interest-rate table with repeated $0.00 is not mistaken for transactions', () => {
  const score = scorePage(INTEREST_RATE_TRAP_PAGE);
  assert.ok(score.currencyRatio > 0.5, 'currency ratio should look deceptively high');
  const { role } = classifyFromScore(score);
  assert.equal(role, 'BOILERPLATE');
});

test('legal boilerplate with no dates is classified BOILERPLATE even via the prose-length rule', () => {
  const { role } = classifyFromScore(scorePage(LEGAL_BOILERPLATE_PAGE));
  assert.equal(role, 'BOILERPLATE');
});

test('a cashback figure always routes to SUMMARY, regardless of other signals', () => {
  const { role, reason } = classifyFromScore(scorePage(CASHBACK_SUMMARY_PAGE));
  assert.equal(role, 'SUMMARY');
  assert.match(reason, /cashback/);
});

test('an empty or near-empty page defaults to SUMMARY rather than being dropped', () => {
  const { role } = classifyFromScore(scorePage(['This page intentionally left blank']));
  assert.equal(role, 'SUMMARY');
});

/* ------------------------------------------------------------------
   Repeating header/footer stripping
   ------------------------------------------------------------------ */

test('a running header repeated on every page is excluded from scoring', () => {
  const header = 'JANE Q TESTPERSON Account # 4111 1111 1111 1111 July 14 - August 13, 2026';
  const pages = [
    { lines: [header, ...SUMMARY_PAGE] },
    { lines: [header, ...BOILERPLATE_PAGE] },
    { lines: [header, 'This page intentionally left blank'] },
  ];
  const repeating = findRepeatingLines(pages);
  assert.ok(repeating.size > 0, 'the header line should be detected as repeating');

  // Without stripping, the blank page's two header dates would read
  // as 100% date density. With stripping, it correctly falls through
  // to the ambiguous-default rule instead of looking like a dense grid.
  const strippedScore = scorePage(pages[2].lines, repeating);
  assert.equal(strippedScore.dateCount, 0);
});

test('classifyPages marks a page with no text layer as NEEDS_IMAGE, never silently dropped', () => {
  const pages = [
    { pageNumber: 1, lines: SUMMARY_PAGE, text: SUMMARY_PAGE.join('\n'), hasTextLayer: true },
    { pageNumber: 2, lines: [], text: '', hasTextLayer: false },
  ];
  const results = classifyPages(pages);
  assert.equal(results[0].role, 'SUMMARY');
  assert.equal(results[1].role, 'NEEDS_IMAGE');
});

/* ------------------------------------------------------------------
   Real fixtures — only present on the machine that extracted them
   (data/ is gitignored). When absent, this suite still fully
   exercises the classifier via the synthetic fixtures above.
   ------------------------------------------------------------------ */

const FIXTURES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../data/statement-pages'
);

// Note on one entry in ground-truth.json: a literal "This page
// intentionally left blank" page classifies as SUMMARY, not
// BOILERPLATE — after its running header/footer are stripped there is
// no boilerplate phrase to justify dropping it, so the ambiguous-page
// default (never drop, include conservatively) applies. That's the
// correct behavior, not a classifier gap: sending one blank page costs
// a handful of tokens; dropping a real page silently costs data.

test('real statement fixtures match ground truth, when available', async (t) => {
  let groundTruth;
  try {
    groundTruth = JSON.parse(await readFile(path.join(FIXTURES_DIR, 'ground-truth.json'), 'utf8'));
  } catch {
    t.skip('no local statement-pages fixtures on this machine');
    return;
  }

  const files = await readdir(FIXTURES_DIR);

  for (const [hash, expectedRoles] of Object.entries(groundTruth)) {
    const pageFiles = files
      .filter((f) => f.startsWith(`${hash}_p`))
      .sort((a, b) => {
        const na = Number(a.match(/_p(\d+)\.txt$/)[1]);
        const nb = Number(b.match(/_p(\d+)\.txt$/)[1]);
        return na - nb;
      });

    assert.equal(pageFiles.length, expectedRoles.length, `${hash}: page count`);

    const pages = await Promise.all(
      pageFiles.map(async (f) => {
        const text = await readFile(path.join(FIXTURES_DIR, f), 'utf8');
        const lines = text.split('\n').filter((l) => l.trim());
        return { lines, hasTextLayer: text.length >= 20 };
      })
    );

    const results = classifyPages(pages);

    results.forEach((result, i) => {
      assert.equal(
        result.role,
        expectedRoles[i],
        `${hash} page ${i + 1}: expected ${expectedRoles[i]}, got ${result.role} (${result.reason})`
      );
    });
  }
});
