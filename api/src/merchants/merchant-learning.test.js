import { test } from 'node:test';
import assert from 'node:assert/strict';
import { descKeys, learnMerchants } from './merchant-learning.js';

let id = 0;
const h = (description, merchant) => ({ id: ++id, description, merchant });

test('descKeys: digits, codes and processor prefixes drop out; generic first words are skipped', () => {
  assert.deepEqual(descKeys('UBER   *EATS 8005928996 CA'), { exact: 'uber eats ca', two: 'uber eats', one: 'uber' });
  assert.deepEqual(descKeys('TST* BOTIWALLA - SPRINGFIELD SPRINGFIELD NC').two, 'botiwalla springfield');
  assert.equal(descKeys('POS DEBIT TARGET 00021').one, 'target');
  assert.equal(descKeys('FRONTIER AB12CD DENVER CO').one, 'frontier');
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
    { description: 'FRONTIER AB12CD DENVER CO' },
    { description: 'UBER *ONE MEMBERSHIP' },
    { description: 'SOMEWHERE NEW 123' },
  ]);
  assert.deepEqual(got.get(0), { merchant: 'Uber Eats', how: 'exact' });
  assert.deepEqual(got.get(1), { merchant: 'Frontier Airlines', how: 'one' });
  // "uber" alone is Uber and Uber Eats, too ambiguous; the line names Uber's product itself (D420).
  assert.deepEqual(got.get(2), { merchant: 'Uber One', how: 'brand' });
  assert.equal(got.has(3), false);
});

test('a row is never its own evidence, one row is not enough for the looser levels, and Zelle is left alone', () => {
  const only = h('ACME WIDGETS 123', 'Acme');
  assert.equal(learnMerchants([only], [only]).size, 0);
  assert.equal(learnMerchants([h('FOOBAR STORE 1', 'Foobar')], [{ description: 'FOOBAR 999 OTHER' }]).size, 0);
  const zelle = [h('Zelle payment to SAM RIVERA', 'zelle'), h('Zelle payment to SAM RIVERA', 'zelle')];
  assert.equal(learnMerchants(zelle, [{ description: 'Zelle payment to SAM RIVERA' }]).size, 0);
});

// D265: a transfer the household named is named the same on the next statement,
// but only from the very same line: transfer lines share most of their words.
test('exactOnly: the same transfer line takes its name; a similar one does not', () => {
  const history = [{ id: 1, description: 'ACH Deposit from Chase', merchant: 'Savings from Chase' }];
  const named = learnMerchants(history, [{ description: 'ACH Deposit from Chase' }], { exactOnly: true });
  assert.equal(named.get(0)?.merchant, 'Savings from Chase');
  const other = learnMerchants(history, [{ description: 'ACH Deposit from Chase Savings' }, { description: 'Transfer from Chase' }], { exactOnly: true });
  assert.equal(other.size, 0);
});

test('exactOnly never guesses from a known brand at the start of the line', () => {
  assert.equal(learnMerchants([], [{ description: 'CHASE TRANSFER 1234' }], { exactOnly: true }).size, 0);
});

test('a first word alone never names a line that reads as a name of its own (D420)', () => {
  const history = [h('LOTUS BROTHERS 0718 RIVERTON TX', 'Lotus Brothers'), h('LOTUS BROTHERS RIVERTONTXUSA', 'Lotus Brothers')];
  const got = learnMerchants(history, [{ description: 'AplPay LOTUS TEA HOUSE RIVERTON TX' }, { description: 'LOTUS 0718 RIVERTON TX' }]);
  assert.equal(got.has(0), false);
  assert.deepEqual(got.get(1), { merchant: 'Lotus Brothers', how: 'one' });
});

test('H&M keeps its letters in a line\'s keys (D420)', () => {
  assert.equal(descKeys('H&M 0572 RIVERTON TX').two, 'hm riverton');
});

