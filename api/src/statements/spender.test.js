import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSpender, originalPurchase, normalizePrintedName } from './spender.js';

// Invented people: person 1 owns the card, person 2 is an additional member with their own card.
const members = [
  { person_id: 1, printed_name: 'ALEX J MORGAN', card_ending: null, is_active: true },
  { person_id: 2, printed_name: 'Sam  Rivera', card_ending: '8765', is_active: true },
];
const ownMasks = ['4321', '1111'];

test('a printed name is compared without case, spacing or punctuation', () => {
  assert.equal(normalizePrintedName(' Sam  rivera. '), 'SAM RIVERA');
});

test('a member\'s card ending decides, even when the name is printed another way', () => {
  assert.deepEqual(resolveSpender({ spender_name: 'S RIVERA', card_ending: '8765' }, { members, ownMasks }), { personId: 2, proposed: false });
});

test('then the exact printed name', () => {
  assert.deepEqual(resolveSpender({ spender_name: 'sam rivera' }, { members, ownMasks }), { personId: 2, proposed: false });
  assert.deepEqual(resolveSpender({ spender_name: 'ALEX J MORGAN', card_ending: '4321' }, { members, ownMasks }), { personId: 1, proposed: false });
});

test('the account\'s own card is its person, with nothing to propose', () => {
  assert.deepEqual(resolveSpender({ spender_name: 'A MORGAN', card_ending: '1111' }, { members: [], ownMasks }), { personId: null, proposed: false });
});

test('a name or card ending no member has is proposed, and counts as the account\'s person meanwhile', () => {
  assert.deepEqual(resolveSpender({ spender_name: 'PAT LEE', card_ending: '2468' }, { members, ownMasks }), { personId: null, proposed: true });
  assert.deepEqual(resolveSpender({ spender_name: 'PAT LEE' }, { members, ownMasks }), { personId: null, proposed: true });
});

test('a row the reader didn\'t tag (a payment, a credit, a card that isn\'t shared) names nobody', () => {
  assert.deepEqual(resolveSpender({}, { members, ownMasks }), { personId: null, proposed: false });
});

test('an inactive member no longer matches, and two members printed alike are asked about', () => {
  const ended = members.map((m) => (m.person_id === 2 ? { ...m, is_active: false } : m));
  assert.equal(resolveSpender({ spender_name: 'SAM RIVERA', card_ending: '8765' }, { members: ended, ownMasks }).proposed, true);
  const twins = [...members, { person_id: 3, printed_name: 'SAM RIVERA', card_ending: null }];
  assert.equal(resolveSpender({ spender_name: 'SAM RIVERA' }, { members: twins, ownMasks }).proposed, true);
});

const purchases = [
  { id: 10, posted_date: '2026-03-01', amount_cents: -5000, merchant: 'Shoe Store', description: 'SHOE STORE 9', spender_person_id: 2 },
  { id: 11, posted_date: '2026-03-20', amount_cents: -2000, merchant: 'Shoe Store', description: 'SHOE STORE 9', spender_person_id: null },
  { id: 12, posted_date: '2026-03-05', amount_cents: -9000, merchant: null, description: 'MARKET 12 MAIN', spender_person_id: 2 },
];

test('a refund follows the latest same-merchant purchase at least its size', () => {
  assert.equal(originalPurchase({ posted_date: '2026-03-25', amount_cents: 1500, merchant: 'Shoe Store' }, purchases).id, 11);
  // Bigger than the latest purchase: the earlier one it can have come from.
  assert.equal(originalPurchase({ posted_date: '2026-03-25', amount_cents: 3000, merchant: 'Shoe Store' }, purchases).id, 10);
});

test('without a merchant, the same description; never a purchase after the refund or too long before', () => {
  assert.equal(originalPurchase({ posted_date: '2026-03-06', amount_cents: 900, merchant: null, description: 'market 12 main' }, purchases).id, 12);
  assert.equal(originalPurchase({ posted_date: '2026-02-28', amount_cents: 100, merchant: 'Shoe Store' }, purchases), null);
  assert.equal(originalPurchase({ posted_date: '2026-12-01', amount_cents: 100, merchant: 'Shoe Store' }, purchases), null);
  assert.equal(originalPurchase({ posted_date: '2026-03-25', amount_cents: 100, merchant: 'Cafe' }, purchases), null);
});

test('a member added before their section printed takes the first section that isn\'t the owner\'s, if they\'re the only one waiting', () => {
  const expecting = [{ person_id: 2, printed_name: null, card_ending: null, is_active: true }];
  assert.deepEqual(resolveSpender({ spender_name: 'S RIVERA', card_ending: '8765' }, { members: expecting, ownMasks }), { personId: 2, proposed: false });
  assert.deepEqual(resolveSpender({ spender_name: 'A MORGAN', card_ending: '4321' }, { members: expecting, ownMasks }), { personId: null, proposed: false }, 'the owner\'s own card stays theirs');
  const two = [...expecting, { person_id: 3, printed_name: null, card_ending: null, is_active: true }];
  assert.equal(resolveSpender({ spender_name: 'S RIVERA', card_ending: '8765' }, { members: two, ownMasks }).proposed, true);
});
