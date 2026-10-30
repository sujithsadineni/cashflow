import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTidy } from './merchant-tidy.js';

const canon = (names) => new Map(names.map(([n, count]) => [n.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(), { name: n, count, tokens: n.toLowerCase().split(' ') }]));
const row = (id, description, merchant, txn_type = 'purchase', amount_cents = -500) => ({ id, description, merchant, txn_type, amount_cents });

test('an unnamed purchase whose line starts with a known merchant takes that name', () => {
  // No line in the history starts the same way, so the learner has nothing; the line names it.
  const rows = [row(1, 'CHIPOTLE 1932 MOUNTAIN VIEW CA', 'Chipotle'), row(2, 'APPLEPAY WALGREENS #123 SAN JOSE', null)];
  const p = planTidy(rows, canon([['Chipotle', 4], ['Walgreens', 3]]));
  assert.deepEqual(p.fixed.map((f) => [f.id, f.from, f.to]), [[2, null, 'Walgreens']]);
});

test("a deposit or payment line is never named from a merchant it happens to contain", () => {
  const rows = [row(1, 'ACH DEPOSIT FROM CHASE', null, 'deposit', 500), row(2, 'PAYMENT TO CHASE CARD', null, 'payment', 500)];
  const p = planTidy(rows, canon([['Chase', 9]]));
  assert.equal(p.fixed.length + p.learned.length + p.flagged.length, 0);
});

test('a name learned from the same line wins, and an answered flag is not asked again', () => {
  const rows = [row(1, 'SQ *BLUE BOTTLE OAKLAND', 'Blue Bottle'), row(2, 'SQ *BLUE BOTTLE OAKLAND', null), row(3, 'COSTCO', 'COSTCO'), row(4, 'COSTCO GAS', 'Costco Gas')];
  const p = planTidy(rows, canon([['Blue Bottle', 1], ['Costco Gas', 1], ['COSTCO', 1]]), new Set([4]));
  assert.deepEqual(p.learned.map((l) => [l.id, l.to]), [[2, 'Blue Bottle']]);
  assert.ok(!p.flagged.some((f) => f.id === 4));
});

test('$0.00 lines are left alone', () => {
  assert.equal(planTidy([row(1, 'WALGREENS', null, 'purchase', 0)], canon([['Walgreens', 3]])).fixed.length, 0);
});

test('a line nobody named is asked about once per name read off it; a name answered before is not asked again (D367)', () => {
  const rows = [
    row(1, 'AplPay HARLOWS 101 CENTRAL', null), row(2, 'AplPay HARLOWS 202 THE MAL', null),
    row(3, 'MERCHANDISE RETURN', null, 'refund', 900), row(4, 'TST* SWEETS HUT - FAIRVIEW GA', null),
    row(5, 'Zelle payment from A FRIEND', null, 'deposit', 5000), row(6, 'WM SUPERCENTER #12', null),
  ];
  const p = planTidy(rows, canon([['Wm Supercenter Plus', 2]]), new Set([4]));
  assert.deepEqual(p.flagged.map((f) => [f.id, f.current, f.suggested, f.reason]), [
    [1, null, 'Harlows', 'Read from the statement line (2 lines)'],
    [6, null, 'Wm Supercenter Plus', 'Read from the statement line'],
  ]);
});
