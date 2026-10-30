import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentCard } from './current-card.js';

const statements = [
  { period_end: '2023-01-25', card_mask: '5201', product_name: 'Blue Cash Everyday' },
  { period_end: '2024-02-25', card_mask: '5203', product_name: 'Blue Cash Preferred' },
  { period_end: '2026-10-25', card_mask: '5204', product_name: 'Blue Cash Preferred' },
];

test('an account shows the card it is now: the newest statement\'s last 4 and product (D414)', () => {
  assert.deepEqual(currentCard({ name: 'Blue Cash Everyday', mask: '5201', issuer: 'American Express', account_type: 'CREDIT_CARD' }, statements),
    { mask: '5204', name: 'Blue Cash Preferred' });
});

test('a name the person typed stays; only the last 4 follows', () => {
  assert.deepEqual(currentCard({ name: 'Groceries card', mask: '5201', issuer: 'American Express', account_type: 'CREDIT_CARD' }, statements), { mask: '5204' });
});

test('the app\'s own default name follows the product; nothing to change, nothing changed', () => {
  assert.deepEqual(currentCard({ name: 'American Express Card', mask: '5204', issuer: 'American Express', account_type: 'CREDIT_CARD' }, statements), { name: 'Blue Cash Preferred' });
  assert.deepEqual(currentCard({ name: 'Blue Cash Preferred', mask: '5204', issuer: 'American Express', account_type: 'CREDIT_CARD' }, statements), {});
});
