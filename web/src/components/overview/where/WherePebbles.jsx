import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { formatMoney } from '../../../api';
import { CategoryGlyph } from '../../../lib/categories/category-icons';
import { createWorld, targetsFor, setTargets, settle, advance } from '../../../lib/overview/pebble-physics';
import { tileContent } from '../../../lib/overview/tile-content';
import { textWidth } from './measure';

/**
 * Pebbles, animated (D373): one stone per category with momentum — see
 * lib/overview/pebble-physics.js. React renders the stones; the loop only
 * copies each frame's x/y/rotation onto them, so nothing re-renders at
 * 60 fps. A press opens the stone when the button comes back up, wherever
 * the stone has rolled to (a moving target loses plain clicks).
 */
const BOUNDS = { top: 14, pad: 12 };
const hash = (s) => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
// A slightly irregular outline and stretch per stone, fixed so a category is always the same stone.
const outline = (s) => `${36 + (s % 23)}% ${64 - ((s >> 5) % 19)}% ${40 + ((s >> 9) % 17)}% ${60 - ((s >> 13) % 13)}% / ${44 + ((s >> 3) % 19)}% ${38 + ((s >> 7) % 15)}% ${62 - ((s >> 11) % 21)}% ${46 + ((s >> 15) % 11)}%`;
const stoneFill = (c) => ({
  background: `radial-gradient(circle at 34% 28%, color-mix(in oklab, ${c} 55%, white) 0%, ${c} 52%, color-mix(in oklab, ${c} 82%, black) 100%)`,
  boxShadow: `0 10px 24px -10px color-mix(in srgb, ${c} 75%, transparent), inset 0 -6px 14px rgb(0 0 0 / 0.1), inset 0 4px 10px rgb(255 255 255 / 0.25)`,
});

/** Copy the world onto the stones and their labels; the one under the pointer stays bright. */
function paintStones(world, nodes, labels) {
  for (const [k, b] of world.bodies) {
    const el = nodes.get(k); if (!el) continue;
    const stretch = 1.05 + (hash(k) % 13) / 100, scale = Math.max(b.r, 0) / 50, q = 1 + b.sq * 0.08;
    const dim = world.hoverKey && world.hoverKey !== k ? 0.4 : 1;
    el.style.transform = `translate(${b.x - 50}px, ${b.y - 50}px) rotate(${b.rot}deg) scale(${scale * stretch * q}, ${scale / stretch / q})`;
    el.style.opacity = b.bg ? 0.1 : b.o * dim;
    const lb = labels.get(k);
    if (lb) {
      lb.style.transform = k.startsWith('m:') ? `translate(-50%, 0) translate(${b.x}px, ${b.y + b.r * 0.85 + 4}px)` : `translate(-50%, -50%) translate(${b.x}px, ${b.y}px)`;
      const grown = b.tr > 0 ? Math.min(Math.max((b.r / b.tr - 0.6) / 0.4, 0), 1) : 1;   // a label shows as its stone reaches its size
      lb.style.opacity = b.bg ? 0 : b.o * grown * (dim < 1 ? 0.3 : 1);
    }
  }
}

