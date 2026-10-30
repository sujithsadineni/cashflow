import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sharedPeople, memberLine, proposedLine, memberFromProposal, addablePeople, twoInitials, onCard } from './members.js';

// Invented people and a card with the real shapes.
const people = [{ id: 1, name: 'Alex Morgan', avatar: null }, { id: 2, name: 'Sam Rivera', avatar: '🦊' }, { id: 3, name: 'Pat Lee' }];
const card = { id: 7, person_id: 1, person_name: 'Alex Morgan', members: [{ person_id: 2, person_name: 'Sam Rivera', role: 'additional', card_ending: '8765' }] };

test('a shared card shows its owner first, then the others, as people records', () => {
  assert.deepEqual(sharedPeople(card, people).map((p) => p.id), [1, 2]);
  assert.equal(sharedPeople(card, people)[1].avatar, '🦊');
});

test('a card with nobody else on it is not shared', () => {
  assert.equal(sharedPeople({ ...card, members: [] }, people), null);
  assert.equal(sharedPeople({ ...card, members: undefined }, people), null);
  assert.equal(sharedPeople({ ...card, members: [{ person_id: 1, role: 'owner' }] }, people), null);
});

test('a member says how they\'re on the card', () => {
  assert.equal(memberLine({ role: 'additional', card_ending: '8765', printed_name: 'SAM RIVERA', since: '2024-09-30' }), 'Additional card ··8765 · since Sep 2024');
  assert.equal(memberLine({ role: 'co_owner', printed_name: 'Sam Rivera', since: '2026-01-02' }), 'Co-owner since Jan 2026');
  assert.equal(memberLine({ role: 'additional', printed_name: null, card_ending: null }), 'Additional card member · waiting for their first statement');
  assert.equal(memberLine({ role: 'owner', printed_name: 'ALEX MORGAN' }), 'Owner');
});

test('a proposed name says what printed it and how much', () => {
  assert.equal(proposedLine({ printed_name: 'PAT LEE', card_ending: '2468', rows: 12, first: '2026-03-04' }), 'PAT LEE ··2468 · 12 rows since Mar 2026');
  assert.equal(proposedLine({ printed_name: 'Pat Lee', card_ending: null, rows: 1, first: '2026-03-04' }), 'Pat Lee · 1 row since Mar 2026');
});

test('a proposal becomes a member: its own card makes them additional, no card a co-owner', () => {
  assert.deepEqual(memberFromProposal({ printed_name: 'PAT LEE', card_ending: '2468', first: '2026-03-04' }, '3'),
    { person_id: 3, role: 'additional', printed_name: 'PAT LEE', card_ending: '2468', since: '2026-03-04' });
  assert.equal(memberFromProposal({ printed_name: 'Pat Lee', card_ending: null }, 3, 1).role, 'co_owner');
  assert.equal(memberFromProposal({ printed_name: 'A MORGAN', card_ending: null }, '1', 1).role, 'owner', 'the owner printed another way');
});

test('who can still be added: not the owner, not someone already on it; a removed member can come back', () => {
  assert.deepEqual(addablePeople(card, [{ person_id: 2, is_active: true }], people).map((p) => p.id), [3]);
  assert.deepEqual(addablePeople(card, [{ person_id: 2, is_active: false }], people).map((p) => p.id), [2, 3]);
});

test('the badge\'s initials are first and last, so two people starting with the same letter differ', () => {
  assert.equal(twoInitials('Sam Rivera'), 'SR');
  assert.equal(twoInitials('Sam  J  Lee'), 'SL');
  assert.equal(twoInitials('cher'), 'C');
  assert.equal(twoInitials(''), '?');
});

test('a person\'s cards include shared cards they\'re on', () => {
  assert.equal(onCard(card, '1'), true);
  assert.equal(onCard(card, '2'), true, 'a member');
  assert.equal(onCard(card, '3'), false);
});
