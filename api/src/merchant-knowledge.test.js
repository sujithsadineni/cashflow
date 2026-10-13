import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildKnowledge } from './merchant-knowledge.js';

const r = (merchant, description, amount_cents, txn_type, category_name, posted_date = '2026-01-01') =>
  ({ merchant, description, amount_cents, txn_type, category_name, posted_date });

test('one entry per merchant: its bank lines, and its usual type and category each way', () => {
  const [food] = buildKnowledge([
    r('Food Lion', 'FOOD LION 7777 SPRINGFIELD NC', -4210, 'purchase', 'Groceries', '2026-01-05'),
    r('Food Lion', 'FOOD LION 7777 SPRINGFIELD NC', -1999, 'purchase', 'Groceries', '2026-02-05'),
    r('Food Lion', 'FOOD LION 0012 SHELBYVILLE NC', -820, 'purchase', 'Groceries', '2026-03-05'),
    r('Food Lion', 'FOOD LION 7777 - Amex Offer Credit', 700, 'cashback', 'Cashback', '2026-03-09'),
  ]);
  assert.equal(food.count, 4);
  assert.deepEqual(food.out, { type: 'purchase', category: 'Groceries', n: 3 });
  assert.deepEqual(food.back, { type: 'cashback', category: 'Cashback', n: 1 });
  assert.equal(food.aliases[0].line, 'food lion springfield nc');
  assert.equal(food.aliases[0].n, 2);
  assert.equal(food.first_seen, '2026-01-05');
  assert.equal(food.last_seen, '2026-03-09');
});

test('Zelle and unnamed rows are not merchants', () => {
  assert.deepEqual(buildKnowledge([r('zelle', 'Zelle payment to SAM', -100, 'transfer', 'Zelle'), r(null, 'X', -1, 'purchase', null)]), []);
});
