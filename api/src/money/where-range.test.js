import { test } from 'node:test';
import assert from 'node:assert/strict';
import { whereRange } from './where-range.js';

test('a month covers itself, up to the first of the next', () => {
  assert.deepEqual(whereRange('2026-09', 'month'), { from: '2026-09-01', to: '2026-10-01' });
});

test('the year so far starts in January of the same year', () => {
  assert.deepEqual(whereRange('2026-09', 'ytd'), { from: '2026-01-01', to: '2026-10-01' });
});

test('December rolls into the next year', () => {
  assert.deepEqual(whereRange('2025-12', 'month'), { from: '2025-12-01', to: '2026-01-01' });
  assert.deepEqual(whereRange('2025-12', 'ytd'), { from: '2025-01-01', to: '2026-01-01' });
});
