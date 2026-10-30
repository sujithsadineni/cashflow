import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSuggestions } from './suggestions.js';
import { parseQuestion } from './parse.js';
import { vocabFrom } from './vocab.js';

const categories = ['Rent', 'Groceries', 'Utilities', 'Dining', 'Fuel', 'Travel'];
const merchants = ['Corner Market', 'Northside Power'];

test('suggestions come from the top categories and merchants, without repeats', () => {
  const list = buildSuggestions({ categories, merchants });
  assert.equal(list[2].text, 'How much did I spend on Rent this year?');
  assert.ok(list.some((s) => s.text === 'Corner Market by month this year'));
  assert.equal(new Set(list.map((s) => s.text)).size, list.length);
  assert.ok(buildSuggestions({}).length >= 5, 'a new ledger still gets the general ones');
  assert.deepEqual(list.filter((s) => s.text.startsWith('Travel')).map((s) => s.note),
    ['Travel · year to date', 'Travel · by month', 'Travel · compare', 'Travel · last month'], 'every shape for every name');
});

test('every suggestion is a question Answer here understands', () => {
  const vocab = vocabFrom({
    categories: categories.map((name, i) => ({ id: i + 1, name })),
    merchants: merchants.map((name) => ({ name, count: 5 })),
  });
  for (const s of buildSuggestions({ categories, merchants })) {
    const p = parseQuestion(s.text, vocab, '2026-10-23');
    assert.equal(p.understood, true, s.text);
  }
});
