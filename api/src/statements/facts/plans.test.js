import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPlans } from './plans.js';

// Amex Plan It's real layout; merchants and figures invented.
test('the plans\' balance, payment due, new principal and fees, and each plan\'s line', () => {
  const text = [
    'Plan Balance', 'New Plan Principal +$1,200.00', 'Plan Fees +$4.80', 'Plan Balance = $1,204.80 See page 2', 'Plan Payment Due $404.80',
    'Created Description Duration Previous Payments/ Remaining Monthly Monthly Payment',
    '03/11/23 CORNER STORE 3 $1,200.00 $0.00 $1,200.00 $400.00 $4.80 $404.80',
    '5ANYTOWN TX',
    'Plan Totals $1,200.00 $0.00 $1,200.00 $400.00 $4.80 $404.80',
  ].join('\n');
  assert.deepEqual(readPlans(text), {
    balance_cents: 120480, payment_due_cents: 40480, new_principal_cents: 120000, fees_cents: 480,
    items: [{ created_on: '2023-03-11', description: 'CORNER STORE', months: 3, remaining_cents: 120000, monthly_principal_cents: 40000, monthly_fee_cents: 480, payment_due_cents: 40480 }],
  });
});

test('a plan line printed twice is one plan, unless Plan Totals counts it twice; no plan is null', () => {
  const line = '03/11/23 CORNER STORE 3 $1,200.00 $0.00 $1,200.00 $400.00 $4.80 $404.80';
  assert.equal(readPlans(`Plan Balance = $1,204.80\n${line}\n${line}\nPlan Totals $1,200.00 $0.00 $1,200.00 $400.00 $4.80 $404.80`).items.length, 1);
  assert.equal(readPlans(`Plan Balance = $2,409.60\n${line}\n${line}\nPlan Totals $2,400.00 $0.00 $2,400.00 $800.00 $9.60 $809.60`).items.length, 2);
  assert.equal(readPlans('Your Plan Fee will be a monthly fee of up to 1.33% of each purchase placed in a plan'), null);
});
