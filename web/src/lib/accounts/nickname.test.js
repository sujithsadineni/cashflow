import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoNickname, baseNickname } from './nickname.js';

const card = (name, issuer, mask = null, id = 0) => ({ id, name, issuer, mask, account_type: 'CREDIT_CARD' });
const bank = (name, issuer, type, mask = null, id = 0) => ({ id, name, issuer, mask, account_type: type });

test('a card\'s nickname: initials for a long Amex or BofA product, else its name without filler (D416)', () => {
  assert.equal(baseNickname(card('Blue Cash Preferred', 'American Express')), 'BCP');
  assert.equal(baseNickname(card('Customized Cash Rewards', 'Bank of America')), 'CCR');
  assert.equal(baseNickname(card('Bilt Blue Card', 'Bilt')), 'Bilt Blue');
  assert.equal(baseNickname(card('Cash Magnet Card', 'American Express')), 'Cash Magnet', 'two real words: no initials');
  assert.equal(baseNickname(card('Frontier Airlines World Mastercard', 'Barclays')), 'Frontier');
  assert.equal(baseNickname(card('Apple Card', 'Goldman Sachs Bank USA')), 'Apple');
  assert.equal(baseNickname(card('Visa Signature', 'Bank of America')), 'BofA Visa');
});

test('a bank account\'s: the bank and the kind; two alike take their last 4', () => {
  const a = bank('Adv SafeBalance Banking', 'Bank of America', 'CHECKING', '1111', 1);
  const b = bank('Adv SafeBalance Banking', 'Bank of America', 'CHECKING', '2222', 2);
  assert.equal(autoNickname(a, [a]), 'BofA Checking');
  assert.equal(autoNickname(a, [a, b]), 'BofA Checking 1111');
  assert.equal(autoNickname(bank('Robinhood Savings', 'Robinhood', 'SAVINGS'), []), 'Robinhood Savings');
  assert.ok(autoNickname(card('A Very Long Product Name Indeed Here', 'Sample Bank'), []).length <= 24);
});
