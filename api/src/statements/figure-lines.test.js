import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locateFigures } from './figure-lines.js';

// Real line shapes; amounts invented.
const line = (text, top) => ({ text, left: 0.1, right: 0.9, top, bottom: top + 0.01 });
const pages = [
  { n: 1, lines: [
    line('New Balance $1,240.50', 0.10),
    line('Payment Due Date 11/19/26', 0.12),
    line('Previous Balance $310.00', 0.30),
    line('Payments/Credits -$310.00', 0.31),
    line('New Charges +$1,240.50', 0.32),
    line('Fees +$0.00', 0.33),
  ] },
  { n: 5, lines: [
    line('Total Fees for this Period $0.00', 0.20),
    line('Total Fees in 2026 $95.00', 0.40),
    line('Total Interest in 2026 $0.00', 0.41),
  ] },
];
const summary = { opening_cents: 31000, closing_cents: 124050, spend_cents: -124050, payments_cents: 31000, due_date: '2026-11-19', ytd_year: 2026, ytd_fees_cents: 9500, ytd_interest_cents: 0 };

test('each figure on the line printing its amount beside its words', () => {
  const found = locateFigures(pages, summary);
  assert.deepEqual(Object.keys(found).sort(), ['closing', 'due', 'fees', 'interest', 'opening', 'payments', 'spend']);
  assert.equal(found.closing.top, 0.10, 'New Balance, not New Charges with the same amount');
  assert.equal(found.spend.top, 0.32);
  assert.equal(found.opening.top, 0.30);
  assert.equal(found.due.top, 0.12);
});

test('the year\'s fees and interest on their year-to-date lines, not the period\'s', () => {
  const found = locateFigures(pages, summary);
  assert.deepEqual([found.fees.page, found.fees.top], [5, 0.40]);
  assert.deepEqual([found.interest.page, found.interest.top], [5, 0.41]);
});

test('nothing printed, nothing lit', () => {
  assert.deepEqual(locateFigures(pages, { closing_cents: 77777, due_date: '2026-01-02' }), {});
  assert.deepEqual(locateFigures([], summary), {});
});

test('the credit line and the purchase APR, for the statement\'s notes', () => {
  const found = locateFigures([{ n: 2, lines: [line('Credit Limit $21,000.00', 0.5), line('Purchases 28.74% (v) $0.00', 0.7)] }], { credit_limit_cents: 2100000, apr_purchase_bps: 2874 });
  assert.deepEqual([found.limit.top, found.apr.top], [0.5, 0.7]);
});
