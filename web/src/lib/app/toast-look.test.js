import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOAST_STYLES, TOAST_POSITIONS, lookFor, lookChanged } from './toast-look.js';

test("each design has its own looks, and only its own (D387)", () => {
  assert.deepEqual(TOAST_STYLES.glass.map((s) => s.key), ['capsule', 'island']);
  assert.deepEqual(TOAST_STYLES.vivid.map((s) => s.key), ['candy', 'sticker']);
  assert.deepEqual(TOAST_STYLES.classic.map((s) => s.key), ['ledger']);
  assert.equal(TOAST_POSITIONS.length, 4);
});

test("unset or unknown reads as the design's first look, bottom centre", () => {
  assert.deepEqual(lookFor(null, 'glass'), { style: 'capsule', position: 'bottom-center' });
  assert.deepEqual(lookFor({ glass: { style: 'candy', position: 'middle' } }, 'glass'), { style: 'capsule', position: 'bottom-center' });
  assert.deepEqual(lookFor({ vivid: { style: 'sticker', position: 'top-right' } }, 'vivid'), { style: 'sticker', position: 'top-right' });
  assert.deepEqual(lookFor(null, 'no-such-design'), { style: 'ledger', position: 'bottom-center' });
});

test("changing one design's look leaves the others alone", () => {
  const saved = lookChanged({ vivid: { style: 'sticker', position: 'top-center' } }, 'glass', { style: 'island' });
  assert.deepEqual(saved.glass, { style: 'island', position: 'bottom-center' });
  assert.deepEqual(saved.vivid, { style: 'sticker', position: 'top-center' });
  assert.deepEqual(lookChanged(saved, 'glass', { position: 'top-right' }).glass, { style: 'island', position: 'top-right' });
});

test('a look dropped in D388 (banner, gradient) reads as the design\'s first', () => {
  assert.equal(lookFor({ glass: { style: 'banner' } }, 'glass').style, 'capsule');
  assert.equal(lookFor({ vivid: { style: 'gradient' } }, 'vivid').style, 'candy');
});
