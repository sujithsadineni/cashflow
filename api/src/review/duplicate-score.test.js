import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreDuplicate } from './duplicate-score.js';

// Facts in the shapes the household's statements produced (D329).
const copy = (id, over) => ({ id, printed: true, needed: true, spare: false, in_period: true, ...over });
const pair = (a, b, over) => ({ a, b, same_description: true, days_apart: 0, in_overlap: false, ...over });

test('both copies printed and both statements need them: real, however alike they look (Amex re-posting a dispute)', () => {
  const r = scoreDuplicate(pair(copy(1), copy(2, { in_period: false })));
  assert.deepEqual([r.score, r.verdict, r.remove_id], [2, 'real', null]);
});

test('a copy its own statement does not print is a duplicate, and is the one to remove', () => {
  const r = scoreDuplicate(pair(copy(1), copy(2, { printed: false, needed: false })));
  assert.deepEqual([r.score, r.verdict, r.remove_id], [98, 'duplicate', 2]);
  assert.ok(r.checks[2].some((c) => c.ok === false && /Not printed/.test(c.text)));
});

test('a copy whose statement only adds up without it is a duplicate', () => {
  const r = scoreDuplicate(pair(copy(1, { needed: false, spare: true }), copy(2)));
  assert.deepEqual([r.score, r.verdict, r.remove_id], [97, 'duplicate', 1]);
});

test("unreadable PDFs and statements without balances: only a capped guess, and a needed copy is never offered", () => {
  const unknown = { printed: null, needed: null, spare: null };
  const alike = scoreDuplicate(pair(copy(1, unknown), copy(2, { ...unknown, in_period: false }), { in_overlap: true }));
  assert.equal(alike.verdict, 'unsure');
  assert.ok(alike.score <= 75 && alike.score >= 50, `alike: ${alike.score}`);
  assert.equal(alike.remove_id, 2, 'the copy outside its period');
  const unlike = scoreDuplicate(pair(copy(1, unknown), copy(2, unknown), { same_description: false, days_apart: 3 }));
  assert.ok(unlike.score < 30, `unlike: ${unlike.score}`);
  const halfKnown = scoreDuplicate(pair(copy(1, unknown), copy(2, { printed: null })));
  assert.equal(halfKnown.remove_id, 1, 'the copy its statement needs is not the one offered');
});
