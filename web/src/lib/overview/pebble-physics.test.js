import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, homes, targetsFor, setTargets, settle, advance, STEP } from './pebble-physics.js';

const items = Array.from({ length: 22 }, (_, i) => ({ key: `c${i}`, value: Math.round(400000 / (i + 1) ** 1.6), family: `f${i % 5}` }));
const world = () => { const w = createWorld({ width: 860, height: 640 }); setTargets(w, targetsFor(w, items)); settle(w); return w; };
const run = (w, seconds, start = 0) => { let now = start, out = { impacts: [], gone: [] };
  for (let t = 0; t < seconds; t += 1 / 60) { now += 1000 / 60; const r = advance(w, 1 / 60, now); out.impacts.push(...r.impacts); out.gone.push(...r.gone); }
  return out; };

test('every category gets a home inside the card, none overlapping much', () => {
  const w = createWorld({ width: 860, height: 640 }), hs = homes(items, w);
  assert.equal(hs.length, items.length);
  for (const h of hs) assert.ok(h.x - h.r >= w.pad - 1 && h.x + h.r <= w.W - w.pad + 1 && h.y - h.r >= w.top - 1 && h.y + h.r <= w.H - w.pad + 1, h.key);
  for (let i = 0; i < hs.length; i++) for (let j = i + 1; j < hs.length; j++) {
    const a = hs[i], b = hs[j];
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > (a.r + b.r) * 0.85, `${a.key} sits on ${b.key}`);
  }
});

test('small categories stay real stones', () => {
  const hs = homes(items, createWorld({ width: 860, height: 640 }));
  assert.ok(Math.min(...hs.map((h) => h.r)) >= 24);
});

test('twenty seconds of flings and knocks: no NaN, nothing leaves the card, hits happen', () => {
  const w = world(), { impacts } = run(w, 20);
  for (const b of w.bodies.values()) {
    assert.ok([b.x, b.y, b.r, b.rot].every(Number.isFinite), `${b.key} went NaN`);
    assert.ok(b.x >= 0 && b.x <= w.W && b.y >= 0 && b.y <= w.H, `${b.key} left the card`);
  }
  assert.ok(impacts.length > 0, 'stones hit each other');
});

test('a hit carries on: the struck stone moves off the other way, momentum about conserved', () => {
  const w = createWorld({ width: 2000, height: 2000, top: 0, pad: 0 });
  setTargets(w, [{ key: 'a', x: 900, y: 1000, r: 40 }, { key: 'b', x: 1000, y: 1000, r: 40 }]); settle(w);
  for (const b of w.bodies.values()) { b.hx = b.x; b.hy = b.y; }
  w.nextKick = Infinity;
  const a = w.bodies.get('a'), b = w.bodies.get('b');
  a.x = b.x - 75; a.hx = a.x; a.vx = 300;    // a rolls into b, just about touching
  const p0 = a.vx * a.r ** 2 + b.vx * b.r ** 2;
  advance(w, STEP * 10, 1);
  assert.ok(b.vx > 150, `b barely moved (${b.vx.toFixed(0)} px/s)`);
  assert.ok(a.vx < b.vx, 'a slows behind b');
  // rolling friction (1.2/s) slows both all the time; the hit itself loses nothing
  const p1 = a.vx * a.r ** 2 + b.vx * b.r ** 2, friction = Math.exp(-1.2 * STEP * 10);
  assert.ok(Math.abs(p1 / p0 - friction) < 0.02, `momentum kept ${(p1 / p0).toFixed(3)}, friction alone ${friction.toFixed(3)}`);
});

test('a hovered stone holds still and the others bounce off it', () => {
  const w = world(); w.hoverKey = 'c3';
  const h = w.bodies.get('c3'), x = h.x, y = h.y;
  run(w, 8);
  assert.ok(Math.hypot(h.x - x, h.y - y) < 0.01, 'held still');
});

test('zooming pins the picked stone in the middle, even under the pointer, and merchants burst out', () => {
  const w = world(); w.zoomKey = 'c2'; w.hoverKey = 'c2';
  setTargets(w, targetsFor(w, items, { zoom: 'c2', merchants: [{ key: 'm:one', value: 900 }, { key: 'm:two', value: 300 }] }));
  run(w, 3);
  const z = w.bodies.get('c2');
  assert.ok(Math.hypot(z.x - w.W / 2, z.y - (w.top + w.H) / 2) < 3, 'glides to the centre');
  assert.ok(w.bodies.has('m:one') && w.bodies.get('m:one').o > 0.9);
  assert.ok([...w.bodies.values()].filter((b) => b.bg).length === items.length - 1);
});

test('stones that leave fade out and are reported gone', () => {
  const w = world();
  setTargets(w, targetsFor(w, items.slice(0, 10)));
  const { gone } = run(w, 2);
  assert.equal(gone.length, items.length - 10);
  assert.equal(w.bodies.size, 10);
});

test('the first fill pops every stone out of the middle and home, without sparks (D376)', () => {
  const w = createWorld({ width: 860, height: 640 }), mid = { x: 430, y: 372 };
  setTargets(w, targetsFor(w, items), { burstFrom: mid });
  w.nextKick = Infinity;                       // no flings, so "home" means home
  for (const b of w.bodies.values()) { assert.equal(b.x, mid.x); assert.equal(b.y, mid.y); assert.ok(b.r <= 2); }
  const { impacts } = run(w, 0.3);
  assert.ok([...w.bodies.values()].some((b) => b.wait > 0) && [...w.bodies.values()].some((b) => !(b.wait > 0)), 'they leave one after another');
  const later = run(w, 3.5, 300);
  assert.equal(impacts.length + later.impacts.length, 0, 'no sparks while they fly out');
  for (const b of w.bodies.values()) {
    assert.ok(!b.intro, `${b.key} still flying`);
    assert.ok(Math.hypot(b.x - b.hx, b.y - b.hy) < 6, `${b.key} not home`);
    assert.ok(Math.abs(b.r - b.tr) < 1 && b.o > 0.95, `${b.key} not grown in`);
  }
});

test('a new month sends the stones already there back to the middle to pop out again (D376)', () => {
  const w = world(), mid = { x: 430, y: 372 };
  w.nextKick = Infinity;
  setTargets(w, targetsFor(w, items.slice(0, 15)), { burstFrom: mid, again: true });
  for (const b of w.bodies.values()) if (!b.gone) { assert.equal(b.x, mid.x); assert.ok(b.intro); }
  run(w, 3);
  // landed stones settle against their neighbours, a few px either way
  for (const b of w.bodies.values()) assert.ok(!b.intro && Math.hypot(b.x - b.hx, b.y - b.hy) < 12, `${b.key} not home`);
  assert.equal(w.bodies.size, 15, 'the ones that left faded out');
});

