import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickAccountForCard } from './account-match.js';

// Invented accounts with the shape that broke: an upgraded card whose old
// numbers are another card's old and current numbers.
const preferred = { id: 1, issuer: 'American Express', name: 'Blue Cash Preferred', mask: '5105',
  cards: [{ mask: '5110', product: 'Blue Cash Everyday' }, { mask: '5104', product: 'Blue Cash Everyday' }, { mask: '5107', product: 'Blue Cash Preferred' }] };
const magnet = { id: 2, issuer: 'American Express', name: 'Cash Magnet Card', mask: '5104',
  cards: [{ mask: '5110', product: 'Cash Magnet Card' }, { mask: '5104', product: 'Cash Magnet Card' }] };
const other = { id: 3, issuer: 'Chase', name: 'Freedom', mask: '5107', cards: [] };
const all = [preferred, magnet, other];

test("the current card's number still finds its account", () => {
  assert.equal(pickAccountForCard(all, { mask: '5105', issuer: 'American Express', name: 'Blue Cash Preferred' }), 1);
});

test('a former number finds the account it was printed on, even after an upgrade', () => {
  assert.equal(pickAccountForCard(all, { mask: '5107', issuer: 'American Express', name: 'Blue Cash Preferred' }), 1);
});

test('two accounts that both had the last 4: the product printed on the statement decides', () => {
  assert.equal(pickAccountForCard(all, { mask: '5104', issuer: 'American Express', name: 'Blue Cash Everyday' }), 1);
  assert.equal(pickAccountForCard(all, { mask: '5104', issuer: 'American Express', name: 'Cash Magnet Card' }), 2);
  assert.equal(pickAccountForCard(all, { mask: '5110', issuer: 'American Express', name: 'Cash Magnet Card' }), 2);
});

test('still tied, or nothing to tell them apart: no suggestion, the person picks', () => {
  assert.equal(pickAccountForCard(all, { mask: '5104', issuer: 'American Express', name: null }), null);
  assert.equal(pickAccountForCard(all, { mask: '5104', issuer: 'American Express', name: 'Gold Card' }), null);
  assert.equal(pickAccountForCard(all, { mask: '9999', issuer: 'American Express', name: 'Blue Cash Preferred' }), null);
  assert.equal(pickAccountForCard(all, { mask: null }), null);
});

test('the same last 4 at two banks: the issuer breaks the tie, as before', () => {
  assert.equal(pickAccountForCard([preferred, other], { mask: '5107', issuer: 'Chase', name: null }), 3);
});

test('a closed account with the same card gives way to the open one', () => {
  const closed = { id: 8, issuer: 'Barclays', name: 'Samsung Card', mask: '8765', is_active: false, cards: [] };
  const open = { id: 9, issuer: 'Barclays', name: 'Samsung Card', mask: '8765', is_active: true, cards: [] };
  assert.equal(pickAccountForCard([closed, open], { mask: '8765', issuer: 'Barclays', name: 'Samsung Card' }), 9);
  assert.equal(pickAccountForCard([closed], { mask: '8765', issuer: 'Barclays', name: 'Samsung Card' }), 8);
});

test('a product name never picks an account whose last 4 says it is another one (D409)', async () => {
  const { pickAccountByName } = await import('./account-match.js');
  const one = [{ id: 1, mask: '1111' }];
  assert.equal(pickAccountByName(one, { name: 'Adv SafeBalance Banking', mask: '2222' }), null, 'same name, another account');
  assert.equal(pickAccountByName(one, { name: 'Adv SafeBalance Banking', mask: null }), 1, 'nothing printed to contradict it');
  assert.equal(pickAccountByName([{ id: 3, mask: null }], { name: 'X', mask: '2222' }), 3, 'an account with no last 4 yet');
  assert.equal(pickAccountByName([{ id: 1, mask: null }, { id: 2, mask: null }], { name: 'X', mask: null }), null, 'two alike: ask');
});
