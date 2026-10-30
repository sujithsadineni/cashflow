import { useEffect, useMemo, useRef } from 'react';
import { useReducedMotion } from 'motion/react';
import { formatMoney } from '../../../api';
import { useDesign } from '../../../hooks/use-design';
import { fieldHomes, driftField, weightsAt, cardHeight, CARD_RATIO } from '../../../lib/overview/wallet-fields';
import { createWalletRenderer } from './wallet-gl';

/**
 * The Wallet card (D373): a card whose colour is the spending — every
 * category a soft field of its own colour (lib/overview/wallet-fields.js),
 * drifting slowly, a sheen passing, the card tilting a little toward the
 * pointer. Families first — one colour each, named on the card — and a
 * click opens a family into its categories' own colours. The colour under
 * the pointer is named; the rest frosts over.
 *
 * Drawn on the GPU (wallet-gl.js) at full resolution every frame, from one
 * loop that also runs the springs; it rests while the card is off screen,
 * the tab is hidden, or Reduce Motion is on (then it draws only when
 * something changes). The hover reaches the rest of the card at most once
 * a frame, and only when the colour under the pointer changes or the
 * pointer has moved, so moving across the card doesn't re-render the page.
 */
const spring = (o, k, target, dt, resp, still) => {
  if (still) { o[k] = target; o.v[k] = 0; return; }
  const w = 6.283 / resp, v = o.v[k] ?? 0; o.v[k] = v + (-w * w * (o[k] - target) - 2 * w * v) * dt; o[k] += o.v[k] * dt;
};

