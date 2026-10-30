import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchLogos } from './logo-search.js';

// A fake network: the company list, and which sites have an icon.
const fake = (companies, withIcon, { down = false } = {}) => async (url) => {
  if (url.startsWith('https://autocomplete.clearbit.com/')) {
    if (down) throw new Error('offline');
    return { ok: true, json: async () => companies };
  }
  const domain = url.match(/ip3\/(.+)\.ico$/)[1];
  return { ok: withIcon.includes(domain) };
};

test('suggestions keep only sites with an icon, cleaned and once each', async () => {
  const companies = [
    { name: 'Northwind Bakery', domain: 'northwindbakery.com' },
    { name: 'Northwind Bakery Shop', domain: 'WWW.NorthwindBakery.com' },
    { name: 'Northwind Bakes', domain: 'northwindbakes.example' },
    { name: 'No Site', domain: '' },
  ];
  const { results } = await searchLogos('Northwind Bakery', fake(companies, ['northwindbakery.com']));
  assert.deepEqual(results, [{ name: 'Northwind Bakery', domain: 'northwindbakery.com' }]);
});

test('nothing typed, nothing found, or the service down', async () => {
  assert.deepEqual(await searchLogos('  ', fake([], [])), { results: [] });
  assert.deepEqual(await searchLogos('Corner Shop', fake([], [])), { results: [] });
  assert.deepEqual(await searchLogos('Corner Shop', fake([], [], { down: true })), { results: [], unavailable: true });
});

test('at most six', async () => {
  const many = Array.from({ length: 10 }, (_, i) => ({ name: `Shop ${i}`, domain: `shop${i}.com` }));
  const { results } = await searchLogos('Shop', fake(many, many.map((c) => c.domain)));
  assert.equal(results.length, 6);
});
