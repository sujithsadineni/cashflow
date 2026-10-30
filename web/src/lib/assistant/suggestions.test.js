import { test } from 'node:test';
import assert from 'node:assert/strict';
import { highlight, matchSuggestions } from './suggestions.js';

const list = [
  { text: 'Rent by month this year', note: 'a' },
  { text: 'Utilities this month vs last month', note: 'b' },
  { text: 'Groceries year to date', note: 'c' },
];

test('every word typed must appear, in any order and case; nothing typed shows the first few', () => {
  assert.deepEqual(matchSuggestions('MONTH rent', list).map((s) => s.note), ['a']);
  assert.deepEqual(matchSuggestions('month', list).map((s) => s.note), ['a', 'b']);
  assert.deepEqual(matchSuggestions('  ', list, 2).map((s) => s.note), ['a', 'b']);
  assert.deepEqual(matchSuggestions('payroll', list), []);
});

test('highlight marks every occurrence and joins overlapping words into one run', () => {
  assert.deepEqual(highlight('Month vs last month', ['month']), [
    { text: 'Month', hit: true }, { text: ' vs last ', hit: false }, { text: 'month', hit: true },
  ]);
  assert.deepEqual(highlight('Groceries', ['gro', 'roc']), [{ text: 'Groc', hit: true }, { text: 'eries', hit: false }]);
  assert.deepEqual(highlight('Rent', []), [{ text: 'Rent', hit: false }]);
});
