import { easeInOut, glideTo } from '../../lib/imports/glide';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { formatMoney, formatShortDate, maskName, shortPersonName, TXN_TYPE_LABELS } from '../../api';
import { MerchantAvatar } from '../ui/MerchantAvatar';
import { txnName } from '../../lib/transactions/txn-name';
import { lineStep, markLine, runningTotals, tapeEnding } from '../../lib/imports/reading-styles';
import { useColumns } from '../../hooks/use-columns';
import { printedOrder, printedSections, sectionFigures } from '../../lib/imports/printed-order';
import { notesSoFar } from '../../lib/imports/statement-notes';
import { readingLabel } from '../../lib/imports/reading-label';
import { useHeight } from '../../hooks/use-height';
import { StatementNotes, NOTES_BOX } from './StatementNotes';

/**
 * A statement being read into its rows, right after a parse (D171, D335),
 * in the style picked in Settings → Animation:
 *
 *   A decode     each printed line decodes into its row, top to bottom
 *   B highlight  a marker picks out date, merchant and amount on the line,
 *                and those pieces slide into their columns
 *   C paper      the page above the rows; a scan line reads it and each
 *                line lifts off the page into its row (the default)
 *   D tape       rows print in under a running total that meets what the
 *                balances moved by, then the check stamps in
 *
 * Every style runs the same clock: each line is read, then lands, about
 * 7 seconds for the whole statement (lineStep). It draws the same columns
 * as the review table it hands over to, so nothing jumps when it ends; a
 * click anywhere skips to the end. It answers the owner's own upload, so it
 * plays in every design; under Reduce Motion it never starts (Review shows
 * the rows at once).
 *
 * It reads the statement as printed (D360): the summary's figures first, one
 * box at a time, then the rows in the order they sit on the pages, so the
 * pages beside it move steadily down; on a shared card each person's rows
 * come under a line with their name, which takes their count, total and
 * check against the statement's own total once their last row lands. Then
 * "Organizing…", and the rows slide into date order, the table Review shows.
 */

// The slowest a line may go, per style: the highlighter and the page do more per line.
const FLOOR = { decode: 120, highlight: 240, paper: 260, tape: 140 };
// How a line's turn splits between being read and landing.
const READ_SHARE = { decode: 0.5, highlight: 0.62, paper: 0.38, tape: 0 };

const NOISE = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#*/';
// The summary's boxes fill in turn; then the organizing spinner, then the slide into date order.
const FIGURE_MS = 240;
// Organizing: the rows go to the top of view, then travel to their places by date, slowly.
const SPIN_MS = 800;
const SORT_S = 1.5;
const SORT_MS = 2600;
const SETTLE_MS = 700;
// Review's own order: by date, a dateless line first (GET /imports/:id/staged).
const byDate = (rows) => [...rows].sort((a, b) => (a.posted_date ?? '').localeCompare(b.posted_date ?? '') || a.id - b.id);

