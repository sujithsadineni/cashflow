import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keywordCategory } from './keyword-category.js';

const cats = ['Dining', 'Groceries', 'Fuel', 'Transport'];

test('plain words name the obvious category', () => {
  assert.equal(keywordCategory('HABIBI GRILL SPRINGFIELD NC', cats), 'Dining');
  assert.equal(keywordCategory('BIRYANI POT SHELBYVILLE GA', cats), 'Dining');
  assert.equal(keywordCategory('WOK N ROLL NORTH HAVERBROOK GA', cats), 'Dining');
  assert.equal(keywordCategory("MO'S SOFT SERVE CAPITAL CITY VA", cats), 'Dining');
  assert.equal(keywordCategory('ACME HALAL FRESH MEAT', cats), 'Groceries');
  assert.equal(keywordCategory('SPRINGFIELD STREET PARKING', [...cats, 'Parking & Tolls']), 'Parking & Tolls');
  assert.equal(keywordCategory('SPRINGFIELD STREET PARKING', cats.filter((c) => c !== 'Parking & Tolls')), null, 'only a category the household has');
});

test('no guess without a clear word, and never a category the household lacks', () => {
  assert.equal(keywordCategory('HUDSON ST1748 OGDENVILLE FL', cats), null);
  assert.equal(keywordCategory('TEAMVIEWER LICENSE', cats), null); // "tea" only as a whole word
  assert.equal(keywordCategory('PIZZA PALACE', ['Groceries']), null);
});

test('a line that says what it is (D337): insurance, a pharmacy, a temple, a subscription, a bus', () => {
  assert.equal(keywordCategory('ACME MUTUAL INSURANCE BLOOMINGTON IL'), 'Insurance');
  assert.equal(keywordCategory('CORNER PHARMACY JERSEY CITY NJ'), 'Health');
  assert.equal(keywordCategory('SRI GANESHA TEMPLE PITTSBURGH'), 'Gifts & Donations');
  assert.equal(keywordCategory('APPLE.COM/BILL INTERNET CHARGE CA'), 'Subscriptions');
  assert.equal(keywordCategory('FLIXBUS 1234'), 'Travel');
  assert.equal(keywordCategory('PREMIUM PARKING SPRINGFIELD'), 'Parking & Tolls', 'parking before any other word');
  assert.equal(keywordCategory('GRACE CHURCH OF SPRINGFIELD'), 'Gifts & Donations');
  assert.equal(keywordCategory('SPI*POWER CO 528 S CHURCH ST CHARLOTTE'), 'Utilities', 'a street named Church is an address, not a donation; a power company is Utilities (D417)');
});

test('fast food chains and clothing shops have their own categories, ahead of Dining (D342)', () => {
  assert.equal(keywordCategory('CHICK-FIL-A #01234 SPRINGFIELD TX'), 'Fast Food', 'not Dining for "chicken"-like words');
  assert.equal(keywordCategory("MCDONALD'S F12345 SHELBYVILLE TX"), 'Fast Food');
  assert.equal(keywordCategory('ROSS STORES #1234 SPRINGFIELD NC'), 'Clothing');
  assert.equal(keywordCategory('HABIBI GRILL SPRINGFIELD NC'), 'Dining');
});

test('Costco\'s pumps are Costco Fuel for certain, the warehouse is not (D368)', async () => {
  const { certainCategory } = await import('./keyword-category.js');
  const names = ['Costco', 'Costco Fuel', 'Fuel'];
  assert.equal(certainCategory('COSTCO GAS #0001   SPRINGFIELD   TX', names), 'Costco Fuel');
  assert.equal(certainCategory('COSTCO GASOLINE 1187 SPRINGFIELD GA', names), 'Costco Fuel');
  assert.equal(certainCategory('COSTCO WHSE #0187 SHELBYVILLE GA', names), null);
  assert.equal(certainCategory('COSTCO GAS #0001', ['Costco', 'Fuel']), null, 'only once the household has the category');
  assert.equal(keywordCategory('COSTCO GAS #0001', names), 'Costco Fuel');
});
