import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dumpName, isDue, toPrune } from './backup.js';

test('dump names sort by time, and only the newest 30 are kept', () => {
  assert.equal(dumpName(new Date(2026, 9, 9, 18, 3)), 'cashflow-2026-10-09-1803.dump');
  const names = Array.from({ length: 33 }, (_, i) => dumpName(new Date(2026, 0, i + 1, 9, 0)));
  assert.deepEqual(toPrune([...names, 'notes.txt']).sort(), names.slice(0, 3)); // the three oldest; other files untouched
  assert.deepEqual(toPrune(names.slice(0, 5)), []);
});

test('a backup is due with none yet, or once the last is a day old', () => {
  const now = Date.parse('2026-10-09T18:00:00Z');
  assert.equal(isDue(null, now), true);
  assert.equal(isDue('2026-10-09T06:00:00Z', now), false);
  assert.equal(isDue('2026-10-08T17:59:00Z', now), true);
});
