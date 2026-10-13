import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pinClock } from './demo-clock.js';

test("the pinned clock reads the demo's day and keeps dates built from arguments", () => {
  const Real = globalThis.Date;
  try {
    pinClock('2026-09-30');
    const today = new Date();
    assert.equal(`${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`, '2026-9-30');
    assert.ok(Math.abs(Date.now() - today.getTime()) < 1000);
    assert.equal(new Date(2025, 0, 2).getFullYear(), 2025);
    assert.equal(new Date('2026-03-01T00:00:00').getMonth(), 2);
    assert.ok(new Date() instanceof Real);
  } finally {
    globalThis.Date = Real;
  }
});
