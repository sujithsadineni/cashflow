import { test } from 'node:test';
import assert from 'node:assert/strict';
import { holderName } from './holder-name.js';

test('a printed holder becomes a name for People', () => {
  assert.equal(holderName('ALEX J MORGAN'), 'Alex J Morgan');
  assert.equal(holderName("  MARY-ANN  O'NEIL "), "Mary-Ann O'Neil");
  assert.equal(holderName(null), '');
});
