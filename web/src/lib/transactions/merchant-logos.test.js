import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookupMerchantDomain } from './merchant-logos.js';

test('a brand at the start of the name finds its logo', () => {
  assert.equal(lookupMerchantDomain('Chase'), 'chase.com');
  assert.equal(lookupMerchantDomain('Apple Card'), 'apple.com');
});

// D265: a move between the household's own accounts names the bank last.
test('a transfer named "… from <bank>" or "… to <bank>" takes the bank\'s logo', () => {
  assert.equal(lookupMerchantDomain('Savings from Chase'), 'chase.com');
  assert.equal(lookupMerchantDomain('Transfer from Apple Savings'), 'apple.com');
  assert.equal(lookupMerchantDomain('Transfer to Bank of America'), 'bankofamerica.com');
});

test('no brand, no logo', () => {
  assert.equal(lookupMerchantDomain('Savings from somewhere'), null);
  assert.equal(lookupMerchantDomain('Moving from'), null);
});
