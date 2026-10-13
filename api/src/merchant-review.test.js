import { test } from 'node:test';
import assert from 'node:assert/strict';

import { matchMerchant, buildCanonicalMerchants } from './merchant-review.js';

// The canonical set as buildCanonicalMerchants returns it: normalized name → { name, count, tokens }.
const canonical = (entries) =>
  new Map(entries.map(([name, count]) => {
    const norm = name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    return [norm, { name, count, tokens: norm.split(' ') }];
  }));

const KNOWN = canonical([['Costco', 40], ['Trader Joe\'s', 25], ['On', 3], ['Amazon', 60], ['Amazon Prime', 12]]);

test('no merchant: a description containing exactly one known merchant is fixed to it', () => {
  const d = matchMerchant({ merchant: null, description: 'COSTCO WHSE #0123 770-555-0100 GA' }, KNOWN);
  assert.equal(d.action, 'fix');
  assert.equal(d.merchant, 'Costco');
});

test('no merchant: matching more than one known merchant is flagged for a person, most common first', () => {
  const d = matchMerchant({ merchant: null, description: 'AMAZON PRIME MEMBERSHIP' }, KNOWN);
  assert.equal(d.action, 'flag');
  assert.equal(d.merchant, 'Amazon');
  assert.match(d.reason, /more than one/);
});

test('no merchant: a short brand name never matches an ordinary word (the "On" dry-run bug)', () => {
  assert.deepEqual(matchMerchant({ merchant: null, description: 'INTEREST CHARGED ON PURCHASES' }, KNOWN), { action: 'none' });
});

test('no merchant and nothing known in the description → leave it alone', () => {
  assert.deepEqual(matchMerchant({ merchant: null, description: 'SOMEWHERE NEW 123' }, KNOWN), { action: 'none' });
});

test('merchant set in a different casing → fixed to the more common spelling', () => {
  // Both spellings normalize to "costco"; buildCanonicalMerchants keeps only the most
  // common casing (see the last test), so the set holds "Costco" alone.
  const d = matchMerchant({ merchant: 'COSTCO', description: 'x', ownCount: 2 }, canonical([['Costco', 40]]));
  assert.equal(d.action, 'fix');
  assert.equal(d.merchant, 'Costco');
});

test('merchant set and already the canonical spelling → nothing to do', () => {
  assert.deepEqual(matchMerchant({ merchant: 'Costco', description: 'x', ownCount: 40 }, KNOWN), { action: 'none' });
});

test('merchant that is a longer/shorter variant of a more common one → flagged, not auto-fixed', () => {
  const d = matchMerchant({ merchant: 'Trader Joe\'s Market', description: 'x', ownCount: 1 }, KNOWN);
  assert.equal(d.action, 'flag');
  assert.equal(d.merchant, 'Trader Joe\'s');
});

test('a less common variant does not get flagged toward a rarer one', () => {
  // "Amazon" (60) contains in "Amazon Prime" (12): the rarer name must not pull the common one.
  assert.deepEqual(matchMerchant({ merchant: 'Amazon', description: 'x', ownCount: 60 }, KNOWN), { action: 'none' });
});

test('buildCanonicalMerchants: one entry per normalized name, most common casing, ties alphabetical', async () => {
  const client = {
    query: async () => ({
      rows: [
        { merchant: 'COSTCO', count: '2' }, { merchant: 'Costco', count: '40' },
        { merchant: 'Shell', count: '5' }, { merchant: 'SHELL', count: '5' },
        { merchant: '***', count: '1' }, // normalizes to nothing → skipped
      ],
    }),
  };
  const map = await buildCanonicalMerchants(client);
  assert.equal(map.get('costco').name, 'Costco');
  assert.equal(map.get('costco').count, 40);
  assert.equal(map.get('shell').name, 'SHELL'); // tie at 5 → alphabetical ('S' 'H' < 'S' 'h')
  assert.equal(map.size, 2);
});
