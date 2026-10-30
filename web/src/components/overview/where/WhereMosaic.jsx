import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { formatMoney } from '../../../api';
import { CategoryGlyph } from '../../../lib/categories/category-icons';
import { FAMILIES } from '../../../lib/overview/spend-families';
import { mosaicLayout, MOSAIC } from '../../../lib/overview/pebble-mosaic';
import { tileContent } from '../../../lib/overview/tile-content';
import { textWidth } from './measure';

/**
 * Pebbles, fixed (D373): the card filled with one tile per category, by
 * family, a few px apart — lib/overview/pebble-mosaic.js. Nothing moves
 * but the layout itself. Each tile shows, centred, what its room allows
 * (lib/overview/tile-content.js): the icon, then the name, then the amount.
 * Clicking a tile lists its transactions beside the card; the families
 * already show in the tiles' grouping, so the card itself stays put.
 */
const EASE = 'cubic-bezier(.2,.8,.2,1)';
const POP = 'cubic-bezier(.34,1.45,.64,1)';     // a little past, then back: a pop

export function WhereMosaic({ replay, items, picked, hover, onPick, onHover }) {
  const stage = useRef(null);
  const reduce = useReducedMotion();
  const [size, setSize] = useState(null);
  useLayoutEffect(() => {
    const el = stage.current, ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el); return () => ro.disconnect();
  }, []);

  const families = useMemo(() => FAMILIES.map((f) => ({ ...f, items: items.filter((i) => i.family === f.key) })).filter((f) => f.items.length), [items]);
  const layout = useMemo(() => size && mosaicLayout(families, { x: 10, y: 10, w: size.w - 20, h: size.h - 20 }), [families, size]);
  const tileOf = useMemo(() => new Map((layout?.tiles ?? []).map((t) => [t.key, t])), [layout]);
  // The first fill and every new month (D376): every tile waits in the middle of the card, then pops to its place at a
  // random moment in the first half second. Later layout changes just glide. Reduce Motion skips it.
  const [entry, setEntry] = useState(reduce ? 'done' : 'from');
  const [entryFor, setEntryFor] = useState(replay);
  if (entryFor !== replay) { setEntryFor(replay); if (!reduce) setEntry('from'); }   // a new month, span or person pops in again
  const [delays, setDelays] = useState({});
  useEffect(() => {
    if (entry !== 'from' || !layout) return undefined;
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => { setDelays(Object.fromEntries(items.map((i) => [i.key, Math.round(Math.random() * 450)]))); setEntry('go'); });
    });
    return () => cancelAnimationFrame(raf);
  }, [entry, layout, items]);
  // Its own effect: when the pop ends, the per-tile delays go, so a hover dims everything at once.
  useEffect(() => {
    if (entry !== 'go') return undefined;
    const done = setTimeout(() => setEntry('done'), 1300);
    return () => clearTimeout(done);
  }, [entry]);
  // What each tile shows, by its room and the measured width of its name and amount.
  const geom = useMemo(() => new Map(items.map((it) => {
    const t = tileOf.get(it.key), w = t?.w ?? 0, h = t?.h ?? 0, amount = formatMoney(it.value, { compact: true });
    const c = tileContent({ w, h, nameWidth: textWidth(it.name, { size: 13 }), amountWidth: textWidth(amount, { size: 17, weight: 600, mono: true }) });
    return [it.key, { t, w, h, amount, ...c }];
  })), [items, tileOf]);

  return (
    <div ref={stage} className="relative h-full w-full">
      {families.map((f) => {
        const h = layout?.heads.find((x) => x.key === f.key);
        // the header by the same rule as the tiles: name and amount if both fit, the name if it does, else the icon
        const sum = formatMoney(f.items.reduce((s, i) => s + i.value, 0), { compact: true });
        const nameW = textWidth(f.name, { size: 12 }), sumW = textWidth(sum, { size: 12, weight: 400, mono: true }), room = (h?.w ?? 0) - 26;
        const label = nameW + 8 + sumW <= room ? 'both' : nameW <= room ? 'name' : 'icon';
        return (
          <div key={f.key} aria-hidden="true" className="pointer-events-none absolute z-[4] flex items-center justify-center gap-1.5 overflow-hidden whitespace-nowrap text-xs font-medium text-muted"
            style={{ left: h?.x ?? 0, top: h?.y ?? 0, width: h?.w ?? 0, height: MOSAIC.header, opacity: h?.shown && entry !== 'from' ? 1 : 0,
              transition: `left .6s ${EASE}, top .6s ${EASE}, width .6s ${EASE}, opacity .35s ${entry === 'go' ? '.45s' : '0s'}` }}>
            <span className={`flex size-5 items-center justify-center rounded-md ${f.items[0].color.onDark ? 'text-black/80' : 'text-white'}`} style={{ backgroundColor: f.items[0].color.css }}>
              <CategoryGlyph iconKey={f.icon} size={12} />
            </span>
            {label !== 'icon' && f.name}
            {label === 'both' && <span className="font-normal tnum">{sum}</span>}
          </div>
        );
      })}
      {items.map((it) => {
        const { t, w, h, amount, show, icon } = geom.get(it.key), shown = !!t;
        const dim = (hover && hover !== it.key) || (picked && picked !== it.key && !hover);
        const away = entry === 'from' && t && size ? `translate(${size.w / 2 - (t.x + w / 2)}px, ${size.h / 2 - (t.y + h / 2)}px) scale(0.05)` : 'none';
        const delay = entry === 'go' ? delays[it.key] ?? 0 : 0;
        // Picked, the tile lifts off the card; under the pointer, a little (D377). Not mid-pop.
        const lifted = entry === 'done' && !reduce ? (picked === it.key ? 'translateY(-2px) scale(1.035)' : hover === it.key ? 'translateY(-1px) scale(1.012)' : 'none') : null;
        return (
          <button key={it.key} type="button" tabIndex={shown ? 0 : -1} aria-label={`${it.name}, ${formatMoney(it.value)}`}
            onClick={() => onPick(it.key)} onPointerEnter={() => onHover(it.key, t && { x: t.x + t.w / 2, y: t.y + 8 })} onPointerLeave={() => onHover(null)}
            onFocus={() => onHover(it.key, t && { x: t.x + t.w / 2, y: t.y + 8 })} onBlur={() => onHover(null)}
            className={`absolute overflow-hidden text-left ${it.color.onDark ? 'text-black/80' : 'text-white'} ${picked === it.key ? 'ring-2 ring-inset ring-white/80' : ''}`}
            style={{ left: t?.x ?? 0, top: t?.y ?? 0, width: w, height: h, opacity: shown && entry !== 'from' ? (dim ? 0.55 : 1) : 0, pointerEvents: shown ? undefined : 'none', transform: lifted ?? away, zIndex: picked === it.key ? 3 : hover === it.key ? 2 : undefined,
              borderRadius: Math.min(w, h) < 48 ? '12px 14px 11px 13px / 13px 11px 14px 12px' : '18px 22px 17px 21px / 21px 17px 22px 18px',
              background: `radial-gradient(130% 120% at 22% 12%, color-mix(in oklab, ${it.color.css} 72%, white) 0%, ${it.color.css} 46%, color-mix(in oklab, ${it.color.css} 86%, black) 100%)`,
              boxShadow: `inset 0 1px 0 rgb(255 255 255 / 0.35), inset 0 -8px 18px rgb(0 0 0 / 0.08)${picked === it.key ? `, 0 18px 34px -12px color-mix(in srgb, ${it.color.css} 70%, black), 0 6px 14px -6px rgb(0 0 0 / 0.45)` : hover === it.key ? ', 0 8px 18px -10px rgb(0 0 0 / 0.4)' : ''}`,
              transition: reduce ? 'opacity .2s' : entry === 'from' ? 'none'
                : entry === 'go' ? `transform .6s ${POP} ${delay}ms, opacity .2s ${delay}ms`
                : `left .6s ${EASE}, top .6s ${EASE}, width .6s ${EASE}, height .6s ${EASE}, opacity .35s, transform .35s ${POP}, box-shadow .35s ${EASE}` }}>
            {show !== 'none' && (
              <span aria-hidden="true" className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 whitespace-nowrap text-center leading-tight">
                <CategoryGlyph iconKey={it.icon} size={icon} />
                {show !== 'icon' && <span className="text-[13px] font-medium">{it.name}</span>}
                {show === 'all' && <span className="font-mono text-[17px] font-semibold tnum">{amount}</span>}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