/** Text that resolves from noise, left to right. */
function Decode({ text, duration = 480 }) {
  const [out, setOut] = useState(() => text.replace(/\S/g, '·'));
  useEffect(() => {
    let raf;
    const t0 = performance.now();
    const tick = (now) => {
      const p = Math.min((now - t0) / duration, 1);
      const fixed = Math.floor(p * text.length);
      setOut(text.split('').map((c, i) => (i < fixed || c === ' ' ? c : NOISE[Math.floor(Math.random() * NOISE.length)])).join(''));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, duration]);
  return <>{out}</>;
}

/** A figure that counts from where it was to where it is, in about a third of a second. */
function CountUp({ cents }) {
  const [shown, setShown] = useState(cents);
  const from = useRef(cents);
  useEffect(() => {
    const start = from.current;
    const t0 = performance.now();
    let raf;
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / 340);
      setShown(Math.round(start + (cents - start) * (1 - (1 - k) ** 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
      else from.current = cents;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cents]);
  return <>{formatMoney(shown, { showSign: true })}</>;
}

const Tick = () => (
  <svg className="reveal-tick" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 8.5l3.2 3.2L13 4.8" />
  </svg>
);

const rawOf = (row) => row.raw_text ?? row.description ?? '';

/** One row as the review table draws it: same cells, same widths. */
function LandedRow({ row, iconFor, style, cellRef, rowRef, cols, order = 0 }) {
  const name = txnName(row) ?? row.description ?? '—';
  const arrive = (i) => ({ className: 'reveal-arrive', style: { animationDelay: `${style === 'highlight' ? 140 + i * 90 : 80 + i * 90}ms` } });
  return (
    // Organizing (D360): each row travels to its place by date, slowly, a beat after the one above it.
    <motion.tr layout="position" transition={{ duration: SORT_S, ease: [0.45, 0, 0.2, 1], delay: Math.min(order * 0.05, 0.9) }} ref={rowRef} className={`border-b border-rule ${style === 'tape' ? 'reveal-print' : ''}`}>
      <td className="h-12 py-2 pl-3 align-middle" />
      {cols.date && <td className="py-2 pr-3 align-middle font-mono text-muted tnum whitespace-nowrap">
        <span ref={cellRef?.('date')} className="inline-block">{row.posted_date ? formatShortDate(row.posted_date) : <span className="text-warn">no date</span>}</span>
      </td>}
      <td className="py-2 pr-4 align-middle">
        <div className="flex items-center gap-2">
          <span className={style === 'tape' ? '' : 'reveal-pop'}>
            <MerchantAvatar merchant={row.merchant} description={row.description} txnType={row.txn_type} amountCents={row.amount_cents}
              categoryName={row.category_name ?? row.suggested_category} categoryIconKey={row.category_icon_key ?? iconFor(row.suggested_category)} size={26} clickable={false} />
          </span>
          <span className="min-w-0">
            <span ref={cellRef?.('merchant')} className="block truncate text-ink">
              {style === 'decode' ? <Decode text={name} /> : name}
            </span>
            {!cols.date && <span className="block truncate text-xs text-muted">{[row.posted_date && formatShortDate(row.posted_date), row.suggested_category].filter(Boolean).join(' · ')}</span>}
          </span>
        </div>
      </td>
      {cols.type && <td className="py-2 pr-3 align-middle text-xs text-muted"><span {...(style === 'tape' ? {} : arrive(0))}>{TXN_TYPE_LABELS[row.txn_type] ?? row.txn_type ?? ''}</span></td>}
      {cols.category && <td className="py-2 pr-3 align-middle text-ink"><span {...(style === 'tape' ? {} : arrive(1))}>{row.category_name ?? row.suggested_category ?? '—'}</span></td>}
      <td className="py-2 pr-2 text-right align-middle whitespace-nowrap sm:pr-4">
        <span ref={cellRef?.('amount')} className={`inline-block font-mono text-sm tnum ${row.amount_cents < 0 ? 'text-spend' : 'text-earn'}`}>
          {row.amount_cents == null ? '—' : formatMoney(row.amount_cents, { showSign: true })}
        </span>
      </td>
      <td />
    </motion.tr>
  );
}

/**
 * A person's line on a shared card (D360): their name as soon as their first
 * row is read; their rows, total and check once their last one has landed.
 */
export function SectionLine({ run, figures, complete, span }) {
  const { count, total_cents: total, check } = figures;
  return (
    <tr aria-label={`${run.name ?? 'Unknown'}'s rows`}>
      <td colSpan={span} className="px-3 pt-4 pb-1.5">
        {/* reveal-arrive makes its element inline-block, so it goes on the pieces, never the row of them. */}
        <div className="flex w-full items-baseline gap-2 border-t border-rule-str pt-2 text-xs">
          <span className="reveal-arrive font-medium text-ink">{run.name ? maskName(run.name) : 'Not known yet'}</span>
          {run.card_ending && <span className="reveal-arrive text-faint tnum">··{run.card_ending}</span>}
          {complete && (
            <span className="ml-auto text-muted tnum">
              <span className="reveal-arrive">
                {count} {count === 1 ? 'row' : 'rows'} · <span className="font-mono">{formatMoney(total, { showSign: true })}</span>
                {check && (check.ok
                  ? <span className="ml-1.5 text-earn" title="Matches the total the statement prints for them">✓</span>
                  : <span className="ml-1.5 text-warn" title="What the statement prints for them">printed <span className="font-mono">{formatMoney(check.printed_cents, { showSign: true })}</span></span>)}
              </span>
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}

/** A line not yet read: as the statement printed it, marked up for the highlighter. */
function PrintedRow({ row, reading, marking, readMs, markRef, rowRef, span = 7 }) {
  const raw = rawOf(row);
  const segments = marking ? markLine(raw, row.description) : null;
  let k = 0;
  return (
    <tr ref={rowRef} className={`border-b border-rule transition-colors duration-300 ${reading ? 'bg-info/8' : ''}`}>
      <td colSpan={span} className={`h-12 truncate border-l-2 py-2 pl-3 font-mono text-xs whitespace-pre transition-colors duration-300 ${reading ? 'border-l-info text-ink' : 'border-l-transparent text-faint'}`}>
        {segments
          ? segments.map((s, i) => {
            if (!s.mark) return <span key={i}>{s.text}</span>;
            const order = k++;
            return (
              <span key={i} ref={markRef?.(s.mark)} data-mark={s.mark}
                className={`reveal-mark ${reading ? 'on' : ''} ${s.mark === 'amount' ? (row.amount_cents < 0 ? 'is-out' : 'is-in') : ''}`}
                style={{ transitionDelay: reading ? `${(order * readMs) / 3.4}ms` : '0ms' }}>
                {s.text}
              </span>
            );
          })
          : raw}
      </td>
    </tr>
  );
}

/** The page above the rows (C): every printed line, a scan line on the one being read, a tick on each one done. */
function Sheet({ rows, at, phase, lineRefs, sheetRef, label }) {
  return (
    <div ref={sheetRef} aria-hidden="true"
      className="reveal-sheet relative mx-auto max-h-44 w-full max-w-2xl min-w-0 overflow-hidden rounded-lg bg-white px-4 py-4 font-mono text-[10.5px] leading-[1.55] text-neutral-800 shadow-[0_1px_2px_rgb(0_0_0/0.08),0_12px_28px_-16px_rgb(0_0_0/0.4)]">
      <div className="mb-2 flex justify-between font-sans text-[11px] font-semibold text-neutral-900">
        <span className="truncate">{label ?? 'Statement'}</span>
        <span className="shrink-0 text-neutral-500">Transactions</span>
      </div>
      <div className="mb-3 space-y-1.5">
        <div className="h-1.5 w-2/3 rounded-full bg-neutral-200" />
        <div className="h-1.5 w-2/5 rounded-full bg-neutral-200" />
      </div>
      {rows.map((row, i) => (
        <div key={row.id} ref={(el) => { lineRefs.current[i] = el; }}
          className={`relative flex gap-2 rounded-[3px] py-px pr-1 pl-4 whitespace-nowrap transition-colors duration-300 ${
            i === at && phase === 'read' ? 'bg-[rgb(59_107_122/0.16)]' : ''} ${i < at ? 'text-neutral-400' : ''}`}>
          {i < at && <span className="absolute left-0.5 font-sans text-[#2F6B4F]">✓</span>}
          {/* The scan line sits on the line being read; it sweeps in each time it moves. */}
          {i === at && <span key={at} className="reveal-beam pointer-events-none absolute -inset-x-4 -top-1 h-6" />}
          <span className="min-w-0 truncate">{rawOf(row).replace(/\s{2,}/g, '  ')}</span>
        </div>
      ))}
      <div className="mt-3 space-y-1.5">
        <div className="h-1.5 w-3/5 rounded-full bg-neutral-200" />
        <div className="h-1.5 w-4/5 rounded-full bg-neutral-200" />
      </div>
    </div>
  );
}

/** Under the tape (D): the running total, what the statement says it should be, and the stamp. */
function TapeTotal({ total, ending, done }) {
  const expected = ending.kind === 'match' ? ending.cents : ending.kind === 'off' ? ending.expected : null;
  return (
    <div className="mx-0 mt-0 border-t-2 border-ink px-3 pt-3 pb-1">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1">
        <span className="text-sm text-muted">Rows so far</span>
        <span className="text-right font-mono text-base font-medium text-ink tnum"><CountUp cents={total} /></span>
        <span className="text-sm text-muted">{expected == null ? "The balances didn't print" : 'What the balances moved by, printed'}</span>
        <span className="text-right font-mono text-sm text-muted tnum">{expected == null ? '—' : formatMoney(expected, { showSign: true })}</span>
      </div>
      {done && (
        <p className={`reveal-stamp mt-3 flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-ink ${ending.kind === 'match' ? 'bg-earn/10' : ending.kind === 'off' ? 'bg-warn/12' : 'bg-band'}`}>
          <span className={ending.kind === 'match' ? 'text-earn' : 'text-warn'}>
            {ending.kind === 'match' ? <Tick /> : <span className="font-semibold">!</span>}
          </span>
          {ending.kind === 'match' && <span><span className="font-medium">Adds up to the cent.</span> The rows total what the balances moved by.</span>}
          {ending.kind === 'off' && <span><span className="font-medium text-warn">Doesn't add up.</span> <span className="font-mono tnum">{formatMoney(Math.abs(ending.gap))}</span> isn't accounted for. A line may be missing or misread.</span>}
          {ending.kind === 'unknown' && <span>This statement didn't print its balances, so the total can't be checked.</span>}
        </p>
      )}
    </div>
  );
}

export function StatementReveal({ rows: given, tally, style = 'paper', iconFor = () => null, paused = false, label, onDone, onProgress, pageBeside = false, printed = null, figures = null, figureKeys = [], notes = [], onFocusRow, onFocusFigure, headAtTop = false }) {
  const figureCount = figureKeys.length;
  // As printed (D360): every line below plays in this order.
  const rows = useMemo(() => printedOrder(given, printed?.located), [given, printed]);
  const runs = useMemo(() => printedSections(rows), [rows]);
  // Where each person's run starts and ends, by line.
  const runAt = useMemo(() => {
    const starts = new Map();
    let i = 0;
    for (const run of runs) {
      if (run.key) starts.set(i, { run, end: i + run.rows.length - 1, figures: sectionFigures(run, runs, printed?.totals ?? []) });
      i += run.rows.length;
    }
    return starts;
  }, [runs, printed]);
  // The summary's figures first, one box at a time; null once they're all in.
  const [intro, setIntro] = useState(figureCount > 0 ? 0 : null);
  // After the last line: 'no', then 'spinning' ("Organizing…"), 'sorted' (the rows travel to date order), 'settled'.
  const [organize, setOrganize] = useState('no');
  const step = lineStep(rows.length, FLOOR[style]);
  const readMs = step * READ_SHARE[style];
  const landMs = step - readMs;
  const [at, setAt] = useState(0); // the line being read; rows.length once every line has landed
  const [phase, setPhase] = useState(style === 'tape' ? 'land' : 'read');
  const finished = at >= rows.length;
  const [tableRef, cols] = useColumns();
  const outerRef = useRef(null);
  const [headRef, headHeight] = useHeight();

  const doneRef = useRef(onDone);
  useEffect(() => { doneRef.current = onDone; });
  // The highlighter's pieces on the line being read, and the cells they move to.
  const marks = useRef({});
  const cells = useRef({});
  const markRef = (key) => (el) => { marks.current[key] = el; };
  const cellRef = (key) => (el) => { cells.current[key] = el; };
  const from = useRef(null); // where the highlighted pieces were, just before they moved
  const lineRefs = useRef([]);
  const sheetRef = useRef(null);
  const slotRefs = useRef([]);
  const ghosts = useRef(new Set());
  const focusRow = useRef(null);

  // The summary, box by box, before the first line.
  useEffect(() => {
    if (paused || intro === null) return undefined;
    const t = setTimeout(() => setIntro(intro < figureCount ? intro + 1 : null), intro < figureCount ? FIGURE_MS : 300);
    return () => clearTimeout(t);
  }, [paused, intro, figureCount]);

  // The clock: read, land, next line; then organize by date, and hand over.
  useEffect(() => {
    if (paused || intro !== null) return undefined;
    if (finished) {
      const next = { no: ['spinning', style === 'tape' ? 1700 : 500], spinning: ['sorted', SPIN_MS], sorted: ['settled', SORT_MS], settled: [null, SETTLE_MS] }[organize];
      const t = setTimeout(() => (next[0] ? setOrganize(next[0]) : doneRef.current?.()), next[1]);
      return () => clearTimeout(t);
    }
    const first = at === 0 && (phase === 'read' || style === 'tape');
    if (phase === 'read') {
      const t = setTimeout(() => {
        // The highlighter: where the marked pieces sit now, before they move to their columns.
        if (style === 'highlight') {
          from.current = Object.fromEntries(['date', 'merchant', 'amount'].map((k) => [k, marks.current[k]?.getBoundingClientRect() ?? null]));
        }
        setPhase('land');
      }, readMs + (first ? 500 : 0));
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => { setAt((n) => n + 1); setPhase(style === 'tape' ? 'land' : 'read'); }, landMs + (first && style === 'tape' ? 400 : 0));
    return () => clearTimeout(t);
  }, [paused, intro, finished, organize, at, phase, style, readMs, landMs]);

  // B: each marked piece slides from where it was on the line to its column.
  useLayoutEffect(() => {
    if (style !== 'highlight' || phase !== 'land' || !from.current) return;
    for (const key of ['date', 'merchant', 'amount']) {
      const a = from.current[key];
      const el = cells.current[key];
      if (!a || !el) continue;
      const b = el.getBoundingClientRect();
      const dx = key === 'amount' ? a.right - b.right : a.left - b.left;
      el.animate(
        [{ transform: `translate(${dx}px, ${a.top - b.top}px)`, backgroundColor: 'color-mix(in srgb, var(--color-info) 20%, transparent)' }, { transform: 'none', backgroundColor: 'transparent' }],
        { duration: Math.max(260, landMs * 0.95), easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
      );
    }
    from.current = null;
  }, [style, phase, at]); // eslint-disable-line react-hooks/exhaustive-deps

  // C: the line lifts off the page and flies to its row's slot.
  useEffect(() => {
    if (style !== 'paper' || phase !== 'land' || finished) return undefined;
    // The real page beside the rows (D335) lends its line; otherwise the drawn page above them.
    const line = pageBeside ? document.querySelector(`[data-row-line="${rows[at].id}"]`) : lineRefs.current[at];
    const slot = slotRefs.current[at];
    if (!line || !slot) return undefined;
    const a = line.getBoundingClientRect();
    const b = slot.getBoundingClientRect();
    const ghost = document.createElement('div');
    ghost.className = 'reveal-ghost';
    ghost.textContent = rawOf(rows[at]).replace(/\s{2,}/g, '  ');
    Object.assign(ghost.style, { left: `${a.left}px`, top: `${a.top}px`, width: `${a.width}px` });
    document.body.appendChild(ghost);
    ghosts.current.add(ghost);
    const flight = ghost.animate([
      { transform: 'translate(0, 0)', opacity: 0.95 },
      { transform: `translate(${(b.left - a.left) / 2}px, ${(b.top - a.top) / 2 - 22}px) scale(1.03)`, opacity: 1, offset: 0.5 },
      { transform: `translate(${b.left - a.left}px, ${b.top - a.top + 12}px)`, opacity: 0.15, width: `${Math.min(b.width, 520)}px` },
    ], { duration: Math.max(240, landMs * 0.92), easing: 'cubic-bezier(0.45, 0, 0.2, 1)', fill: 'forwards' });
    const remove = () => { ghost.remove(); ghosts.current.delete(ghost); };
    flight.onfinish = remove;
    return () => { flight.cancel(); remove(); };
  }, [style, phase, at, finished, landMs, pageBeside]); // eslint-disable-line react-hooks/exhaustive-deps

  // Whoever shows the real page follows along: the line being read, and every line read so far.
  const progressRef = useRef(onProgress);
  useEffect(() => { progressRef.current = onProgress; });
  // Read through a ref: Review draws a fresh list each render, and the effect below reports to it.
  const figureKeysRef = useRef(figureKeys);
  useEffect(() => { figureKeysRef.current = figureKeys; });
  useEffect(() => {
    if (paused) return;
    // While the summary is read, the pages sit on page 1 (D360).
    if (intro !== null) { progressRef.current?.({ current: null, done: new Set(), summary: true, figure: figureKeysRef.current[intro - 1] ?? null }); return; }
    const upTo = style === 'paper' ? at : Math.min(at + (phase === 'land' ? 1 : 0), rows.length);
    progressRef.current?.({ current: rows[Math.min(at, rows.length - 1)]?.id ?? null, done: new Set(rows.slice(0, upTo).map((r) => r.id)) });
  }, [at, phase, paused, style, rows, intro]);
  useEffect(() => () => ghosts.current.forEach((g) => g.remove()), []);

  // Organizing (D360): the rows go back to the top of their column first, so their slide into date order is seen.
  // The browser's scroll anchoring would follow a row as the order changes and undo it, so it's off meanwhile.
  useEffect(() => {
    if (organize === 'no') return undefined;
    let box = outerRef.current?.parentElement ?? null;
    while (box && !(box.scrollHeight > box.clientHeight && /(auto|scroll)/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
    if (!box) return undefined;
    const anchor = box.style.overflowAnchor;
    box.style.overflowAnchor = 'none';
    // Driven here, not by smooth scrolling, which a layout change mid-way cuts short.
    let raf = 0;
    if (organize === 'spinning' && box.scrollTop > 0) {
      const from = box.scrollTop;
      const t0 = performance.now();
      const step = (now) => {
        const k = Math.min(1, (now - t0) / 600);
        box.scrollTop = from * (1 - easeInOut(k));
        if (k < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }
    return () => { cancelAnimationFrame(raf); box.style.overflowAnchor = anchor; };
  }, [organize]);

  // The page keeps the line being read in view; the table keeps the row it's on in view.
  useEffect(() => {
    const sheet = sheetRef.current;
    const line = lineRefs.current[at];
    if (sheet && line) glideTo(sheet, line);
    // The rows glide along with the line being read, in whatever scrolls them (the column, or the dialog).
    const row = focusRow.current;
    let box = row?.parentElement;
    while (box && !(box.scrollHeight > box.clientHeight && /(auto|scroll)/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
    if (row && box) glideTo(box, row);
  }, [at]);

  const totals = runningTotals(rows);
  const landedCount = style === 'paper' ? at : at + (phase === 'land' ? 1 : 0);
  const shown = paused ? 0 : Math.min(landedCount, rows.length);
  const ending = tapeEnding(tally);
  // What's being read, in the statement's own words (D360): its heading, or a shared card's person.
  const readingRow = rows[Math.min(at, rows.length - 1)];
  const progress = intro !== null ? 'Reading the summary'
    : !finished ? `Reading ${readingLabel(readingRow, printed?.headings?.[readingRow?.id], shortPersonName)}`
      : organize === 'no' ? (style === 'tape' ? 'Comparing with the statement' : 'Checking the total')
        : organize === 'settled' ? 'By date' : 'Organizing';
  const sorted = organize === 'sorted' || organize === 'settled';

  // One line in its state: landed, a slot waiting for it, or as printed.
  const cell = (row, i, current) => {
          if (i < shown) {
            const justLanded = i === shown - 1;
            return <LandedRow key={row.id} row={row} iconFor={iconFor} style={style} cols={cols} cellRef={justLanded ? cellRef : null} rowRef={current ? focusRow : null} />;
          }
          // Waiting for its account (NEEDS_ACCOUNT): every style shows the printed lines until it's confirmed.
          if (paused) return <PrintedRow key={row.id} row={row} reading={false} marking={false} readMs={readMs} span={cols.count} />;
          if (style === 'tape') return null;
          if (style === 'paper') {
            return <tr key={row.id} ref={(el) => { slotRefs.current[i] = el; if (current) focusRow.current = el; }} className="h-12 border-b border-dashed border-rule"><td colSpan={cols.count} /></tr>;
          }
          const reading = i === at && phase === 'read' && !paused;
          return <PrintedRow key={row.id} row={row} reading={reading} marking={style === 'highlight'} readMs={readMs} markRef={reading ? markRef : null} rowRef={current ? focusRow : null} span={cols.count} />;
  };

  const table = (
    <div ref={tableRef} className="min-w-0">
      <table className="w-full table-fixed border-collapse text-sm">
        {/* The table holds still (D360): its header sticks under the status line while rows come in under it. */}
        <thead className={paused ? '' : 'sticky z-10'} style={paused ? undefined : { top: headHeight }}>
          <tr className="table-head border-y border-rule bg-band text-left text-xs text-muted">
            <th className="w-9 bg-band py-2 pl-3 font-normal sm:w-10"><span className="sr-only">Selected</span></th>
            {cols.date && <th className={`${cols.type ? 'w-20' : 'w-16'} bg-band py-2 pr-3 font-normal`}>Date</th>}
            <th className="bg-band py-2 pr-4 font-normal">Merchant</th>
            {cols.type && <th className="w-32 bg-band py-2 pr-3 font-normal">Type</th>}
            {cols.category && <th className={`${cols.type ? 'w-40' : 'w-32'} bg-band py-2 pr-3 font-normal`}>Category</th>}
            <th className="w-[5.75rem] bg-band py-2 pr-2 text-right font-normal sm:w-28 sm:pr-4">Amount</th>
            <th className={`w-12 bg-band py-2 pr-2 text-right font-normal sm:pr-3 ${cols.type ? 'sm:w-28' : 'sm:w-24'}`}><span className="sr-only">Edit or review</span></th>
          </tr>
        </thead>
        <tbody>
          {/* One list, the same keys before and after, so organizing moves each row rather than redrawing it (D360). */}
          {sorted ? byDate(rows).map((row, i) => <LandedRow key={row.id} row={row} iconFor={iconFor} style={style} cols={cols} order={i} />)
            : rows.flatMap((row, i) => {
              const current = i === Math.min(at, rows.length - 1);
              // A person's line, once their first row is reached (D360).
              const start = runAt.get(i);
              const line = start && i <= at && !paused && intro === null
                ? [<SectionLine key={`line-${row.id}`} run={start.run} figures={start.figures} complete={start.end < shown} span={cols.count} />]
                : [];
              return [...line, cell(row, i, current)];
            })}
        </tbody>
      </table>
      {style === 'tape' && <TapeTotal total={shown ? totals[shown - 1] : 0} ending={ending} done={finished} />}
    </div>
  );

  return (
    <div ref={outerRef} onClick={() => !paused && doneRef.current?.()} className={paused ? '' : 'cursor-pointer'}>
      {/* The head holds still while the rows come in under it (D360): the summary, read first, box by box;
          then, half and half, the reading's progress and what the statement shows that's worth knowing. */}
      <div ref={headRef} className={paused ? '' : `sticky top-0 z-20 flow-root bg-raised ${headAtTop ? '-mt-4 pt-4' : 'pt-1'}`}>
        {figures?.(paused ? Infinity : intro ?? Infinity, intro ? figureKeys[intro - 1] : null)}
        {!paused && (
          <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {/* As the limit box: what's being read over the bar in four fifths, Skip in the last fifth (D360). */}
            <div className={`${NOTES_BOX} grid grid-cols-[minmax(0,4fr)_minmax(4.5rem,1fr)] items-center gap-3 text-[13px] text-muted`} role="status" aria-live="polite">
              <div className="min-w-0">
                <div className="flex items-center gap-2 leading-4">
                  {(organize === 'spinning' || organize === 'sorted') && (
                    <svg className="size-3.5 shrink-0 animate-spin text-info" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
                      <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  )}
                  <span className="min-w-0 truncate">{progress}{sorted ? '' : '…'}</span>
                  {!finished && intro === null && <span className="ml-auto shrink-0 text-[12px] text-faint tnum">{Math.min(at + 1, rows.length)}/{rows.length}</span>}
                </div>
                <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-rule" aria-hidden="true">
                  <span className="block h-full rounded-full bg-info transition-[width] duration-300 ease-out" style={{ width: `${(shown / Math.max(rows.length, 1)) * 100}%` }} />
                </span>
              </div>
              <div className="flex justify-end">
                <button type="button" onClick={(e) => { e.stopPropagation(); doneRef.current?.(); }}
                  className="rounded-md bg-band px-3 text-xs leading-6 text-ink transition-colors hover:bg-rule">Skip</button>
              </div>
            </div>
            <StatementNotes arriving onFocusRow={onFocusRow} onFocusFigure={onFocusFigure} empty={finished ? 'Nothing new on this statement.' : 'Nothing to note yet.'}
              notes={notesSoFar(notes, { summaryRead: intro === null, landed: new Set(rows.slice(0, shown).map((r) => r.id)), ended: finished })} />
          </div>
        )}
      </div>
      {style === 'paper' && !pageBeside ? (
        <div className="grid grid-cols-1 gap-4">
          <Sheet rows={rows} at={at} phase={phase} lineRefs={lineRefs} sheetRef={sheetRef} label={label} />
          {table}
        </div>
      ) : table}
    </div>
  );
}
