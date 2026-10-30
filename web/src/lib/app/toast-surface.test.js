import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VIVID_KINDS, vividTone, cardLook, contrast } from './toast-surface.js';

test("Vivid's colour says what kind of toast it is (D387)", () => {
  assert.equal(vividTone({ type: 'error' }), VIVID_KINDS.error);
  assert.equal(vividTone({ type: 'info' }), VIVID_KINDS.info);
  assert.equal(vividTone({ type: 'success', action: { label: 'Undo' } }), VIVID_KINDS.undo);
  assert.equal(vividTone({ type: 'success' }), VIVID_KINDS.done);
});

test('white words on every Vivid deep shade read at 4.5:1 or better (WCAG AA, small text) (D388)', () => {
  for (const [kind, { deep }] of Object.entries(VIVID_KINDS)) {
    assert.ok(contrast(deep, '#FFFFFF') >= 4.5, `${kind}: ${deep} on white is ${contrast(deep, '#FFFFFF').toFixed(2)}:1`);
  }
  // The app's own light shades don't, which is why the deep ones exist.
  assert.ok(contrast('#F5A524', '#FFFFFF') < 3, 'amber');
  assert.ok(contrast('#E5484D', '#FFFFFF') < 4.5, 'red');
  assert.equal(Math.round(contrast('#000000', '#FFFFFF')), 21);
});

test('Candy is the deep shade with white words; Glass and Classic draw on the shared frosted card', () => {
  const candy = cardLook('candy', { type: 'info' });
  assert.equal(candy.style.background, VIVID_KINDS.info.deep);
  assert.match(candy.className, /text-white/);
  for (const look of ['ledger', 'capsule']) assert.match(cardLook(look, { type: 'success' }).className, /toast-card/);
  for (const look of ['island', 'candy', 'sticker']) assert.doesNotMatch(cardLook(look, { type: 'success' }).className, /toast-card/);
});
