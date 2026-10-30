import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanDomain, cleanName, renameTarget } from './merchant-names.js';

test('a typed website becomes its hostname', () => {
  assert.equal(cleanDomain('https://www.Northwind-Bakery.com/menu?x=1'), 'northwind-bakery.com');
  assert.equal(cleanDomain('shop.example.co.uk'), 'shop.example.co.uk');
  assert.equal(cleanDomain('example.com:8080'), 'example.com');
  assert.equal(cleanDomain('not a site'), null);
  assert.equal(cleanDomain('localhost'), null);
  assert.equal(cleanDomain(''), null);
  assert.equal(cleanDomain(null), null);
});

test('names are trimmed to single spaces', () => {
  assert.equal(cleanName('  Corner   Bakery '), 'Corner Bakery');
});

test('a new name renames; an existing one merges under its own spelling', () => {
  const existing = ['Corner Bakery', 'Northwind Market', 'Northwind Gas'];
  assert.deepEqual(renameTarget('Northwind Gas', 'Northwind Fuel', existing), { to: 'Northwind Fuel', merge: false });
  assert.deepEqual(renameTarget('Northwind Gas', 'northwind market', existing), { to: 'Northwind Market', merge: true });
  assert.deepEqual(renameTarget('Corner Bakery', 'corner bakery', existing), { to: 'corner bakery', merge: false });
  assert.deepEqual(renameTarget('Corner Bakery', '  Corner Bakery ', existing), { error: 'That’s its name already' });
  assert.deepEqual(renameTarget('Corner Bakery', '   ', existing), { error: 'Give it a name' });
});
