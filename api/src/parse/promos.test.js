import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractPromos, pctToBps } from './promos.js';

// Invented figures, real layouts.
const BARCLAYS = `Promotional Balance Subject Annual Percentage Interest
Type of Balance   Rate End Date   to Interest Rate   Rate (APR)   Charge
Purchases
Standard Purchases   -   $0.00   29.74%(v)   $0.00
Balance Transfers
Standard Balance Transfers/Checks   -   $0.00   28.99%(v)   $0.00
Balance Transfer/Check Promotion   04/05/27   $4,321.00   0.00%   $0.00
Cash Advances
Standard Cash Advance   -   $0.00   29.99%(v)   $0.00`;

const BOFA = `Type of Annual Promotional Promotional Promotional Balance Interest
27.49%V   Purchases   $ 0.00   $ 0.00
27.49%V   Balance Transfers   $ 0.00   $ 0.00
Promotional APR   3.99%   BT   AB12-34567   02/13/2027   $ 1,000.00   $ 3.28
28.24%V   Direct Deposit and Check Cash $ 0.00   $ 0.00
Advances
Promotional APR   0.00%   DD   LR25-00001   10/13/2027   $ 5,550.55   $ 0.00
28.24%V   Bank Cash Advances   $ 0.00   $ 0.00`;

test('percent to basis points without floats', () => {
  assert.equal(pctToBps('29.74'), 2974);
  assert.equal(pctToBps('0.00'), 0);
  assert.equal(pctToBps('3.9'), 390);
  assert.equal(pctToBps('5'), 500);
});

test('Barclays: the promo line, with the standard rate printed just before it', () => {
  assert.deepEqual(extractPromos([{ text: 'page one' }, { text: BARCLAYS }]), [{
    kind: 'balance_transfer', label: 'Balance Transfer/Check Promotion', offer_id: null,
    apr_bps: 0, standard_apr_bps: 2899, end_date: '2027-04-05', balance_subject_cents: 432100,
  }]);
});

test('BofA: several promos on one card, each with its own type, offer and standard rate', () => {
  assert.deepEqual(extractPromos([{ text: BOFA }]), [
    { kind: 'balance_transfer', label: 'Balance transfer promotion', offer_id: 'AB12-34567', apr_bps: 399, standard_apr_bps: 2749, end_date: '2027-02-13', balance_subject_cents: 100000 },
    { kind: 'cash_advance', label: 'Direct deposit promotion', offer_id: 'LR25-00001', apr_bps: 0, standard_apr_bps: 2824, end_date: '2027-10-13', balance_subject_cents: 555055 },
  ]);
});

test('a statement with no promo table has no promos', () => {
  assert.deepEqual(extractPromos([{ text: 'Standard Purchases   -   $0.00   29.74%(v)   $0.00' }, { text: null }]), []);
});
