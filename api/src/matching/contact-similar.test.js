import { test } from 'node:test';
import assert from 'node:assert/strict';
import { whySimilar, similarPairs } from './contact-similar.js';

test('why two names may be one person', () => {
  assert.equal(whySimilar('Quinn Parker', 'quinn parker'), 'Same name');
  assert.equal(whySimilar('Rowan Lee', 'Rowan James Lee'), 'One name is inside the other');
  assert.equal(whySimilar('Rowan', 'Rowan Lee'), 'One name is inside the other');
  assert.equal(whySimilar('Avery Cousin', 'Avery Stone'), 'Same first name');
  assert.equal(whySimilar('Avery 7-11', 'Avery Stone'), 'One name is inside the other', 'a store number is not a word');
  assert.equal(whySimilar('Eric Stone', 'Erik 7-11'), 'Similar first name', 'one letter apart');
  assert.equal(whySimilar('Lina', 'Carolina Park'), 'Similar first name', 'one ends with the other');
  assert.equal(whySimilar('Sam Lee', 'Sami Park'), null, 'too short to call close');
  assert.equal(whySimilar('Ana Stone', 'Diana Park'), null, 'a full name ending another is usually another name');
  assert.equal(whySimilar('Kai Bo Park', 'Kai Noa Lee', new Set(['kai'])), null, 'a leading name the household calls common');
  assert.equal(whySimilar('Kai Bo Park', 'Kai Noa Lee'), 'Same first name');
  assert.equal(whySimilar('Jordan Lee', 'Taylor Brooks'), null);
});

test('pairs: strongest first, never a pair marked different, never the household', () => {
  const contacts = [
    { id: 1, name: 'Rowan' }, { id: 2, name: 'Rowan Lee' }, { id: 3, name: 'Quinn Parker' },
    { id: 4, name: 'Quinn Parker' }, { id: 5, name: 'Rowan Hayes' }, { id: 6, name: 'Alex Morgan' }, { id: 7, name: 'Alex' },
  ];
  const pairs = similarPairs(contacts, [[5, 2]], ['Alex Morgan']);
  assert.deepEqual(pairs.map((p) => [p.a.id, p.b.id, p.why]), [
    [3, 4, 'Same name'],
    [1, 2, 'One name is inside the other'],
    [1, 5, 'One name is inside the other'],
  ]);
});
