import { test } from 'node:test';
import assert from 'node:assert/strict';
import { companyOf, pickWalletCards } from './wallet-pick.js';

// Invented accounts shaped like the household's.
const A = (id, name, issuer, type = 'CREDIT_CARD', image = true) => ({ id, name, issuer, account_type: type, image_path: image ? `x/${id}.png` : null, is_active: true });
const ACCOUNTS = [
  A(1, 'Everyday Checking', 'Bank of America', 'CHECKING', false),
  A(2, 'Total Checking', 'Chase', 'CHECKING', false),
  A(3, 'Robinhood Savings', 'Robinhood', 'SAVINGS', false),
  A(4, 'Apple Card', 'Goldman Sachs Bank USA'),
  A(5, 'Blue Cash Preferred', 'American Express'),
  A(6, 'Cash Magnet Card', 'American Express'),
  A(7, 'Customized Cash Rewards', 'BOFA'),
  A(8, 'Robinhood Gold Card', 'Robinhood'),
  A(9, 'Bilt Blue Card', 'Bilt'),
];

test('the Apple Card sits in the middle', () => {
  const fan = pickWalletCards(ACCOUNTS);
  assert.equal(fan.length, 5);
  assert.equal(fan[2].name, 'Apple Card');
});

test('no company twice, and a spread of kinds', () => {
  const fan = pickWalletCards(ACCOUNTS);
  const companies = fan.map(companyOf);
  assert.equal(new Set(companies).size, fan.length);
  const names = fan.map((a) => a.name);
  assert.ok(names.includes('Robinhood Gold Card'), 'the premium card');
  assert.ok(fan.some((a) => a.account_type === 'CHECKING'), 'a bank account');
  assert.ok(!names.includes('Robinhood Savings'), 'savings yields: Robinhood is already in');
});

test('"BOFA" and "Bank of America" are one company', () => {
  assert.equal(companyOf({ issuer: 'BOFA' }), companyOf({ issuer: 'Bank of America' }));
});

test('repeats only when there are too few companies', () => {
  const few = [A(1, 'Blue Cash Preferred', 'American Express'), A(2, 'Cash Magnet Card', 'American Express'), A(3, 'Gold Card', 'American Express')];
  assert.equal(pickWalletCards(few).length, 3);
});

test('no Apple Card: the premium card takes the middle', () => {
  const fan = pickWalletCards(ACCOUNTS.filter((a) => a.name !== 'Apple Card'));
  assert.equal(fan[Math.floor(fan.length / 2)].name, 'Robinhood Gold Card');
});
