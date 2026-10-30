import { test } from 'node:test';
import assert from 'node:assert/strict';
import { earlierCards, earlierProducts, printedOn } from './card-history.js';

// Invented account with the real shape: two reissues and an upgrade.
const upgraded = {
  mask: '5105',
  card_history: [
    { mask: '5110', product: 'Everyday', from: '2023-02-22', to: '2023-12-25' },
    { mask: '5104', product: 'Everyday', from: '2024-01-25', to: '2024-01-25' },
    { mask: '5107', product: 'Preferred', from: '2024-02-23', to: '2024-02-23' },
    { mask: '5105', product: 'Preferred', from: '2024-03-25', to: '2026-09-24' },
  ],
};

test('earlier numbers and the product it was before', () => {
  assert.equal(earlierCards(upgraded), 'Earlier cards ··5110 ··5104 ··5107');
  assert.equal(earlierProducts(upgraded), 'Everyday until Jan 2024');
});

test('a reissue with no product read: numbers only', () => {
  const reissued = { mask: '5108', card_history: [{ mask: '5103', product: null, to: '2026-02-13' }, { mask: '5108', product: null, to: '2026-09-13' }] };
  assert.equal(earlierCards(reissued), 'Earlier cards ··5103');
  assert.equal(earlierProducts(reissued), null);
  assert.equal(earlierCards({ mask: '5111', card_history: [] }), null);
});

test('a statement names its card only when it is not the current one', () => {
  assert.equal(printedOn({ card_mask: '5104', product_name: 'Everyday' }, upgraded), 'Everyday ··5104');
  assert.equal(printedOn({ card_mask: '5107', product_name: 'Preferred' }, upgraded), 'Preferred ··5107');
  assert.equal(printedOn({ card_mask: '5105', product_name: 'Preferred' }, upgraded), null);
  assert.equal(printedOn({ card_mask: null }, upgraded), null);
});
