import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseMoney, extractAmountAfterLabel, mergeContinuation,
  classifyCheckingInflow, classifyCheckingOutflow,
} from './pdf-local-helpers.js';

test('parseMoney: every printed shape the four local parsers meet', () => {
  assert.equal(parseMoney('$1,234.56'), 123456);
  assert.equal(parseMoney('-1,000.00'), -100000);
  assert.equal(parseMoney('- 154.00'), -15400); // Chase/BofA: a space after the minus
  assert.equal(parseMoney('-$ 249.12'), -24912);
  assert.equal(parseMoney('.28'), 28); // BofA rewards: no leading zero
  assert.equal(parseMoney('$0.00'), 0);
  assert.equal(parseMoney('1,234,567.89'), 123456789);
});

test('parseMoney: thousands without commas keep their leading digits (the D169 bug)', () => {
  // The comma-only pattern matched these from "234.56" / "345.67".
  assert.equal(parseMoney('1234.56'), 123456);
  assert.equal(parseMoney('12345.67'), 1234567);
  assert.equal(parseMoney('-1234.56'), -123456);
});

test('parseMoney: no amount → null, never a guess', () => {
  assert.equal(parseMoney('Total'), null);
  assert.equal(parseMoney('1234'), null); // no cents: not a printed amount
});

test('extractAmountAfterLabel: same line only, case-insensitive, both number shapes', () => {
  const text = 'Total New Charges   $1,592.62\nPrevious Balance $270.73\nTOTAL fees 1234.00';
  assert.equal(extractAmountAfterLabel(text, 'Total New Charges'), 159262);
  assert.equal(extractAmountAfterLabel(text, 'previous balance'), 27073);
  assert.equal(extractAmountAfterLabel(text, 'Total fees'), 123400);
  // A label at the end of one line must not grab the next line's number.
  assert.equal(extractAmountAfterLabel('New Balance\n$909.10', 'New Balance'), null);
  assert.equal(extractAmountAfterLabel(text, 'Not on this statement'), null);
});

test('mergeContinuation: a wrapped line joins the row above, in both description and raw text', () => {
  const row = { description: 'DELTA AIR', raw_text: '08/14 08/15 DELTA AIR 1234 2468 412.00' };
  mergeContinuation(row, 'AAA/BBB RNDTRP');
  assert.equal(row.description, 'DELTA AIR AAA/BBB RNDTRP');
  assert.equal(row.raw_text, '08/14 08/15 DELTA AIR 1234 2468 412.00 | AAA/BBB RNDTRP');
});

test('checking outflow: Zelle and self-transfers → transfer; loan drafts and card bills → payment; else purchase', () => {
  assert.deepEqual(classifyCheckingOutflow('Zelle payment to JORDAN LEE'), { txn_type: 'transfer', category: null });
  assert.deepEqual(classifyCheckingOutflow('APPLE GS SAVINGS DES:TRANSFER ID:123'), { txn_type: 'transfer', category: null });
  assert.deepEqual(classifyCheckingOutflow('WELLS FARGO AUTO DRAFT'), { txn_type: 'payment', category: null });
  assert.deepEqual(classifyCheckingOutflow('AMERICAN EXPRESS ACH PMT'), { txn_type: 'payment', category: 'Card Payment' });
  assert.deepEqual(classifyCheckingOutflow('Mobile Banking payment to CRD 2468'), { txn_type: 'payment', category: 'Card Payment' });
  assert.deepEqual(classifyCheckingOutflow('TRADER JOES #123'), { txn_type: 'purchase', category: null });
  // Word boundary: "TRANSFERWISE" is a merchant, not the bank's own TRANSFER code.
  assert.deepEqual(classifyCheckingOutflow('TRANSFERWISE INC'), { txn_type: 'purchase', category: null });
});

test('checking inflow: Zelle and self-transfers → transfer; anything else is a deposit', () => {
  assert.deepEqual(classifyCheckingInflow('Zelle payment from PRIYA SHAH'), { txn_type: 'transfer', category: null });
  assert.deepEqual(classifyCheckingInflow('SoFi Bank DES:TRANSFER'), { txn_type: 'transfer', category: null });
  assert.deepEqual(classifyCheckingInflow('ACME CORP PAYROLL PPD'), { txn_type: 'deposit', category: null });
});
