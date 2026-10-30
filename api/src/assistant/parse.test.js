import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuestion } from './parse.js';
import { vocabFrom } from './vocab.js';

const vocab = vocabFrom({
  categories: [{ id: 1, name: 'Rent' }, { id: 2, name: 'Utilities' }, { id: 3, name: 'Groceries' }, { id: 5, name: 'Dining' }],
  merchants: [{ name: 'Northside Power', count: 9 }, { name: 'Lakeside Power Co', count: 2 }, { name: 'Corner Market', count: 30 }],
  accounts: [{ id: 10, name: 'Blue Card' }],
});
const today = '2026-10-23';
const ask = (q) => parseQuestion(q, vocab, today);
const brief = (p) => [p.intent, p.subjects.map((s) => s.name), p.periods.map((x) => x.label), p.top ?? null];

test('a total with no time in it means this year so far', () => {
  assert.deepEqual(brief(ask('How much did I pay for rent?')), ['total', ['Rent'], ['2026 so far'], null]);
  assert.deepEqual(brief(ask('rent last year')), ['total', ['Rent'], ['2025'], null]);
  assert.deepEqual(brief(ask('how much did i spend this month')), ['total', [], ['Oct 2026 so far'], null], 'spending as a whole');
});

test('compare: two periods as written, or one and the one before it like for like', () => {
  assert.deepEqual(brief(ask('utilities this month vs last month')), ['compare', ['Utilities'], ['Oct 2026 so far', 'Sep 2026'], null]);
  assert.deepEqual(brief(ask('compare utilities with last month')), ['compare', ['Utilities'], ['Sep 2026', 'Aug 2026'], null]);
  assert.deepEqual(brief(ask('compare dining')), ['compare', ['Dining'], ['Oct 2026 so far', 'Sep 2026 to the 23rd'], null]);
  assert.deepEqual(brief(ask('rent in march and april')), ['compare', ['Rent'], ['Mar 2026', 'Apr 2026'], null]);
});

test('by month and top lists', () => {
  assert.deepEqual(brief(ask('groceries by month')), ['by_month', ['Groceries'], ['2026 so far'], null]);
  assert.deepEqual(brief(ask('average dining per month last year')), ['by_month', ['Dining'], ['2025'], null]);
  assert.deepEqual(brief(ask('top 10 merchants last month')), ['top', [], ['Sep 2026'], { of: 'merchants', n: 10 }]);
  assert.deepEqual(brief(ask('biggest purchases this year')), ['top', [], ['2026 so far'], { of: 'purchases', n: 5 }]);
  assert.deepEqual(ask('top groceries stores').top, { of: 'merchants', n: 5 });
  assert.deepEqual(ask('where did i spend the most').top, { of: 'categories', n: 5 });
});

test('a word that fits several names asks, with each choice as a question to ask instead', () => {
  const p = ask('ga power last month');
  assert.equal(p.understood, false);
  assert.equal(p.reason, 'choose');
  assert.deepEqual(p.choices.map((c) => c.question), ['ga Northside Power last month', 'ga Lakeside Power Co last month']);
});

test('a name from one word alone, with nothing else money-like, is offered rather than assumed', () => {
  const p = ask('corner');
  assert.deepEqual([p.understood, p.reason, p.choices.map((c) => c.question)], [false, 'choose', ['Corner Market this year']]);
  assert.deepEqual(brief(ask('corner last month')), ['total', ['Corner Market'], ['Sep 2026'], null]);
});

test('nothing to look up is said plainly', () => {
  const p = ask('hello there');
  assert.deepEqual([p.understood, p.reason], [false, 'nothing']);
});
