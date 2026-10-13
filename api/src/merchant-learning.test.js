import { test } from 'node:test';
import assert from 'node:assert/strict';
import { descKeys, learnMerchants } from './merchant-learning.js';

let id = 0;
const h = (description, merchant) => ({ id: ++id, description, merchant });

test('descKeys: digits, codes and processor prefixes drop out; generic first words are skipped', () => {
  assert.deepEqual(descKeys('UBER   *EATS 8005928996 CA'), { exact: 'uber eats ca', two: 'uber eats', one: 'uber' });
  assert.deepEqual(descKeys('TST* BOTIWALLA - SPRINGFIELD SPRINGFIELD NC').two, 'botiwalla springfield');
  assert.equal(descKeys('POS DEBIT TARGET 00021').one, 'target');
  assert.equal(descKeys('FRONTIER SH52VW DENVER CO').one, 'frontier');
});

test('the same line, or one that starts the same way, gets the name history gave it', () => {
  const history = [
    h('UBER *EATS 8005928996 CA', 'Uber Eats'),
    h('FRONTIER AI QWERTY 720-3744390 CO', 'Frontier Airlines'),
    h('FRONTIER AIRLINES 720-3744 CREDIT', 'Frontier Airlines'),
    h('UBER *TRIP HELP.UBER.COM', 'Uber'),
    h('UBER *TRIP HELP.UBER.COM', 'Uber'),
  ];
  const got = learnMerchants(history, [
    { description: 'UBER *EATS 8005928996 CA' },
    { description: 'FRONTIER SH52VW DENVER CO' },
    { description: 'UBER *ONE MEMBERSHIP' },
    { description: 'SOMEWHERE NEW 123' },
  ]);
  assert.deepEqual(got.get(0), { merchant: 'Uber Eats', how: 'exact' });
  assert.deepEqual(got.get(1), { merchant: 'Frontier Airlines', how: 'one' });
  assert.equal(got.has(2), false); // "uber" alone is Uber and Uber Eats: too ambiguous
  assert.equal(got.has(3), false);
});

test('a row is never its own evidence, one row is not enough for the looser levels, and Zelle is left alone', () => {
  const only = h('ACME WIDGETS 123', 'Acme');
  assert.equal(learnMerchants([only], [only]).size, 0);
  assert.equal(learnMerchants([h('FOOBAR STORE 1', 'Foobar')], [{ description: 'FOOBAR 999 OTHER' }]).size, 0);
  const zelle = [h('Zelle payment to SAM RIVERA', 'zelle'), h('Zelle payment to SAM RIVERA', 'zelle')];
  assert.equal(learnMerchants(zelle, [{ description: 'Zelle payment to SAM RIVERA' }]).size, 0);
});