/** Sparks: a few streaks per hit, sized by how hard it was; a faint ring on the hardest. */
function burst(list, { x, y, a, b, force }, colorOf) {
  if (list.length > 80) return;
  const n = Math.round(Math.min(3 + force / 70, 10)), speed = 60 + force * 0.4;
  for (let i = 0; i < n; i++) {
    const ang = Math.random() * 6.283, sp = speed * (0.35 + Math.random() * 0.8);
    list.push({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 0, max: 0.22 + Math.random() * 0.3, w: 1.1 + Math.random() * 1.2,
                c: Math.random() < 0.25 ? 'rgb(255 246 216)' : colorOf(Math.random() < 0.5 || !b ? a : b) });
  }
  if (force > 260) list.push({ ring: true, x, y, life: 0, max: 0.35, r: 10 + Math.min(force, 500) * 0.03, c: colorOf(a) });
}
function drawSparks(canvas, list, dt) {
  const ctx = canvas.getContext('2d'), d = devicePixelRatio || 1, W = canvas.clientWidth, H = canvas.clientHeight;
  if (canvas.width !== Math.round(W * d)) { canvas.width = Math.round(W * d); canvas.height = Math.round(H * d); }
  ctx.setTransform(d, 0, 0, d, 0, 0); ctx.clearRect(0, 0, W, H); ctx.lineCap = 'round';
  const alive = list.filter((p) => {
    p.life += dt; if (p.life >= p.max) return false;
    const k = p.life / p.max;
    if (p.ring) { ctx.globalAlpha = (1 - k) * 0.4; ctx.strokeStyle = p.c; ctx.lineWidth = 1.5 * (1 - k) + 0.5; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (0.4 + k), 0, 6.283); ctx.stroke(); return true; }
    const drag = Math.exp(-3.5 * dt); p.vx *= drag; p.vy = p.vy * drag + 200 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
    ctx.globalAlpha = (1 - k) ** 1.5; ctx.strokeStyle = p.c; ctx.lineWidth = p.w;
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04); ctx.stroke();
    return true;
  });
  ctx.globalAlpha = 1;
  return alive;
}

