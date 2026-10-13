import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleSummary } from './assemble.js';

// Every total the arithmetic reads, as pg returns them (bigint columns arrive as strings).
const totals = (o = {}) => ({
  current_income_cents: '500000', previous_income_cents: '400000', year_to_date_income_cents: '3000000',
  current_spend_cents: '-200000', previous_spend_cents: '-150000', year_to_date_spend_cents: '-1200000',
  current_loan_payment_cents: '-50000', previous_loan_payment_cents: '-50000', year_to_date_loan_payment_cents: '-300000',
  current_cashback_type_cents: '1000', previous_cashback_type_cents: '0', year_to_date_cashback_type_cents: '5000',
  current_statement_credit_cents: '500', previous_statement_credit_cents: '0', year_to_date_statement_credit_cents: '2000',
  current_interest_earned_cents: '490', previous_interest_earned_cents: '400', year_to_date_interest_earned_cents: '1700',
  current_fee_cents: '-2400', previous_fee_cents: '0', year_to_date_fee_cents: '-2400',
  current_interest_charged_cents: '-1832', previous_interest_charged_cents: '0', year_to_date_interest_charged_cents: '-1832',
  current_india_transfer_cents: '-100000', previous_india_transfer_cents: '0', year_to_date_india_transfer_cents: '-300000',
  current_investment_cents: '-25000', previous_investment_cents: '0', year_to_date_investment_cents: '-75000',
  ...o,
});
const rows = (r) => ({ rows: r });
const results = (o = {}) => ({
  totals: rows([totals()]), byCategory: rows([]), byPerson: rows([]), salaryLines: rows([]), otherIncome: rows([]),
  incomeByMonth: rows([{ month: '2026-07', income_cents: '400000' }, { month: '2026-08', income_cents: '500000' }]),
  spendByMonth: rows([{ month: '2026-07', spend_cents: '-150000', loan_payment_cents: '-50000' }, { month: '2026-08', spend_cents: '-200000', loan_payment_cents: '-50000' }]),
  spendByPersonCategory: rows([]), largest: rows([]),
  cashback: rows([{ current_statement_cashback_cents: '1429', previous_statement_cashback_cents: '0', year_to_date_statement_cashback_cents: '9000' }]),
  secondaryByMonth: rows([]), secondaryByAccountTxn: rows([]), secondaryByAccountStatement: rows([]),
  feeInterestTransactions: rows([]), loans: rows([{ total_cents: 0 }]), zelleSent: rows([]),
  ...o,
});

test('savings is income + spend + loan payments, for the month, the one before, the year, and each month (D220)', () => {
  const s = assembleSummary('2026-08', results());
  assert.deepEqual(s.savings, { current_savings_cents: 250000, previous_savings_cents: 200000, year_to_date_savings_cents: 1500000 });
  assert.deepEqual(s.savings_by_month, [{ month: '2026-07', savings_cents: 200000 }, { month: '2026-08', savings_cents: 250000 }]);
});

test('cashback & interest folds three cashback sources and interest earned; fees fold interest charged', () => {
  const s = assembleSummary('2026-08', results());
  assert.equal(s.secondary.cashback_interest.current_cents, 1429 + 1000 + 500 + 490);
  assert.deepEqual(s.secondary.cashback_interest.current_breakdown, { cashback_cents: 2429, statement_credit_cents: 500, interest_earned_cents: 490 });
  assert.equal(s.secondary.fee_interest.current_cents, -2400 - 1832);
  assert.equal(s.secondary.india_transfer.year_to_date_cents, -300000);
});

test('by account: transaction and statement figures merge per account, and all-zero accounts are dropped', () => {
  const s = assembleSummary('2026-08', results({
    secondaryByAccountTxn: rows([
      { account_id: 1, account_name: 'Checking', cashback_type_cents: '0', statement_credit_cents: '0', interest_earned_cents: '490', fee_cents: '0', interest_charged_cents: '0', india_transfer_cents: '0', investment_cents: '0' },
      { account_id: 2, account_name: 'Idle card', cashback_type_cents: '0', statement_credit_cents: '0', interest_earned_cents: '0', fee_cents: '0', interest_charged_cents: '0', india_transfer_cents: '0', investment_cents: '0' },
    ]),
    secondaryByAccountStatement: rows([{ account_id: 3, account_name: 'Apple Card', statement_cashback_cents: '1429' }]),
  }));
  assert.deepEqual(s.secondary_by_account.map((a) => [a.account_name, a.cashback_interest_cents]), [['Checking', 490], ['Apple Card', 1429]]);
});
