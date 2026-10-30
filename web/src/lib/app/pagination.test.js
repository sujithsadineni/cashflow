import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageItems, pageCount } from './pagination.js';

test('a pager shows every page when there are few (D397)', () => {
  assert.deepEqual(pageItems(1, 1), [1]);
  assert.deepEqual(pageItems(3, 7), [1, 2, 3, 4, 5, 6, 7]);
});

test('with many pages: the start, the middle and the end', () => {
  assert.deepEqual(pageItems(1, 30), [1, 2, 3, 4, 5, 'gap-end', 30]);
  assert.deepEqual(pageItems(4, 30), [1, 2, 3, 4, 5, 'gap-end', 30]);
  assert.deepEqual(pageItems(5, 30), [1, 'gap-start', 4, 5, 6, 'gap-end', 30]);
  assert.deepEqual(pageItems(15, 30), [1, 'gap-start', 14, 15, 16, 'gap-end', 30]);
  assert.deepEqual(pageItems(27, 30), [1, 'gap-start', 26, 27, 28, 29, 30]);
  assert.deepEqual(pageItems(30, 30), [1, 'gap-start', 26, 27, 28, 29, 30]);
  assert.deepEqual(pageItems(4, 8), [1, 2, 3, 4, 5, 'gap-end', 8]);
});

test('the current page is always shown, and there are never two gaps side by side', () => {
  for (let count = 1; count <= 40; count++) {
    for (let current = 1; current <= count; current++) {
      const items = pageItems(current, count);
      assert.ok(items.includes(current), `${current} of ${count}`);
      assert.equal(items[0], 1);
      assert.equal(items.at(-1), count);
      assert.ok(items.length <= 7);
      items.forEach((x, i) => { if (typeof x === 'string') assert.equal(typeof items[i + 1], 'number'); });
    }
  }
});

test('pages for a total', () => {
  assert.equal(pageCount(0, 25), 1);
  assert.equal(pageCount(25, 25), 1);
  assert.equal(pageCount(26, 25), 2);
  assert.equal(pageCount(4851, 10), 486);
});
