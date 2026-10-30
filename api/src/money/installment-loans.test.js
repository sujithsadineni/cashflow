import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installmentSuggestions, lenderOf } from './installment-loans.js';

const months = (description, cents, dates, extra = {}) => dates.map((posted_date) => ({
  account_id: 7, account_name: 'Sample Checking', posted_date, amount_cents: -cents, description, merchant: null,
  txn_type: 'purchase', category_name: null, card_payment: false, ...extra,
}));
const DATES = ['2026-05-13', '2026-06-15', '2026-07-13', '2026-08-13'];

test('the same payment to a lender every month is a loan nobody has entered (D419)', () => {
  const rows = [
    ...months('SAMPLE BANK Auto Draft PPD ID: 0123456789', 52_100, DATES, { txn_type: 'payment' }),
    ...months('ACME LENDING CO I DES:Sam Sample ID: INDN:Sam Sample CO ID:', 180_000, DATES),
  ];
  const got = installmentSuggestions({ rows, today: '2026-08-30' });
  assert.deepEqual(got.map((s) => [s.lender, s.loan_type, s.monthly_payment_cents, s.start_date, s.payments, s.key]), [
    ['Acme Lending Co', 'other', 180_000, '2026-05-13', 4, 'pay:7:180000'],
    ['Sample Bank', 'car', 52_100, '2026-05-13', 4, 'pay:7:52100'],
  ]);
});

test('bills, card payments, small or stopped payments and loans already tracked are not suggested (D419)', () => {
  const rows = [
    ...months('SAMPLE PROPERTIES DES:RENT ID:1', 150_000, DATES, { category_name: 'Rent' }),
    ...months('SAMPLE CARD DES:PAYMENT ID:1', 90_000, DATES, { card_payment: true }),
    ...months('STREAMING LOAN CLUB', 1_500, DATES),
    ...months('PLAIN SHOP', 40_000, DATES), // no loan words, not a company ACH
    ...months('Robinhood DES:Funds ID:1 PPD', 600_000, DATES), // investing
    ...months('OLD AUTO LOAN PPD', 30_000, ['2025-01-05', '2025-02-05', '2025-03-05']),
    ...months('TRACKED BANK Auto Draft PPD ID: 1', 25_000, DATES),
    ...months('SAMPLE BANK Auto Draft PPD ID: 0123456789', 52_100, DATES),
    ...months('SPARSE LOAN PPD', 20_000, ['2026-02-01', '2026-05-01', '2026-08-01']),
  ];
  const got = installmentSuggestions({
    rows, today: '2026-08-30', loans: [{ lender: 'Tracked Bank', monthly_payment_cents: 25_000 }], dismissed: ['pay:7:52100'],
  });
  assert.deepEqual(got, []);
});

test("a lender's name is the words before the bank's codes (D419)", () => {
  assert.equal(lenderOf('SAMPLE BANK Auto Draft PPD ID: 0123'), 'Sample Bank');
  assert.equal(lenderOf('ACME LENDING CO I DES:Sam ID:'), 'Acme Lending Co');
  assert.equal(lenderOf('Riverton Credit Union Loan Pmt 22'), 'Riverton Credit Union');
});
