import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overviewView, viewParams } from './overview-view.js';

const p = (q) => new URLSearchParams(q);

test('the address wins, then the tab\'s last pick, then this month and Month (D380)', () => {
  assert.deepEqual(overviewView(p('month=2026-09&span=ytd'), { month: '2026-03', span: 'month' }, '2026-10'), { month: '2026-09', span: 'ytd' });
  assert.deepEqual(overviewView(p(''), { month: '2026-03', span: 'ytd' }, '2026-10'), { month: '2026-03', span: 'ytd' });
  assert.deepEqual(overviewView(p(''), null, '2026-10'), { month: '2026-10', span: 'month' });
});

test('a bad or future month and an unknown span fall back', () => {
  assert.deepEqual(overviewView(p('month=2026-13&span=week'), null, '2026-10'), { month: '2026-10', span: 'month' });
  assert.deepEqual(overviewView(p('month=2026-11'), { month: '2026-08' }, '2026-10'), { month: '2026-08', span: 'month' });
});

test('this month and Month leave the address bare', () => {
  assert.deepEqual(viewParams({ month: '2026-10', span: 'month' }, '2026-10'), {});
  assert.deepEqual(viewParams({ month: '2026-09', span: 'ytd' }, '2026-10'), { month: '2026-09', span: 'ytd' });
});
