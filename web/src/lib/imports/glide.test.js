import { test } from 'node:test';
import assert from 'node:assert/strict';
import { glideTarget, easeInOut } from './glide.js';

const pane = { scrollTop: 0, height: 400, maxScroll: 2000 };

test('a line already in the middle band leaves the pane where it is', () => {
  assert.equal(glideTarget({ ...pane, lineTop: 180, lineBottom: 200 }), null);
});

test('a line near the edge is brought to the middle', () => {
  assert.equal(glideTarget({ ...pane, lineTop: 380, lineBottom: 400 }), 190);
});

test('never past either end', () => {
  assert.equal(glideTarget({ ...pane, scrollTop: 500, lineTop: 10, lineBottom: 30 }), 0);
  assert.equal(glideTarget({ ...pane, lineTop: 2380, lineBottom: 2400 }), 2000);
});

test('the ease starts and ends still', () => {
  assert.equal(easeInOut(0), 0);
  assert.equal(easeInOut(1), 1);
  assert.equal(easeInOut(0.5), 0.5);
  assert.ok(easeInOut(0.1) < 0.1 && easeInOut(0.9) > 0.9);
});
