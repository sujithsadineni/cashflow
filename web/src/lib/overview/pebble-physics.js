/**
 * The animated pebbles of "Where it's going" (D373): plain data and maths,
 * no DOM — WherePebbles.jsx renders the stones and copies x/y/rotation
 * from here each frame.
 *
 * Each stone springs softly toward a home (families clustered, sizes
 * compressed so small categories stay real stones). Every few seconds one
 * is flung at a neighbour; collisions are nearly elastic and mass goes
 * with area, so the hit one flies off the other way and can knock the
 * next. Physics runs in fixed 1/120 s steps, so it behaves the same at any
 * frame rate and can't tunnel at speed. A hovered stone is held still and
 * immovable — others bounce off it — so it can be read and clicked.
 */

export const STEP = 1 / 120;
export const TUNING = {
  kickEvery: [2200, 3600],   // ms between flings
  kickSpeed: [200, 320],     // px/s
  restitution: 0.82,         // bounciness between stones
  sparkMin: 150,             // closing speed (px/s) before a hit sparks
};

function rng(seed) { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }

export function createWorld({ width, height, top = 104, pad = 14, seed = 7 }) {
  return { W: width, H: height, top, pad, bodies: new Map(), hoverKey: null, zoomKey: null, acc: 0, nextKick: 0, rnd: rng(seed) };
}

/**
 * Homes for the stones: each family's members packed around the family's
 * own centre. `items` are { key, value, family }; returns [{ key, x, y, r }].
 */
export function homes(items, { W, H, top, pad }) {
  if (!items.length) return [];
  const usable = (W - pad * 2) * (H - top - pad);
  const k = Math.sqrt((usable * 0.5) / Math.PI / items.reduce((s, i) => s + Math.pow(i.value, 0.84), 0));
  const nodes = items.map((it) => ({ key: it.key, family: it.family, r: Math.max(k * Math.pow(it.value, 0.42), 24) }));
  const fams = [...new Set(nodes.map((n) => n.family))].map((f, i) => ({
    r: Math.sqrt(nodes.filter((n) => n.family === f).reduce((s, n) => s + n.r * n.r, 0)) * 1.1, family: f,
    x: W / 2 + Math.cos(i * 2.4) * W * 0.22, y: (top + H) / 2 + Math.sin(i * 2.4) * H * 0.16,
  }));
  const relax = (arr, iters, g) => {
    const cx = W / 2, cy = (top + H - pad) / 2;
    for (let it = 0; it < iters; it++) {
      for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i], b = arr[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.01, min = a.r + b.r + 6;
        if (d < min) { const p = (min - d) / d / 2; a.x -= dx * p; a.y -= dy * p; b.x += dx * p; b.y += dy * p; }
      }
      for (const n of arr) {
        n.x += ((n.gx ?? cx) - n.x) * g * 0.6; n.y += ((n.gy ?? cy) - n.y) * g;
        n.x = Math.min(Math.max(n.x, pad + n.r), W - pad - n.r); n.y = Math.min(Math.max(n.y, top + n.r), H - pad - n.r);
      }
    }
  };
  relax(fams, 240, 0.012);
  nodes.forEach((n, i) => { const f = fams.find((x) => x.family === n.family); n.gx = f.x; n.gy = f.y; n.x = f.x + Math.cos(i * 2.4) * f.r * 0.5; n.y = f.y + Math.sin(i * 2.4) * f.r * 0.5; });
  relax(nodes, 240, 0.035);
  return nodes.map(({ key, x, y, r }) => ({ key, x, y, r }));
}

/**
 * Where every stone should be: its home, or — zoomed into one — that one
 * in the middle, the rest stepped back and its merchants around it.
 * `merchants` are { key, value }. Returns targets for setTargets.
 */