export function WhereWallet({ items, families, family, onFamily, onBack, total, caption, picked, hover, onPick, onHover }) {
  const root = useRef(null), card = useRef(null), host = useRef(null);
  const reduce = !!useReducedMotion();
  const { theme } = useDesign();
  const S = useRef({ fields: new Map(), tilt: { rx: 0, ry: 0, tx: 0, ty: 0, v: {} }, focus: null, live: [], dirty: true, dark: false, kick: null });
  // The fields: every family, or the open family's categories. A family's key is "fam:<key>".
  const shown = useMemo(() => (family
    ? items.filter((i) => i.family === family.key).map((i) => ({ key: i.key, name: i.name, value: i.value, family: i.key, color: i.color }))
    : families.map((f) => ({ key: `fam:${f.key}`, name: f.name, value: f.value, family: f.key, color: f.color }))), [items, families, family]);
  const homes = useMemo(() => fieldHomes(shown), [shown]);
  const labels = useMemo(() => homes.map((h) => {
    const it = shown.find((x) => x.key === h.key), u = h.x, v = h.y / cardHeight;
    const clear = !(u < 0.4 && v < 0.24) && !(u < 0.5 && v > 0.68);          // not over the title or the total
    return { key: h.key, name: it.name, value: it.value, u, v, size: Math.min(h.sx, h.sy / cardHeight), clear, dark: it.color.onDark };
  }).filter((l) => l.clear && l.size > 0.09), [homes, shown]);

  // New homes: existing fields glide there, new ones grow in, missing ones fade.
  useEffect(() => {
    const F = S.current.fields, seen = new Set();
    homes.forEach((h, i) => {
      seen.add(h.key);
      const f = F.get(h.key) ?? { key: h.key, x: h.x, y: h.y, sx: h.sx, sy: h.sy, amp: 0, hl: 0, v: {}, ph: i * 1.7, p1: 14 + (i % 7) * 1.7, p2: 16 + (i % 5) * 2 };
      Object.assign(f, { lab: h.lab, t: { x: h.x, y: h.y, sx: h.sx, sy: h.sy, amp: 1 } });
      F.set(h.key, f);
    });
    for (const [k, f] of F) if (!seen.has(k)) f.t = { ...f.t, amp: 0 };
    S.current.dirty = true; S.current.kick?.();
  }, [homes]);
  useEffect(() => { S.current.focus = hover ?? picked; S.current.dirty = true; S.current.kick?.(); }, [hover, picked]);
  useEffect(() => { S.current.dark = theme === 'dark'; S.current.dirty = true; S.current.kick?.(); }, [theme]);

  // One loop: springs, drift, tilt, then one draw. Paused off screen and in a hidden tab.
  useEffect(() => {
    const box = host.current, st = S.current;
    let renderer = createWalletRenderer(box), raf = 0, last = performance.now(), onScreen = true;
    const fit = () => {
      const canvas = renderer.canvas, d = Math.min(devicePixelRatio || 1, 2), r = box.getBoundingClientRect();
      const w = Math.max(Math.round(r.width * d), 1), h = Math.max(Math.round(r.height * d), 1);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; st.dirty = true; }
    };
    const tick = (now) => {
      raf = 0;
      const dt = Math.min((now - last) / 1000, 0.05), t = now / 1000; last = now;
      if (renderer.lost) { renderer.dispose(); renderer = createWalletRenderer(box, { prefer: '2d' }); st.dirty = true; }
      let moving = false;
      st.live = [];
      for (const [k, f] of st.fields) {
        for (const p of ['x', 'y', 'sx', 'sy', 'amp']) spring(f, p, f.t[p], dt, 0.6, reduce);
        spring(f, 'hl', k === st.focus ? 1 : 0, dt, 0.35, reduce);
        Object.assign(f, driftField(f, t, reduce));
        if (Math.abs(f.v.x ?? 0) + Math.abs(f.v.amp ?? 0) + Math.abs(f.v.hl ?? 0) > 1e-4) moving = true;
        if (f.amp > 0.002 || f.t.amp > 0) st.live.push(f); else st.fields.delete(k);
      }
      const tl = st.tilt;
      spring(tl, 'rx', tl.tx, dt, 0.4, reduce); spring(tl, 'ry', tl.ty, dt, 0.4, reduce);     // settles, no bounce
      card.current.style.transform = `perspective(1400px) rotateX(${tl.rx.toFixed(3)}deg) rotateY(${tl.ry.toFixed(3)}deg)`;
      if (!reduce || st.dirty || moving) {
        fit();
        const focusMix = st.live.reduce((m, f) => Math.max(m, f.hl), 0);
        renderer.draw({ fields: st.live, focusMix, sheen: reduce ? -1 : ((t % 11) / 11) * 2.2 - 0.6, dark: st.dark });
        st.dirty = false;
        renderer.canvas.stats = { kind: renderer.kind, draws: (renderer.canvas.stats?.draws ?? 0) + 1 };   // read by the end-to-end check
      }
      // keep going while it animates; with Reduce Motion, only until things settle
      if (onScreen && !document.hidden && (!reduce || moving)) raf = requestAnimationFrame(tick);
    };
    const kick = () => { if (!raf && onScreen && !document.hidden) raf = requestAnimationFrame(tick); };
    st.kick = kick;
    const io = new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; kick(); });
    io.observe(box);
    const ro = new ResizeObserver(() => { st.dirty = true; kick(); });
    ro.observe(box);
    document.addEventListener('visibilitychange', kick);
    kick();
    return () => { cancelAnimationFrame(raf); io.disconnect(); ro.disconnect(); document.removeEventListener('visibilitychange', kick); st.kick = null; renderer.dispose(); };
  }, [reduce]);

  // Which colour is under the pointer: the same blend the GPU draws.
  const sample = (e) => {
    const r = card.current.getBoundingClientRect(), base = root.current.getBoundingClientRect();
    const u = (e.clientX - r.left) / r.width, v = (e.clientY - r.top) / r.height, live = S.current.live, w = new Float64Array(live.length);
    weightsAt(u, v * cardHeight, live, w);
    let key = null, bw = 0;
    live.forEach((f, i) => { if (f.t.amp > 0 && w[i] > bw) { bw = w[i]; key = f.key; } });
    return { key, u, v, at: { x: e.clientX - base.left, y: e.clientY - base.top } };
  };
  // At most once a frame, and only when it says something new.
  const pending = useRef(null), sent = useRef({ key: undefined, at: null }), frame = useRef(0);
  const report = (key, at) => {
    pending.current = { key, at };
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const p = pending.current, s = sent.current;
      if (p.key === s.key && (!p.key || (s.at && Math.hypot(p.at.x - s.at.x, p.at.y - s.at.y) < 6))) return;
      sent.current = p; onHover(p.key, p.at);
    });
  };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  useEffect(() => { sent.current = { key: undefined, at: null }; }, [shown]);   // new colours: the next hover always reports
  const move = (e) => {
    const h = sample(e), tl = S.current.tilt;
    tl.tx = (0.5 - h.v) * 4; tl.ty = (h.u - 0.5) * 6; S.current.kick?.();
    report(h.key, h.at);
  };
  const leave = () => { const tl = S.current.tilt; tl.tx = tl.ty = 0; S.current.kick?.(); report(null, null); };

  return (
    <div ref={root} className="flex h-full flex-col justify-center gap-4 px-4">
      <div ref={card} role="img" aria-label={`Spending for ${caption}: ${formatMoney(total)}, largest ${items.slice(0, 3).map((i) => i.name).join(', ')}`}
        onPointerMove={move} onPointerLeave={leave}
        onClick={(e) => { const k = sample(e).key; if (!k) return; if (k.startsWith('fam:')) onFamily(k.slice(4)); else onPick(k); }}
        className="relative w-full cursor-crosshair overflow-hidden rounded-[4.2%/6.6%] shadow-[0_22px_50px_-18px_rgb(30_20_70/0.45)]" style={{ aspectRatio: CARD_RATIO }}>
        <div ref={host} className="absolute inset-0" aria-hidden="true" />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_top,rgb(0_0_0/0.3),transparent_46%),linear-gradient(to_bottom,rgb(0_0_0/0.16),transparent_26%)]" />
        <div className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.28)]" />
        <div className="pointer-events-none absolute left-[4.4%] top-[6%] text-white [text-shadow:0_1px_12px_rgb(0_0_0/0.25)]">
          <div className="text-sm font-medium">{family ? family.name : 'Where it\'s going'}</div>
          <div className="text-xs opacity-85">{caption}</div>
        </div>
        {family && (
          <button type="button" onClick={(e) => { e.stopPropagation(); onBack(); }}
            className="absolute right-[3.6%] top-[5%] z-10 rounded-full bg-white/25 px-3 py-1 text-xs font-medium text-white backdrop-blur-md hover:bg-white/35">
            ‹ All families
          </button>
        )}
        {labels.map((l) => (
          <div key={l.key} aria-hidden="true" className={`pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-center leading-tight ${l.dark ? 'text-black/75' : 'text-white [text-shadow:0_1px_8px_rgb(0_0_0/0.25)]'}`}
            style={{ left: `${l.u * 100}%`, top: `${l.v * 100}%` }}>
            <div className="text-xs font-medium">{l.name}</div>
            <div className="font-mono text-sm font-semibold tnum">{formatMoney(l.value, { compact: true })}</div>
          </div>
        ))}
        <div className="pointer-events-none absolute bottom-[7%] left-[4.4%] text-white [text-shadow:0_1px_14px_rgb(0_0_0/0.25)]">
          <div className="font-mono text-4xl font-bold tracking-tight tnum">{formatMoney(total)}</div>
          <div className="text-sm opacity-90">across {items.length} categories</div>
        </div>
      </div>
    </div>
  );
}
