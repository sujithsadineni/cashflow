import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mosaicLayout, MOSAIC } from './pebble-mosaic.js';
import { fieldHomes, weightsAt, interleave, cardHeight } from './wallet-fields.js';

// One big family down to a family whose categories are a few cents (YTD's fee family).
const families = [
  { key: 'sent', items: [{ key: 'a', value: 2392100 }, { key: 'b', value: 1075000 }, { key: 'c', value: 720200 }] },
  { key: 'food', items: [{ key: 'd', value: 1021400 }, { key: 'e', value: 500100 }, { key: 'f', value: 79800 }] },
  { key: 'home', items: [{ key: 'g', value: 1115900 }, { key: 'h', value: 20600 }, { key: 'i', value: 12700 }] },
  { key: 'other', items: [{ key: 'j', value: 19400 }, { key: 'k', value: 2400 }, { key: 'l', value: 100 }] },
];
const area = { x: 14, y: 104, w: 830, h: 500 };

test('every category gets a visible tile, even the few-cent ones', () => {
  const { tiles } = mosaicLayout(families, area);
  assert.equal(tiles.length, 12);
  for (const t of tiles) assert.ok(t.w >= 8 && t.h >= 8, `${t.key} is ${t.w.toFixed(1)}×${t.h.toFixed(1)}`);
});

test('tiles never overlap and keep their gap, and stay inside the area', () => {
  const { tiles } = mosaicLayout(families, area);
  for (const t of tiles) assert.ok(t.x >= area.x && t.y >= area.y && t.x + t.w <= area.x + area.w + 0.01 && t.y + t.h <= area.y + area.h + 0.01, t.key);
  for (let i = 0; i < tiles.length; i++) for (let j = i + 1; j < tiles.length; j++) {
    const a = tiles[i], b = tiles[j];
    const gx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w)), gy = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
    assert.ok(Math.max(gx, gy) >= MOSAIC.gap - 0.01, `${a.key} and ${b.key} are ${Math.max(gx, gy).toFixed(2)}px apart`);
  }
});

test('bigger spend gets the bigger tile within a family', () => {
  const { tiles } = mosaicLayout(families, area), size = (k) => { const t = tiles.find((x) => x.key === k); return t.w * t.h; };
  assert.ok(size('a') > size('b') && size('b') > size('c'));
});

test('the wallet card: weights add to 1, and the colour at a field\'s centre is that field\'s', () => {
  const fields = fieldHomes([{ key: 'x', value: 70, color: { L: 0.6, C: 0.15, h: 300 } }, { key: 'y', value: 30, color: { L: 0.7, C: 0.15, h: 40 } }])
    .map((f) => ({ ...f, cx: f.x, cy: f.y, csx: f.sx, csy: f.sy, amp: 1 }));
  const w = new Float64Array(2);
  for (const f of fields) {
    weightsAt(f.cx, f.cy, fields, w);
    assert.ok(Math.abs(w[0] + w[1] - 1) < 1e-9);
    assert.ok(w[fields.indexOf(f)] > 0.5, `${f.key} doesn't own its own centre`);
  }
});

test('the biggest tile doesn\'t swamp the card and the smallest stays a real tile', () => {
  const { tiles } = mosaicLayout(families, area), areas = tiles.map((t) => t.w * t.h);
  assert.ok(Math.max(...areas) / Math.min(...areas) < 25, `biggest is ${(Math.max(...areas) / Math.min(...areas)).toFixed(1)}× the smallest`);
  for (const t of tiles) assert.ok(Math.min(t.w, t.h) >= 24, `${t.key} is ${t.w.toFixed(0)}×${t.h.toFixed(0)}`);
});

// The Wallet card must read as many colours, not the biggest one's (D373 step 5).
const october = [529399, 416440, 215000, 43660, 28615, 25289, 8654, 8116, 4750, 2505, 1300, 900, 1000];
const octFam = ['sent', 'life', 'sent', 'food', 'food', 'food', 'life', 'home', 'home', 'life', 'life', 'home', 'life'];
const octItems = october.map((v, i) => ({ key: `c${i}`, value: v, family: octFam[i], color: { L: 0.6, C: 0.15, h: (i * 47) % 360 } }));

test('the wallet card: the biggest category can\'t wash over it and every category shows', () => {
  const fields = fieldHomes(octItems).map((f) => ({ ...f, cx: f.x, cy: f.y, csx: f.sx, csy: f.sy, amp: 1 }));
  const w = new Float64Array(fields.length), own = new Map(), N = 160, M = Math.round(N * cardHeight);
  for (let y = 0; y < M; y++) for (let x = 0; x < N; x++) {
    weightsAt((x + 0.5) / N, ((y + 0.5) / M) * cardHeight, fields, w);
    let b = 0; for (let i = 1; i < w.length; i++) if (w[i] > w[b]) b = i;
    own.set(fields[b].key, (own.get(fields[b].key) ?? 0) + 1);
  }
  const shares = [...own.values()].map((n) => n / (N * M));
  assert.ok(Math.max(...shares) < 0.3, `the biggest owns ${(Math.max(...shares) * 100).toFixed(0)}% of the card`);
  assert.ok(shares.filter((s) => s >= 0.005).length >= octItems.length - 1, `only ${shares.filter((s) => s >= 0.005).length} of ${octItems.length} show`);
});

test('the wallet card: neighbours come from different families while another family is waiting', () => {
  const order = interleave(octItems);
  const same = order.slice(1).filter((x, i) => x.family === order[i].family).length;
  assert.ok(same <= 2, `${same} same-family neighbours`);
  assert.equal(order[0].key, 'c0', 'still biggest first');
});

