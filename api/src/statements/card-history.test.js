import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardHistory } from './card-history.js';

const st = (period_end, card_mask, product_name = null) => ({ period_end, card_mask, product_name });

test('a reissue and an upgrade: one run per card, oldest first', () => {
  const h = cardHistory([
    st('2024-03-25', '5105', 'Blue Cash Preferred'),
    st('2023-11-24', '5110', 'Blue Cash Everyday'),
    st('2023-12-25', '5110', 'Blue Cash Everyday'),
    st('2024-01-25', '5104', 'Blue Cash Everyday'),
    st('2024-02-23', '5107', 'Blue Cash Preferred'),
    st('2024-04-24', '5105', 'Blue Cash Preferred'),
  ]);
  assert.deepEqual(h.map((c) => [c.mask, c.product, c.from, c.to]), [
    ['5110', 'Blue Cash Everyday', '2023-11-24', '2023-12-25'],
    ['5104', 'Blue Cash Everyday', '2024-01-25', '2024-01-25'],
    ['5107', 'Blue Cash Preferred', '2024-02-23', '2024-02-23'],
    ['5105', 'Blue Cash Preferred', '2024-03-25', '2024-04-24'],
  ]);
});

test('one card all along, or nothing read: no history', () => {
  assert.deepEqual(cardHistory([st('2026-01-05', '5111'), st('2026-02-05', '5111')]), []);
  assert.deepEqual(cardHistory([st('2026-01-05', null)]), []);
});

test('a statement with no product read stays with the card before it', () => {
  const h = cardHistory([st('2025-01-13', '5103'), st('2025-02-13', '5103'), st('2025-03-13', '5108')]);
  assert.deepEqual(h.map((c) => c.mask), ['5103', '5108']);
});
