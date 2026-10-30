import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tileContent } from './tile-content.js';

const name = { nameWidth: 70, amountWidth: 40 };   // "Groceries", "$437"

test('a roomy tile shows the icon, the name and the amount', () => {
  assert.equal(tileContent({ w: 160, h: 120, ...name }).show, 'all');
});

test('short of height for the amount, it shows the icon and the name', () => {
  assert.equal(tileContent({ w: 160, h: 62, ...name }).show, 'name');
});

test('a name wider than the tile is left out, never cut short: icon only', () => {
  const c = tileContent({ w: 70, h: 120, nameWidth: 92, amountWidth: 40 });   // "Entertainment" in a narrow tile
  assert.equal(c.show, 'icon');
  assert.ok(c.icon >= 12);
});

test('a sliver shows nothing at all', () => {
  assert.equal(tileContent({ w: 20, h: 120, ...name }).show, 'none');
});

test('the order holds as a tile grows: icon, then name, then amount', () => {
  const order = ['none', 'icon', 'name', 'all'];
  let last = 0;
  for (let h = 20; h <= 200; h += 4) {
    const i = order.indexOf(tileContent({ w: 150, h, ...name }).show);
    assert.ok(i >= last, `went back from ${order[last]} at ${h}px`); last = i;
  }
  assert.equal(order[last], 'all');
});
