import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardProductFor } from './card-products.js';

test('a known card is drawn as its product, by issuer and printed name (D403)', () => {
  assert.equal(cardProductFor({ account_type: 'CREDIT_CARD', issuer: 'American Express', name: 'Blue Cash Preferred' })?.key, 'amex-bcp');
  assert.equal(cardProductFor({ account_type: 'CREDIT_CARD', issuer: 'Goldman Sachs Bank USA', name: 'Apple Card' })?.light, true);
  assert.equal(cardProductFor({ account_type: 'CREDIT_CARD', issuer: 'Bank of America', name: 'Customized Cash Rewards' })?.network, 'VISA');
  assert.equal(cardProductFor({ account_type: 'CHECKING', issuer: 'Bank of America', name: 'Adv SafeBalance' }), null, 'bank accounts keep their bank\'s look');
  assert.equal(cardProductFor({ account_type: 'CREDIT_CARD', issuer: 'Someone Bank', name: 'Card' }), null);
});
