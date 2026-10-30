import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readAprs } from './apr.js';

// Each bank's real wording; the rates are as printed, the amounts invented.
const none = { apr_purchase_bps: null, apr_balance_transfer_bps: null, apr_cash_advance_bps: null, apr_penalty_bps: null, apr_variable: null };

test('Amex: a date between the type and the rate; the Plan It and intro lines are skipped', () => {
  const text = [
    'and your APRs may be increased to the Penalty APR of 29.99 %.',
    'Introductory Purchase 01/25/2023 0.00% $0.00 $0.00',
    'Purchases 08/25/2023 29.24% (v) $10.00 $0.00',
    'Cash Advances 08/25/2023 29.49% (v) $0.00 $0.00',
    '08/25/2023 0.00% $0.00 $0.00 Plan It',
  ].join('\n');
  assert.deepEqual(readAprs(text), { ...none, apr_purchase_bps: 2924, apr_cash_advance_bps: 2949, apr_penalty_bps: 2999, apr_variable: true });
});

test('Bank of America: the rate first, sometimes after amounts, the type last', () => {
  const text = '27.49%V $0.00 $0.00 Purchases\n$0.00 $0.00 27.49% V Balance Transfers\n29.99%V $0.00 $0.00 Direct Deposit and Check Cash\n29.99%V $0.00 $0.00 Bank Cash Advances\nPromotional APR 0.00% BT LN#/13/2025 $0.00 $0.00';
  assert.deepEqual(readAprs(text), { ...none, apr_purchase_bps: 2749, apr_balance_transfer_bps: 2749, apr_cash_advance_bps: 2999, apr_variable: true });
});

test('Bank of America 2026: the amounts after the type', () => {
  const text = '27.74%V Purchases $0.00 $0.00\n27.74%V Balance Transfers $0.00 $0.00\n28.49%V Direct Deposit and Check Cash $0.00 $0.00\n28.49%V Bank Cash Advances $0.00 $0.00';
  assert.deepEqual(readAprs(text), { ...none, apr_purchase_bps: 2774, apr_balance_transfer_bps: 2774, apr_cash_advance_bps: 2849, apr_variable: true });
});

test('Barclays: "Standard", an amount before the rate, the promotional purchase skipped', () => {
  const text = 'Standard Purchases - $0.00 26.74%(v) $0.00\nPromotional Purchase 01/05/26 $100.00 3.99% $0.00\nStandard Balance Transfers/Checks - $0.00 26.74%(v) $0.00\nStandard Cash Advance - $0.00 33.49%(v) $0.00';
  assert.deepEqual(readAprs(text), { ...none, apr_purchase_bps: 2674, apr_balance_transfer_bps: 2674, apr_cash_advance_bps: 3349, apr_variable: true });
});

test('Bilt: (variable) and (fixed); a New Card Purchases rate is not the purchase rate', () => {
  const text = 'New Card Purchases 10.00% (fixed) $0.00 $0.00\nPurchases 26.74% (variable) $0.00 $0.00\nCash advances 31.74% (variable) $0.00 $0.00';
  assert.deepEqual(readAprs(text), { ...none, apr_purchase_bps: 2674, apr_cash_advance_bps: 3174, apr_variable: true });
});

test('Zolve, both layouts, a one-decimal rate', () => {
  assert.deepEqual(readAprs('Purchases 35.00% V $0.00 $0.00\nCash Advances 0.0% $0.00 $0.00'), { ...none, apr_purchase_bps: 3500, apr_cash_advance_bps: 0, apr_variable: true });
  assert.deepEqual(readAprs('16.0% $0.00 $0.00 Cash Advances\n16.0% (V) $0.00 $0.00 Purchases'), { ...none, apr_purchase_bps: 1600, apr_cash_advance_bps: 1600, apr_variable: true });
});

test('Apple: its one rate, in the year-to-date line', () => {
  assert.deepEqual(readAprs('2026 Total Year-to-Date: Annual Percentage Rate (APR) 19.49 % (variable)'), { ...none, apr_purchase_bps: 1949, apr_variable: true });
});

test('terms-page sentences are not rates', () => {
  assert.deepEqual(readAprs('The standard variable APR for purchases is 18.74% to 35.00%, based on your creditworthiness.\nPurchases made with your card earn rewards.'), none);
});
