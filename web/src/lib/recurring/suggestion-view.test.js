import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evidence, kindLine } from './suggestion-view.js';

const charge = (posted_date, amount_cents) => ({ posted_date, amount_cents });

test('a fixed bill says its rhythm, its day and its price changes (D364)', () => {
  const s = { kind: 'fixed', cadence: 'MONTHLY', day: 20, count: 9, first_date: '2026-01-20', confidence: 'high', accounts: 2, split_payments: 0,
    prices: [{ from: '2026-01-20', cents: -1190 }, { from: '2026-05-20', cents: -1286 }], charges: [charge('2026-01-20', -1190)] };
  assert.equal(kindLine(s), 'Monthly · fixed price');
  assert.deepEqual(evidence(s), [
    'Charged every month around the 20th, 9 times since Jan 2026',
    'Price changed: $11.90 → $12.86 (latest from May 2026)',
    'Paid from 2 different cards or accounts',
  ]);
});

test('a variable bill says the months it covers, its range, and how it was paid; a new one says so (D364)', () => {
  const s = { kind: 'variable', cadence: 'MONTHLY', count: 7, first_date: '2026-01-22', confidence: 'high', accounts: 5, split_payments: 1, amounts_vary: true,
    expected_amount_cents: -4000, months: { covered: 7, span: 8 }, charges: [charge('2026-01-22', -4000), charge('2026-04-14', -2000), charge('2026-07-20', -6000)] };
  assert.equal(kindLine(s), 'Monthly · amount varies');
  assert.deepEqual(evidence(s), [
    'Paid in 7 of the 8 months since Jan 2026',
    'Usually about $40.00; it has been $20.00 to $60.00',
    'Paid from 5 different cards or accounts',
    'Once paid in two parts',
  ]);
  const start = { ...s, count: 2, confidence: 'low', accounts: 1, split_payments: 0, months: { covered: 2, span: 3 } };
  assert.equal(evidence(start)[0], 'Paid 2 times since Jan 2026, about a month apart');
  assert.equal(evidence(start).at(-1), 'Only a couple of payments so far: add it if it’s a real bill');
});

test('an ignored suggestion in words (D364)', async () => {
  const { ignoredLabel } = await import('./suggestion-view.js');
  assert.equal(ignoredLabel('melt n dip|monthly|-1885'), 'melt n dip · monthly · $18.85');
  assert.equal(ignoredLabel('power co|monthly|variable'), 'power co · monthly · amount varies');
  assert.equal(ignoredLabel('Groupon'), 'Groupon · every bill');
});
