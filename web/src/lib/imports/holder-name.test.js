import { test } from 'node:test';
import assert from 'node:assert/strict';
import { holderName } from './holder-name.js';

test('a printed holder becomes a name for People', () => {
  assert.equal(holderName('ALEX J MORGAN'), 'Alex J Morgan');
  assert.equal(holderName("  MARY-ANN  O'NEIL "), "Mary-Ann O'Neil");
  assert.equal(holderName(null), '');
});

test('a holder printed with or without a middle name is the same person; a shared first name isn\'t', async () => {
  const { personForHolder } = await import('./holder-name.js');
  const people = [{ id: 1, name: 'Alex J Morgan' }, { id: 2, name: 'Sam N Rivera' }];
  assert.equal(personForHolder('SAM RIVERA', people)?.id, 2);
  assert.equal(personForHolder('ALEX MORGAN', people)?.id, 1);
  assert.equal(personForHolder('ALEX JAMES MORGAN', [{ id: 1, name: 'Alex Morgan' }])?.id, 1);
  assert.equal(personForHolder('ALEX RIVERA', people), null, 'one word in common each way');
  assert.equal(personForHolder('SAM', people), null);
  assert.equal(personForHolder(null, people), null);
});
