import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyFor, lookup } from './demo.js';

const RESPONSES = {
  'GET /summary?month=2026-09': { month: '2026-09' },
  'GET /transactions?limit=50': [{ id: 1 }],
  'GET /people': [{ id: 1 }],
  'POST /recurring/detect': [{ name: 'Netflix' }],
};

test('an exact recorded request replays as-is', () => {
  assert.deepEqual(lookup(RESPONSES, keyFor('/summary?month=2026-09')), { month: '2026-09' });
  assert.deepEqual(lookup(RESPONSES, keyFor('/recurring/detect', 'post')), [{ name: 'Netflix' }]);
});

test('an unrecorded filter falls back to the same endpoint', () => {
  assert.deepEqual(lookup(RESPONSES, keyFor('/transactions?limit=50&search=zzz')), [{ id: 1 }]);
  assert.deepEqual(lookup(RESPONSES, keyFor('/people?x=1')), [{ id: 1 }]);
});

test('an unrecorded write has no fallback', () => {
  assert.equal(lookup(RESPONSES, keyFor('/people', 'POST')), undefined);
});
