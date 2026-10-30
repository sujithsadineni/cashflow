import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flowCategory } from './flow-category.js';

test('a row that moves money is filed by what it is, with no history (D417)', () => {
  const f = (txn_type, description, amount_cents = -100) => flowCategory({ txn_type, description, amount_cents });
  assert.equal(f('payment', 'AUTOPAY PAYMENT - THANK YOU', 5000), 'Card Payment');
  assert.equal(f('payment', 'SAMPLE BANK Auto Draft PPD ID: 0123', -52100), 'Loan');
  assert.equal(f('purchase', 'Zelle payment to SAM RIVERA Conf# x1'), 'Zelle');
  assert.equal(f('deposit', 'ACME WIDGETS DES:PAYROLL ID:X', 320000), 'Salary');
  assert.equal(f('deposit', 'IRS TREAS 310 TAX REF', 9000), 'Tax-Refund');
  assert.equal(f('deposit', 'BKOFAMERICA ATM 10/02 DEPOSIT', 4000), 'Cash Deposit');
  assert.equal(f('transfer', 'ROBINHOOD DES:DEBITS ID:X'), 'Investment');
  assert.equal(f('transfer', 'Online Banking transfer to SAV 1234'), 'Transfers');
  assert.equal(f('cashback', 'CASH BACK REWARD', 500), 'Cashback');
  assert.equal(f('refund', 'SAMPLE STORE RETURN', 1200), 'Refund');
  assert.equal(f('fee', 'ANNUAL MEMBERSHIP FEE'), 'Annual Fee');
  assert.equal(f('purchase', 'SAMPLE GROCER 12'), null, 'a purchase is its merchant\'s');
  assert.equal(f('deposit', 'SAMPLE DEPOSIT', 500), null);
});
