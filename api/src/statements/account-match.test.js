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

test('a reissued card (new last 4, same printed holder) stays on its account (D410)', async () => {
  const { pickAccountByName } = await import('./account-match.js');
  assert.equal(pickAccountByName([{ id: 2, mask: '5204', holder_name: 'ALEX J MORGAN' }], { mask: '5203', holder: 'Alex J  Morgan' }), 2);
  assert.equal(pickAccountByName([{ id: 1, mask: '1111', holder_name: 'ALEX MORGAN' }], { mask: '2222', holder: 'SAM RIVERA' }), null, 'another person: another account');
});

test('a reissued, upgraded or holderless statement finds its account by the balance it carries over (D411)', async () => {
  const { pickAccountByContinuity } = await import('./account-match.js');
  const card = (id, holder, closing, end = '2026-08-31') => ({ id, issuer: 'Sample Bank', account_type: 'CREDIT_CARD', holder_name: holder,
    statements: [{ period_start: '2026-08-01', period_end: end, opening_balance_cents: 100, closing_balance_cents: closing }] });
  const next = { issuer: 'Sample Bank', account_type: 'CREDIT_CARD', period_start: '2026-09-01', period_end: '2026-09-30', opening_balance_cents: 52310, closing_balance_cents: 9000 };
  assert.equal(pickAccountByContinuity([card(1, 'ALEX MORGAN', 52310), card(2, 'SAM RIVERA', 12)], next), 1, 'the balance carried over');
  assert.equal(pickAccountByContinuity([card(1, null, 52310)], { ...next, holder: null }), 1, 'no holder printed');
  assert.equal(pickAccountByContinuity([card(1, 'ALEX MORGAN', 52310)], { ...next, holder: 'SAM RIVERA' }), null, 'another person');
  assert.equal(pickAccountByContinuity([card(1, null, 52310), card(2, null, 52310)], next), null, 'two fit: ask');
  assert.equal(pickAccountByContinuity([card(1, null, 52310, '2026-07-31')], next), null, 'a gap: not its next statement');
  assert.equal(pickAccountByContinuity([card(1, null, 52310)], { ...next, issuer: 'Other Bank' }), null, 'another bank');
  // An older statement uploaded later: it closes with what the account's first statement opened with.
  const older = { issuer: 'Sample Bank', account_type: 'CREDIT_CARD', period_start: '2026-07-01', period_end: '2026-07-31', opening_balance_cents: 5, closing_balance_cents: 100 };
  assert.equal(pickAccountByContinuity([card(1, null, 52310)], older), 1);
});

test('two accounts that are one card, reissued or upgraded, are suggested for merging; two live cards are not (D411)', async () => {
  const { mergeSuggestions } = await import('./account-match.js');
  const acct = (id, holder, statements) => ({ id, issuer: 'Sample Bank', account_type: 'CREDIT_CARD', holder_name: holder, statements });
  const st = (start, end, open, close) => ({ period_start: start, period_end: end, opening_balance_cents: open, closing_balance_cents: close });
  const old = acct(1, 'ALEX', [st('2026-06-01', '2026-06-30', 0, 400), st('2026-07-01', '2026-07-31', 400, 900)]);
  const reissued = acct(2, 'ALEX', [st('2026-08-01', '2026-08-31', 900, 50)]);
  const other = acct(3, 'ALEX', [st('2026-07-01', '2026-07-31', 0, 900), st('2026-08-01', '2026-08-31', 900, 10)]);
  assert.deepEqual(mergeSuggestions([old, reissued]), [{ from: 1, into: 2 }]);
  assert.deepEqual(mergeSuggestions([old, other]), [], 'their statements share July: two cards');
  assert.deepEqual(mergeSuggestions([old, acct(4, 'SAM', [st('2026-08-01', '2026-08-31', 900, 5)])]), [], 'another person');
});

test('the same last 4 printed with another product is another card (D412)', async () => {
  const { pickAccountForCard } = await import('./account-match.js');
  const everyday = { id: 5, issuer: 'American Express', name: 'Blue Cash Everyday', mask: '5203', cards: [{ mask: '5201', product: 'Blue Cash Everyday' }] };
  assert.equal(pickAccountForCard([everyday], { mask: '5201', issuer: 'American Express', name: 'Cash Magnet Card' }), null, 'Cash Magnet is not this account');
  assert.equal(pickAccountForCard([everyday], { mask: '5201', issuer: 'American Express', name: 'Blue Cash Everyday' }), 5);
  assert.equal(pickAccountForCard([{ ...everyday, cards: [{ mask: '5201', product: null }] }], { mask: '5201', issuer: 'American Express', name: 'Cash Magnet Card' }), 5, 'no product on file: the last 4 decides');
});