export function WherePebbles({ replay, items, picked, merchants, merchant, hover, onPick, onMerchant, onHover }) {
  const stage = useRef(null), canvas = useRef(null), world = useRef(null), down = useRef(null), sparks = useRef([]), poppedFor = useRef(null);
  const nodes = useRef(new Map()), labels = useRef(new Map()), colors = useRef(new Map());
  const reduce = useReducedMotion();
  const [size, setSize] = useState(null);

  // The stones on screen: every category (and a picked one's merchants), plus any still fading out.
  const current = useMemo(() => [...items.map((it) => ({ key: it.key, item: it })), ...merchants.map((m) => ({ key: m.key, merchant: m }))], [items, merchants]);
  const [prev, setPrev] = useState(current);
  const [leaving, setLeaving] = useState([]);
  if (prev !== current) {
    setPrev(current);
    const now = new Set(current.map((s) => s.key));
    setLeaving((l) => [...l.filter((s) => !now.has(s.key)), ...prev.filter((s) => !now.has(s.key))]);
  }
  const targets = useMemo(() => size && targetsFor({ W: size.w, H: size.h, ...BOUNDS }, items, { zoom: picked, merchants }), [size, items, picked, merchants]);
  const targetOf = useMemo(() => new Map((targets ?? []).map((t) => [t.key, t])), [targets]);

  useLayoutEffect(() => {
    const el = stage.current, ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el); return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!targets) return;
    for (const s of current) colors.current.set(s.key, s.item?.color.css ?? s.merchant.color);
    const first = !world.current;
    const w = (world.current ??= createWorld({ width: size.w, height: size.h, ...BOUNDS }));
    w.W = size.w; w.H = size.h; w.zoomKey = picked;
    // The first fill, and every new month, span or person, pops out of the middle one stone after
    // another (D376); Reduce Motion places them.
    const again = !first && poppedFor.current !== replay;
    poppedFor.current = replay;
    setTargets(w, targets, (first || again) && !reduce ? { burstFrom: { x: size.w / 2, y: size.h / 2 }, again } : {});
    if (reduce) settle(w);
    paintStones(w, nodes.current, labels.current);
  }, [targets, current, leaving, size, picked, reduce, replay]);

  useEffect(() => {
    const w = world.current; if (!w) return;
    w.hoverKey = hover; paintStones(w, nodes.current, labels.current);
  }, [hover]);

  useEffect(() => {
    if (reduce) return undefined;
    let raf, last = performance.now();
    const colorOf = (k) => colors.current.get(k) ?? 'white';
    const loop = (now) => {
      const w = world.current, dt = (now - last) / 1000; last = now;
      if (w) {
        const { impacts, gone } = advance(w, dt, now);
        for (const hit of impacts) burst(sparks.current, hit, colorOf);
        paintStones(w, nodes.current, labels.current);
        if (gone.length) setLeaving((l) => l.filter((s) => !gone.includes(s.key)));
      }
      if (canvas.current) sparks.current = drawSparks(canvas.current, sparks.current, dt);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [reduce]);

  // Press opens on release, if the pointer didn't travel: works on a stone that's still rolling.
  useEffect(() => {
    const up = (e) => {
      const d = down.current; down.current = null;
      if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 10) d.open();
    };
    addEventListener('pointerup', up); return () => removeEventListener('pointerup', up);
  }, []);
  const point = (k) => { const b = world.current?.bodies.get(k); return b && { x: b.x, y: b.y - b.r * 0.55 }; };

  const stones = [...current, ...leaving.filter((s) => !targetOf.has(s.key))];
  return (
    <div ref={stage} className="relative h-full w-full">
      {stones.map(({ key: k, item: it, merchant: m }) => {
        const t = targetOf.get(k), open = () => (m ? onMerchant(m.name) : onPick(k));
        return (
          <button key={k} type="button" ref={(el) => { if (el) nodes.current.set(k, el); else nodes.current.delete(k); }}
            aria-label={`${it?.name ?? m.name}, ${formatMoney(it?.value ?? m.value)}`} tabIndex={!t || t.bg ? -1 : 0}
            onPointerDown={(e) => { down.current = { x: e.clientX, y: e.clientY, open }; }}
            onClick={(e) => { if (e.detail === 0) open(); }}
            onPointerEnter={() => onHover(k, point(k))} onPointerMove={() => onHover(k, point(k))} onPointerLeave={() => onHover(null)}
            onFocus={() => onHover(k, point(k))} onBlur={() => onHover(null)}
            className={`absolute left-0 top-0 size-[100px] cursor-pointer ${!t || t.bg ? 'pointer-events-none' : ''} ${m && m.name === merchant ? 'ring-4 ring-raised' : ''}`}
            style={{ borderRadius: outline(hash(k)), zIndex: t?.pinned ? 2 : undefined, opacity: 0, ...stoneFill(it?.color.css ?? m.color) }} />
        );
      })}
      <div className="pointer-events-none absolute inset-0 z-[3]">
        {current.map(({ key: k, item: it, merchant: m }) => {
          const r = targetOf.get(k)?.r ?? 30;
          return (
            <div key={k} ref={(el) => { if (el) labels.current.set(k, el); else labels.current.delete(k); }} style={{ opacity: 0 }}
              className={`absolute left-0 top-0 whitespace-nowrap text-center leading-tight ${m ? 'text-ink' : it.color.onDark ? 'text-black/80' : 'text-white'}`}>
              {m ? (
                <><div className="text-xs font-medium">{m.name}</div><div className="font-mono text-xs tnum text-muted">{formatMoney(m.value, { compact: true })}</div></>
              ) : (() => {
                // the same rule as the fixed tiles, in the square that fits inside the stone
                const amount = formatMoney(it.value, { compact: true }), box = r * 1.35;
                const c = tileContent({ w: box, h: box, nameWidth: textWidth(it.name, { size: 13 }), amountWidth: textWidth(amount, { size: 17, weight: 600, mono: true }) });
                return c.show === 'none' ? null : (
                  <span className="flex flex-col items-center gap-1">
                    <CategoryGlyph iconKey={it.icon} size={c.icon} />
                    {c.show !== 'icon' && <span className="text-[13px] font-medium">{it.name}</span>}
                    {c.show === 'all' && <span className="font-mono text-[17px] font-semibold tnum">{amount}</span>}
                  </span>
                );
              })()}
            </div>
          );
        })}
      </div>
      <canvas ref={canvas} className="pointer-events-none absolute inset-0 z-[4] size-full" aria-hidden="true" />
    </div>
  );
}
