import { test } from 'node:test';
import assert from 'node:assert/strict';
import { highUse, spendJumps } from './card-alerts.js';

const card = (extra) => ({ account_id: 1, account_name: 'Card', mask: '1111', period_end: '2026-10-25', ...extra });

test('high use: 30% or more of the printed limit, else the household\'s own', () => {
  const list = highUse([
    card({ account_id: 1, closing_balance_cents: 494836, credit_limit_cents: 1000000 }),
    card({ account_id: 2, closing_balance_cents: 990000, credit_limit_cents: 1000000 }),
    card({ account_id: 3, closing_balance_cents: 290000, credit_limit_cents: 1000000 }),
    card({ account_id: 4, closing_balance_cents: 400000, credit_limit_cents: null, credit_limit_manual_cents: 1150000 }),
    card({ account_id: 5, closing_balance_cents: -500, credit_limit_cents: 1000000 }),
    card({ account_id: 6, closing_balance_cents: 500000, credit_limit_cents: null }),
  ]);
  assert.deepEqual(list.map((c) => [c.account_id, c.pct, c.manual]), [[2, 99, false], [1, 49, false], [4, 35, true]], 'worst first; under 30%, a credit balance and no limit left out');
  assert.deepEqual([list[1].used_cents, list[1].limit_cents], [494836, 1000000]);
});

test('a spending jump: twice the usual or more, and at least $200', () => {
  const list = spendJumps([
    card({ account_id: 1, spend_cents: -506414, earlier: [108272, 110000, 95000] }),
    card({ account_id: 2, spend_cents: 30000, earlier: [20000, 18000] }),
    card({ account_id: 3, spend_cents: 15000, earlier: [5000, 5000] }),
    card({ account_id: 4, spend_cents: 90000, earlier: [10000] }),
    card({ account_id: 5, spend_cents: 60000, earlier: [20000, null, 30000, 1000000] }),
  ]);
  assert.deepEqual(list.map((c) => [c.account_id, c.usual_cents, c.ratio]), [[4, 10000, 9], [1, 104424, 4.8], [5, 25000, 2.4]],
    'under 2× and under $200 are left out; one statement before is enough for a new card; only the last three count');
  assert.deepEqual(spendJumps([card({ spend_cents: 90000, earlier: [] })]), [], 'a first statement has nothing to compare with');
  assert.equal(list[1].spend_cents, 506414, 'a size, whichever way the reader signed it');
});
