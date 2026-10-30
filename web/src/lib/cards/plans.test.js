import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activePlans, planLine, loanFromPlan } from './plans.js';

const money = (c) => `$${(c / 100).toFixed(2)}`;
const plan = (over) => ({ created_on: '2026-08-11', description: 'CORNER STORE', months: 3, remaining_cents: 80000, monthly_principal_cents: 40000, monthly_fee_cents: 480, payment_due_cents: 40480, ...over });

test('only plans with principal left are active; the back says how much and what\'s due', () => {
  const plans = { payment_due_cents: 40480, items: [plan(), plan({ description: 'PAID OFF', remaining_cents: 0 })] };
  assert.deepEqual(activePlans(plans).map((p) => p.description), ['CORNER STORE']);
  assert.equal(planLine(plans, money), 'Plan It: $800.00 left on 1 plan · $404.80 due');
  assert.equal(planLine({ items: [plan({ remaining_cents: 0 })] }, money), null);
  assert.equal(planLine(null, money), null);
});

test('a plan becomes a loan with its own figures, its last payment the deadline', () => {
  assert.deepEqual(loanFromPlan(plan(), { id: 9, issuer: 'American Express' }), {
    name: 'Plan It · CORNER STORE', lender: 'American Express', loan_type: 'credit_card', linked_account_id: 9,
    term_months: 3, start_date: '2026-08-11', monthly_payment_cents: 40480, current_balance_cents: 80000, deadline_date: '2026-11-11',
  });
});
