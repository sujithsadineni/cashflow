import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findSubjects, normalize, stem, vocabFrom } from './vocab.js';

// Invented names in the ledger's shapes.
const vocab = vocabFrom({
  categories: [{ id: 1, name: 'Rent' }, { id: 2, name: 'Utilities' }, { id: 3, name: 'Groceries' }, { id: 4, name: 'Fuel' }, { id: 5, name: 'Dining' }, { id: 6, name: 'Parking & Tolls' }],
  merchants: [
    { name: 'Northside Power', count: 9 }, { name: 'Lakeside Power Co', count: 2 }, { name: 'Rent', count: 1 },
    { name: 'Corner Market', count: 30 }, { name: 'River Water', count: 4 },
  ],
  accounts: [{ id: 10, name: 'Blue Card' }, { id: 11, name: 'Blue Card' }, { id: 12, name: 'Everyday Checking' }],
});
const names = (text) => findSubjects(text, vocab).subjects.map((s) => `${s.kind}:${s.name}`);

test('normalize and stem fold case, punctuation and plurals', () => {
  assert.equal(normalize("Costco's & Co."), 'costcos and co');
  assert.deepEqual(['groceries', 'payments', 'class', 'gas', 'this'].map(stem), ['grocery', 'payment', 'class', 'gas', 'this']);
});

test('whole names as words, a category beating a merchant of the same name', () => {
  assert.deepEqual(names('How much did I pay for rent this year?'), ['category:Rent']);
  assert.deepEqual(names('grocery spending last month'), ['category:Groceries']);
  assert.deepEqual(names('northside power by month'), ['merchant:Northside Power']);
  assert.deepEqual(names('rent and utilities ytd'), ['category:Rent', 'category:Utilities']);
  assert.deepEqual(names('parking & tolls'), ['category:Parking & Tolls']);
});

test('everyday words for categories, and accounts by name (one entry for cards sharing it)', () => {
  assert.deepEqual(names('gas this month'), ['category:Fuel']);
  assert.deepEqual(names('eating out vs last month'), ['category:Dining']);
  assert.deepEqual(findSubjects('spending on the blue card', vocab).subjects, [{ kind: 'account', name: 'Blue Card', ids: [10, 11] }]);
});

test('a leftover word: one merchant is used, several are choices, never a guess', () => {
  assert.deepEqual(names('corner trips this year'), ['merchant:Corner Market'], '"corner" is only in one name');
  const { subjects, choices } = findSubjects('power bill this month vs last month', vocab);
  assert.deepEqual(subjects.map((s) => s.name), ['Utilities'], '"power bill" is the everyday word');
  assert.equal(choices, null);
  const ga = findSubjects('ga power last month', vocab);
  assert.deepEqual(ga.subjects, []);
  assert.deepEqual([ga.choices.word, ga.choices.options.map((o) => o.name)], ['power', ['Northside Power', 'Lakeside Power Co']], 'most used first');
});

test('question words are never names', () => {
  assert.deepEqual(names('how much did i spend this month'), []);
  assert.deepEqual(names('top 5 merchants last year'), []);
  assert.deepEqual(names('spending by card'), []);
});
