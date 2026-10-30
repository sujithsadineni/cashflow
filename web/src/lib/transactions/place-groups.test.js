import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeTree, placeLabel } from './place-groups.js';

const places = [
  { key: 'online', label: 'Online', count: 509 },
  { key: 'Springfield|TX', label: 'Springfield, TX', count: 474 },
  { key: 'Shelbyville|NC', label: 'Shelbyville, NC', count: 171 },
  { key: 'Ogdenville|NC', label: 'Ogdenville, NC', count: 89 },
  { key: 'Capital City|TX', label: 'Capital City, TX', count: 16 },
  { key: 'Faraway|ZZ', label: 'Faraway, ZZ', count: 400 },
  { key: 'Shelbyville|', label: 'Shelbyville', count: 1 },
  { key: 'Nowhere|', label: 'Nowhere', count: 2 },
];

test('places as states, the busiest first, each with its cities; Online apart, Elsewhere last (D369, D370)', () => {
  const { online, states } = placeTree(places);
  assert.equal(online.count, 509);
  assert.deepEqual(states.map((s) => [s.name, s.key, s.count]), [
    ['Texas', 'state:TX', 490],
    ['North Carolina', 'state:NC', 261],
    ['Elsewhere', null, 402],
  ]);
  assert.deepEqual(states[1].cities.map((c) => [c.city, c.key]), [
    ['Shelbyville', 'Shelbyville|NC'], ['Ogdenville', 'Ogdenville|NC'], ['Shelbyville (state not printed)', 'Shelbyville|'],
  ]);
});

test('a picked place keeps its state in its chip; a whole state says so (D369, D370)', () => {
  assert.equal(placeLabel(places, 'Ogdenville|NC'), 'Ogdenville, NC');
  assert.equal(placeLabel(places, 'state:TX'), 'All of Texas');
});
