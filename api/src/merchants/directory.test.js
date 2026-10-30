import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { directoryMerchant, directoryCategory } from './directory.js';

const entries = JSON.parse(readFileSync(new URL('./directory.json', import.meta.url), 'utf8'));
const DEFAULTS = ['Rent', 'Utilities', 'Groceries', 'Dining', 'Transport', 'Fuel', 'Shopping', 'Health', 'Subscriptions', 'Travel', 'Entertainment', 'Insurance', 'Transfers', 'Uncategorized'];

test('a statement line is named by the brand it begins with (D401)', () => {
  assert.equal(directoryMerchant("TRADER JOE S #123 SOMETOWN XX")?.merchant, "Trader Joe's");
  assert.equal(directoryMerchant('TST* STARBUCKS 0042')?.merchant, 'Starbucks');
  assert.equal(directoryMerchant('CORNER CAFE 12'), null);
});

test('a brand\'s category is the household\'s own when they have it, else the one every install starts with', () => {
  assert.equal(directoryCategory('Burger King', [...DEFAULTS, 'Fast Food']), 'Fast Food');
  assert.equal(directoryCategory('Burger King', DEFAULTS), 'Dining');
  assert.equal(directoryCategory('Someone Unknown', DEFAULTS), null);
});

test('the directory only ever holds brands: no digits, towns or people, and a category every install can use', () => {
  for (const e of entries) {
    for (const k of e.keys) assert.match(k, /^[a-z]+( [a-z]+)?$/, `${e.merchant}: ${k}`);
    if (e.category) assert.ok(e.fallback === null || DEFAULTS.includes(e.fallback), `${e.merchant}: ${e.fallback}`);
    assert.match(e.domain, /^[a-z0-9.-]+\.[a-z]+$/);
  }
});

test('a row is placed by its merchant, its line\'s key, or a brand its line starts with', async () => {
  const { directoryEntryFor } = await import('./directory.js');
  assert.equal(directoryEntryFor('CVS', null)?.merchant, 'CVS');
  assert.equal(directoryEntryFor(null, 'CVS PHARMACY #01234 SOMETOWN XX')?.merchant, 'CVS');
  assert.equal(directoryEntryFor(null, 'AplPay STARBUCKS 0042')?.merchant, 'Starbucks');
  assert.equal(directoryEntryFor(null, 'CORNER CAFE 12'), null);
});
