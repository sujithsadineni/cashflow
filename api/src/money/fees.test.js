import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feeKind, feesYear, isFeeRefund } from './fees.js';

test('fee and interest rows by kind', () => {
  assert.equal(feeKind({ txn_type: 'fee', description: 'DIRECT DEPOSIT - TRANSACTION FEE' }), 'transfer');
  assert.equal(feeKind({ txn_type: 'fee', description: 'BALANCE TRANSFER FEE' }), 'transfer');
  assert.equal(feeKind({ txn_type: 'fee', description: 'PRIMARY ANNUAL FEE' }), 'annual');
  assert.equal(feeKind({ txn_type: 'fee', description: 'LATE FEE FOR PAYMENT DUE' }), 'late');
  assert.equal(feeKind({ txn_type: 'fee', description: 'RETURNED PAYMENT FEE' }), 'late');
  assert.equal(feeKind({ txn_type: 'fee', description: 'Monthly Maintenance Fee' }), 'account');
  assert.equal(feeKind({ txn_type: 'interest', description: 'INTEREST CHARGED ON PURCHASES' }), 'interest');
  assert.equal(feeKind({ txn_type: 'refund', description: 'ANNUAL FEE REVERSAL' }), 'refund');
  assert.equal(feeKind({ txn_type: 'fee', description: 'Planet Fitness Iclub Fees' }), 'other');
});

test("a fee refund is a bank's, not a merchant's", () => {
  assert.equal(isFeeRefund({ txn_type: 'refund', description: 'ANNUAL FEE REVERSAL', category_name: 'Annual Fee' }), true);
  assert.equal(isFeeRefund({ txn_type: 'refund', description: 'MONTHLY SERVICE CHARGE REFUND', category_name: 'Refund' }), true);
  assert.equal(isFeeRefund({ txn_type: 'refund', description: 'Credit Adjustment for Returned Payment Fee', category_name: 'Interest' }), true);
  assert.equal(isFeeRefund({ txn_type: 'refund', description: 'COFFEE BEAN REFUND', category_name: 'Dining' }), false, 'COFFEE is not FEE');
});

test('a reversed fee nets to nothing; the year adds up by month, kind and account (D285)', () => {
  const accounts = [{ id: 1, name: 'Zolve', mask: '5114' }, { id: 2, name: 'Visa', mask: '5109' }];
  const rows = [
    { id: 1, account_id: 1, posted_date: '2026-07-17', amount_cents: -9999, txn_type: 'fee', description: 'ANNUAL FEE' },
    { id: 2, account_id: 1, posted_date: '2026-07-20', amount_cents: 9999, txn_type: 'refund', description: 'ANNUAL FEE REVERSAL' },
    { id: 3, account_id: 2, posted_date: '2026-04-11', amount_cents: -2400, txn_type: 'fee', description: 'LATE FEE FOR PAYMENT DUE' },
    { id: 4, account_id: 2, posted_date: '2026-04-13', amount_cents: -1500, txn_type: 'interest', description: 'INTEREST CHARGED ON PURCHASES' },
    { id: 5, account_id: 2, posted_date: '2025-04-13', amount_cents: -300, txn_type: 'interest', description: 'INTEREST CHARGED ON PURCHASES' },
  ];
  const y = feesYear({ rows, accounts, year: '2026' });
  assert.equal(y.total_cents, -3900);
  assert.equal(y.months[6].total, 0);
  assert.deepEqual([y.by_kind.annual, y.by_kind.refund, y.by_kind.late, y.by_kind.interest], [-9999, 9999, -2400, -1500]);
  assert.deepEqual(y.cards.map((c) => [c.name, c.total_cents]), [['Visa', -3900], ['Zolve', 0]]);
  assert.equal(y.items.length, 4);
});

test('interest coming in is earned, a bank charge is a bank fee, the rest stay (D342)', async () => {
  const { refinedFeeCategory } = await import('./fees.js');
  assert.equal(refinedFeeCategory({ txn_type: 'interest', amount_cents: 138, suggested_category: 'Interest' }), 'Interest Earned');
  assert.equal(refinedFeeCategory({ txn_type: 'interest', amount_cents: -900, suggested_category: 'Interest' }), null, 'interest charged stays');
  assert.equal(refinedFeeCategory({ txn_type: 'fee', amount_cents: -2000, description: 'LATE FEE', suggested_category: null }), 'Bank Fees');
  assert.equal(refinedFeeCategory({ txn_type: 'fee', amount_cents: -312, description: 'FOREIGN TRANSACTION FEE 3620', suggested_category: null }), 'Bank Fees');
  assert.equal(refinedFeeCategory({ txn_type: 'fee', amount_cents: -9900, description: 'ANNUAL FEE', suggested_category: null }), null);
  assert.equal(refinedFeeCategory({ txn_type: 'fee', amount_cents: -500, description: 'BALANCE TRANSFER FEE', suggested_category: null }), null);
  assert.equal(refinedFeeCategory({ txn_type: 'fee', amount_cents: -500, description: 'FOREIGN TRANSACTION FEE', suggested_category: 'Annual Fee' }), null, 'a category already set stands');
  assert.equal(refinedFeeCategory({ txn_type: 'fee', amount_cents: -500, description: 'LATE FEE' }, ['Interest']), null, 'only a category the household has');
});
