import { glideTo } from '../../lib/imports/glide';
import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { api } from '../../api';
import { usePrivacy } from '../../hooks/use-privacy';

/**
 * The statement itself, beside its rows (D335): the stored PDF's pages,
 * rendered on this machine, with the line a row came from lit. While the
 * statement is read in (`progress`), the light follows the line being read
 * and every line already read gets a tick, so it's plain that nothing on the
 * page was passed over; afterwards it follows the row being looked at
 * (`focusId`, from a hover or an open panel). Either way the pane scrolls the
 * line into the middle of view: at once while reading, and for a hover only
 * once the pointer rests on a row, so moving across the table doesn't throw
 * the pages about. It's the left column of the statement's one card, so it
 * has no frame of its own.
 *
 * Each located line also carries `data-row-line`, which the paper-to-ledger
 * style lifts its copy off. Privacy mode blurs the pages: they print real
 * names and amounts.
 */

export function StatementPages({ batchId, layout, focusId, progress, focusFigure = null }) {
  const { privacyMode } = usePrivacy();
  const reduceMotion = useReducedMotion();
  const scroller = useRef(null);
  const [loaded, setLoaded] = useState(() => new Set());
  const lit = progress ? progress.current : focusId;
  // A figure of the strip, hovered or being read (D360): its printed line lights, as a row's does.
  const litFigure = progress?.figure ?? (progress ? null : focusFigure);
  // The page in view, for the header's "Page 2 of 4".
  const [page, setPage] = useState(1);

  const reading = Boolean(progress);
  useEffect(() => {
    if (litFigure == null) return undefined;
    const t = setTimeout(() => {
      const el = scroller.current?.querySelector(`[data-figure-line="${litFigure}"]`);
      if (el && scroller.current) glideTo(scroller.current, el, { reduceMotion });
    }, reading ? 0 : 280);
    return () => clearTimeout(t);
  }, [litFigure, reading, reduceMotion, loaded]);

  useEffect(() => {
    if (lit == null) return undefined;
    const t = setTimeout(() => {
      const el = scroller.current?.querySelector(`[data-row-line="${lit}"]`);
      const box = scroller.current;
      if (!el || !box) return;
      glideTo(box, el, { reduceMotion });
    }, reading ? 0 : 280);
    return () => clearTimeout(t);
  }, [lit, reading, reduceMotion, loaded]);

  // The summary is read first (D360): the pages start at the top of page 1, where it's printed.
  const summary = progress?.summary === true;
  useEffect(() => {
    if (!summary) return;
    scroller.current?.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  }, [summary, reduceMotion]);

  const onScroll = () => {
    const box = scroller.current;
    if (!box) return;
    const mid = box.scrollTop + box.clientHeight / 3;
    const sheets = [...box.querySelectorAll('[data-page]')];
    const current = sheets.findLast((s) => s.offsetTop <= mid) ?? sheets[0];
    if (current) setPage(Number(current.dataset.page));
  };

  return (
    <section aria-label="The statement's pages" className="relative h-full min-h-0">
      {/* Which page is in view, floating over the top of the column. */}
      <span className="pointer-events-none absolute top-3 right-4 z-10 rounded-full bg-ink/70 px-2.5 py-0.5 text-[11.5px] font-medium text-paper tnum backdrop-blur-sm">
        Page {page} of {layout.pages.length}
      </span>
      <div ref={scroller} onScroll={onScroll} className="relative h-full space-y-4 overflow-y-auto px-5 py-5">
        {layout.pages.map((p) => (
          <div key={p.n} data-page={p.n} className="relative overflow-hidden rounded-md bg-white shadow-[0_1px_2px_rgb(0_0_0/0.1),0_8px_24px_-14px_rgb(0_0_0/0.45)]"
            style={{ aspectRatio: `${p.width} / ${p.height}` }}>
            <img src={api.imports.pageImage(batchId, p.n, layout.version)} alt={`Page ${p.n}`} loading={p.n <= 2 ? 'eager' : 'lazy'} draggable={false}
              onLoad={() => setLoaded((s) => new Set(s).add(p.n))}
              className={`absolute inset-0 size-full select-none transition-[filter] duration-300 ${privacyMode ? 'blur-md' : ''} ${loaded.has(p.n) ? '' : 'opacity-0'}`} />
            {!loaded.has(p.n) && <span className="absolute inset-0 animate-pulse bg-neutral-100" aria-hidden="true" />}
            {Object.entries(layout.figures ?? {}).filter(([, b]) => b.page === p.n).map(([key, b]) => (
              <span key={`figure-${key}`} data-figure-line={key} aria-hidden="true"
                className={`pointer-events-none absolute rounded-[3px] transition-[background-color,box-shadow] duration-300 ${litFigure === key ? 'statement-line-lit' : ''}`}
                style={{ top: `calc(${b.top * 100}% - 3px)`, height: `calc(${(b.bottom - b.top) * 100}% + 6px)`, left: `calc(${b.left * 100}% - 6px)`, right: `calc(${(1 - b.right) * 100}% - 6px)` }} />
            ))}
            {Object.entries(layout.rows).filter(([, b]) => b.page === p.n).map(([id, b]) => {
              const isLit = String(lit) === id;
              const done = progress?.done.has(Number(id));
              return (
                <span key={id} data-row-line={id} aria-hidden="true"
                  className={`pointer-events-none absolute rounded-[3px] transition-[background-color,box-shadow] duration-300 ${
                    isLit ? 'statement-line-lit' : ''}`}
                  style={{
                    top: `calc(${b.top * 100}% - 3px)`,
                    height: `calc(${(b.bottom - b.top) * 100}% + 6px)`,
                    left: `calc(${b.left * 100}% - 6px)`,
                    right: `calc(${(1 - b.right) * 100}% - 6px)`,
                  }}>
                  {done && !isLit && <span className="statement-line-tick">✓</span>}
                </span>
              );
            })}
          </div>
        ))}
        {privacyMode && (
          <p className="sticky bottom-0 rounded-lg bg-raised/95 px-3 py-2 text-center text-[13px] text-muted shadow-sm">
            The pages are blurred while Privacy is on: they print real names and amounts.
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * The left column for a statement whose real pages can't be shown (D335): a
 * PDF with a password no remembered one opens (D336), or a CSV. It's the same card, the same two columns: the page is drawn from the
 * lines the statement printed, which the reading follows the same way, with
 * the scan line on the line being read, ticks on the lines read and the
 * hovered row's line lit.
 */
export function StatementSheet({ rows, focusId, progress, title, reason }) {
  const reduceMotion = useReducedMotion();
  const scroller = useRef(null);
  const lit = progress ? progress.current : focusId;
  const reading = Boolean(progress);

  useEffect(() => {
    if (lit == null) return undefined;
    const t = setTimeout(() => {
      const el = scroller.current?.querySelector(`[data-row-line="${lit}"]`);
      const box = scroller.current;
      if (!el || !box) return;
      glideTo(box, el, { reduceMotion });
    }, reading ? 0 : 280);
    return () => clearTimeout(t);
  }, [lit, reading, reduceMotion]);

  return (
    <section aria-label="The statement's lines" className="relative h-full min-h-0">
      <span className="pointer-events-none absolute top-3 right-4 z-10 rounded-full bg-ink/70 px-2.5 py-0.5 text-[11.5px] font-medium text-paper backdrop-blur-sm">
        {reason === 'csv' ? 'The file, as its lines' : reason === 'sample' ? 'A made-up statement' : 'Drawn from its lines'}
      </span>
      <div ref={scroller} className="h-full overflow-y-auto px-5 py-5">
        <div className="relative rounded-md bg-white px-6 py-6 font-mono text-[11px] leading-[1.7] text-neutral-800 shadow-[0_1px_2px_rgb(0_0_0/0.1),0_8px_24px_-14px_rgb(0_0_0/0.45)]">
          <div className="mb-3 flex items-baseline justify-between gap-3 font-sans">
            <span className="truncate text-[12.5px] font-semibold text-neutral-900">{title}</span>
            <span className="shrink-0 text-[11px] text-neutral-500">Transactions</span>
          </div>
          <div className="mb-4 space-y-1.5" aria-hidden="true">
            <div className="h-1.5 w-2/3 rounded-full bg-neutral-200" />
            <div className="h-1.5 w-2/5 rounded-full bg-neutral-200" />
          </div>
          {(rows ?? []).map((row) => {
            const isLit = lit === row.id;
            const done = progress?.done.has(row.id);
            return (
              <div key={row.id} data-row-line={row.id}
                className={`relative rounded-[3px] py-px pr-1 pl-5 whitespace-pre-wrap break-words transition-colors duration-300 ${isLit ? 'statement-line-lit' : ''} ${done && !isLit ? 'text-neutral-400' : ''}`}>
                {done && !isLit && <span className="absolute left-1 font-sans text-[#2F6B4F]">✓</span>}
                {(row.raw_text ?? row.description ?? '').replace(/\s{2,}/g, '  ')}
              </div>
            );
          })}
          <div className="mt-4 space-y-1.5" aria-hidden="true">
            <div className="h-1.5 w-3/5 rounded-full bg-neutral-200" />
            <div className="h-1.5 w-4/5 rounded-full bg-neutral-200" />
          </div>
        </div>
        {reason === 'locked' && (
          <p className="mt-3 text-center text-[12.5px] text-muted">This PDF has a password none of the remembered ones open. Add it in Settings → Privacy and its own pages show here.</p>
        )}
      </div>
    </section>
  );
}
