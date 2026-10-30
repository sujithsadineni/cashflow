import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSectionTotals } from './section-totals.js';

// The real line shapes; names invented.
const page = (n, texts) => ({ n, lines: texts.map((text) => ({ text })) });

test('Amex: each card\'s new charges, between "New Charges" and its total', () => {
  const pages = [
    page(1, ['Account Ending 7-31111', 'New Charges +$200.50']),
    page(3, ['ALEX MORGAN LEE 7-31111', 'J LEE 7-32222', 'New Charges', 'ALEX MORGAN LEE 7-31111 $120.40', 'J LEE 7-32222 $80.10', 'Total New Charges $200.50', 'Card Ending 7-31111']),
  ];
  assert.deepEqual(readSectionTotals(pages), [
    { printed_name: 'ALEX MORGAN LEE', card_ending: '1111', total_cents: -12040, kind: 'charges' },
    { printed_name: 'J LEE', card_ending: '2222', total_cents: -8010, kind: 'charges' },
  ]);
});

test('Apple: each person\'s section total, not the summary on page 2', () => {
  const pages = [
    page(2, ['Total charges, credits, and returns by Alex Lee $64.20', 'Total charges, credits, and returns for this period $62.20']),
    page(4, ['Transactions by Alex Lee', 'Total charges, credits and returns $64.20', 'Transactions by Jo Lee', 'Total charges, credits and returns -$2.00']),
  ];
  assert.deepEqual(readSectionTotals(pages), [
    { printed_name: 'Alex Lee', card_ending: null, total_cents: -6420, kind: 'all' },
    { printed_name: 'Jo Lee', card_ending: null, total_cents: 200, kind: 'all' },
  ]);
});

test('a statement with no totals per person gives none', () => {
  assert.deepEqual(readSectionTotals([page(1, ['Total payments for this period -$509.85', 'Total purchase activity for this period $28.16 $2,109.00'])]), []);
});