export function targetsFor(world, items, { zoom = null, merchants = [] } = {}) {
  const base = homes(items, world);
  if (!zoom) return base;
  const { W, H, top } = world, cx = W / 2, cy = (top + H) / 2, zr = Math.min(W, H - top) * 0.17, out = [];
  for (const n of base) {
    if (n.key === zoom) { out.push({ ...n, x: cx, y: cy, r: zr, pinned: true }); continue; }
    const dx = n.x - cx, dy = n.y - cy, d = Math.hypot(dx, dy) || 1;
    out.push({ ...n, x: cx + (dx / d) * Math.max(d, zr * 2.6), y: cy + (dy / d) * Math.max(d, zr * 2), r: n.r * 0.6, bg: true });
  }
  const max = merchants[0]?.value ?? 1;
  merchants.forEach((m, i) => {
    const ang = -Math.PI / 2 + (i / merchants.length) * Math.PI * 2, r = 16 + 24 * Math.sqrt(m.value / max), d = zr + r + 34;
    out.push({ key: m.key, x: cx + Math.cos(ang) * d * 1.35, y: cy + Math.sin(ang) * d, r, pinned: true, from: zoom });
  });
  return out;
}

/**
 * Point every stone at its target; new ones grow in (a merchant bursts out of its parent), missing ones fade.
 * `burstFrom` { x, y } (D376): new stones wait their turn there — a random moment in the first half
 * second — then pop out and fly home on a firmer pull, so the card fills from its middle. With
 * `again`, stones already on the card go back to the middle and pop out too (a new month, D376).
 */
export function setTargets(world, targets, { burstFrom = null, again = false } = {}) {
  for (const b of world.bodies.values()) b.gone = true;
  for (const t of targets) {
    let b = world.bodies.get(t.key);
    if (!b) {
      const from = t.from ? world.bodies.get(t.from) : null;
      b = { key: t.key, x: from?.x ?? t.x, y: from?.y ?? t.y, vx: 0, vy: 0, r: from ? 6 : t.r * 0.3, vr: 0, rot: 0, w: 0, sq: 0, o: 0 };
      if (from) { const a = world.rnd() * 6.283; b.vx = Math.cos(a) * 240; b.vy = Math.sin(a) * 240; }
      world.bodies.set(t.key, b);
      if (burstFrom && !from) burst(world, b, burstFrom);
    } else if (burstFrom && again && !t.from) burst(world, b, burstFrom);
    Object.assign(b, { gone: false, hx: t.x, hy: t.y, tr: t.r, pinned: !!t.pinned, bg: !!t.bg });
  }
}

function burst(world, b, at) {
  const a = world.rnd() * 6.283;
  Object.assign(b, { x: at.x, y: at.y, r: 2, vr: 0, o: 0, w: 0, wait: world.rnd() * 0.55, intro: true, vx: Math.cos(a) * 60, vy: Math.sin(a) * 60 });
}

/** Jump straight to the targets — Reduce Motion, and the first paint. */
export function settle(world) {
  for (const b of world.bodies.values()) { b.x = b.hx; b.y = b.hy; b.r = b.tr; b.o = b.gone ? 0 : 1; b.vx = b.vy = b.vr = b.w = b.sq = 0; }
  reap(world);
}

function reap(world) {
  const gone = [];
  for (const b of world.bodies.values()) if (b.gone && b.o < 0.03) { world.bodies.delete(b.key); gone.push(b.key); }
  if (gone.includes(world.hoverKey)) world.hoverKey = null;
  return gone;
}

function kick(world, now) {
  const { kickEvery: [a1, a2], kickSpeed: [s1, s2] } = TUNING, rnd = world.rnd;
  world.nextKick = now + a1 + rnd() * (a2 - a1);
  const pool = [...world.bodies.values()].filter((b) => !b.gone && !b.bg && !b.pinned);
  const a = pool[Math.floor(rnd() * pool.length)]; if (!a) return;
  const near = pool.filter((b) => b !== a).sort((p, q) => Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y));
  const b = near[Math.floor(rnd() * Math.min(3, near.length))]; if (!b) return;
  const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, sp = s1 + rnd() * (s2 - s1);
  a.vx += (dx / d) * sp; a.vy += (dy / d) * sp; a.w += (rnd() - 0.5) * 120;
}

function wall(b, axis, lim, dir, impacts, rr) {
  const v = axis === 'x' ? 'vx' : 'vy'; b[axis] = lim;
  if (b[v] * dir <= 0) return;
  const f = Math.abs(b[v]); b[v] *= -0.6; b.sq = Math.max(b.sq, Math.min(f / 800, 0.8));
  if (f > TUNING.sparkMin * 1.4 && !b.bg) impacts.push({ x: axis === 'x' ? lim + dir * rr : b.x, y: axis === 'y' ? lim + dir * rr : b.y, a: b.key, b: null, force: f * 0.6 });
}

