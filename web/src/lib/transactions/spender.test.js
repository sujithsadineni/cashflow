import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spenderNote } from './spender.js';

const row = (over) => ({ person_id: 2, account_person_id: 1, account_mask: '1111', card_ending: null, ...over });

test('a row the card\'s owner spent, or one from before shared cards, says nothing', () => {
  assert.equal(spenderNote(row({ person_id: 1 })), null);
  assert.equal(spenderNote({ person_id: 1 }), null);
});

test('someone else\'s row says how the statement showed it was theirs', () => {
  assert.equal(spenderNote(row({ card_ending: '8765' })), 'Their card ··8765 on this account');
  assert.equal(spenderNote(row({})), 'Their section of the statement');
  assert.equal(spenderNote(row({ card_ending: '1111' })), 'Their section of the statement');
});
