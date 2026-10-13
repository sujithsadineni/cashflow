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
  assert.equal(keywordCategory('SPRINGFIELD STREET PARKING', cats), 'Transport');
});

test('no guess without a clear word, and never a category the household lacks', () => {
  assert.equal(keywordCategory('HUDSON ST1748 OGDENVILLE FL', cats), null);
  assert.equal(keywordCategory('TEAMVIEWER LICENSE', cats), null); // "tea" only as a whole word
  assert.equal(keywordCategory('PIZZA PALACE', ['Groceries']), null);
});