function step(world, h, impacts) {
  const list = [...world.bodies.values()], { W, H, top, pad, hoverKey } = world;
  const held = (x) => x.key === hoverKey && !x.pinned;
  for (const b of list) {
    const wn = 12.57; b.vr += (-wn * wn * (b.r - b.tr) - 2 * wn * b.vr) * h; b.r += b.vr * h;    // size: critically damped, ~0.5 s
    b.o += ((b.gone ? 0 : 1) - b.o) * Math.min(h * 7, 1);
    if (b.wait > 0) { b.wait -= h; b.r = 2; b.o = 0; b.vr = 0; continue; }      // still waiting its turn in the middle
    if (held(b)) { b.vx = b.vy = 0; b.w *= 0.9; continue; }
    if (b.intro && Math.hypot(b.hx - b.x, b.hy - b.y) < 3 && Math.hypot(b.vx, b.vy) < 25) b.intro = false;
    const k = b.pinned ? 34 : b.intro ? 30 : b.bg ? 4 : 1.5, c = b.pinned ? 9 : b.intro ? 10 : 1.2;
    b.vx += (b.hx - b.x) * k * h; b.vy += (b.hy - b.y) * k * h;
    const damp = Math.exp(-c * h); b.vx *= damp; b.vy *= damp;
    b.x += b.vx * h; b.y += b.vy * h;
    b.w *= Math.exp(-1.4 * h); b.rot += b.w * h; b.sq *= Math.exp(-10 * h);
    const rr = b.r * 0.92, wallTop = top - 6;
    if (b.x < pad + rr) wall(b, 'x', pad + rr, -1, impacts, rr); else if (b.x > W - pad - rr) wall(b, 'x', W - pad - rr, 1, impacts, rr);
    if (b.y < wallTop + rr) wall(b, 'y', wallTop + rr, -1, impacts, rr); else if (b.y > H - pad - rr) wall(b, 'y', H - pad - rr, 1, impacts, rr);
  }
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    // flying out, a stone passes over the others (cards fanning out); it collides once it's landed
    const a = list[i], b = list[j]; if (a.gone || b.gone || a.wait > 0 || b.wait > 0 || a.intro || b.intro) continue;
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.01, min = (a.r + b.r) * 0.92;
    if (d >= min) continue;
    const ia = held(a) ? 0 : 1 / (a.r * a.r), ib = held(b) ? 0 : 1 / (b.r * b.r), im = ia + ib;
    if (!im) continue;
    const nx = dx / d, ny = dy / d, corr = (Math.max(min - d - 0.3, 0) / im) * 0.85;
    a.x -= nx * corr * ia; a.y -= ny * corr * ia; b.x += nx * corr * ib; b.y += ny * corr * ib;
    const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (vn >= 0) continue;
    const J = (-(1 + TUNING.restitution) * vn) / im;
    a.vx -= J * ia * nx; a.vy -= J * ia * ny; b.vx += J * ib * nx; b.vy += J * ib * ny;
    const vt = (b.vx - a.vx) * -ny + (b.vy - a.vy) * nx;      // glancing blows spin both stones
    if (ia) a.w += vt * 0.35;
    if (ib) b.w -= vt * 0.35;
    const f = -vn;
    a.sq = Math.max(a.sq, Math.min(f / 800, 0.8)); b.sq = Math.max(b.sq, Math.min(f / 800, 0.8));
    if (f > TUNING.sparkMin && !a.bg && !b.bg && !a.intro && !b.intro) impacts.push({ x: a.x + nx * a.r * 0.92, y: a.y + ny * a.r * 0.92, a: a.key, b: b.key, force: f });
  }
}

/**
 * Move the world on by `dt` seconds of wall time. Returns the impacts
 * (for sparks) and the keys of stones that have finished fading out.
 */
export function advance(world, dt, now) {
  const impacts = [];
  const intro = [...world.bodies.values()].some((b) => b.intro);
  if (!intro && !world.zoomKey && !world.hoverKey && now > world.nextKick) kick(world, now);
  world.acc += Math.min(Math.max(dt, 0), 0.1);          // a background tab never explodes the sim
  let n = 0;
  while (world.acc >= STEP && n++ < 12) { step(world, STEP, impacts); world.acc -= STEP; }
  if (n >= 12) world.acc = 0;
  return { impacts, gone: reap(world) };
}
