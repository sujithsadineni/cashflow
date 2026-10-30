import { useId } from 'react';
import { motion } from 'motion/react';
import { Dropdown } from './Dropdown';
import { useDesign } from '../../hooks/use-design';
import { PAGE_SIZES, pageCount, pageItems } from '../../lib/app/pagination';

/**
 * A table's pages (D397, the owner's pick of three): Glass draws Apple's pill
 * (‹ 1 2 3 4 5 … 30 › and "25 / page" in a round pill), Vivid a panel with
 * the words Previous and Next, the page in an outlined square and Next in its
 * purple. The current page's highlight glides to the new one on a spring,
 * critically damped in Glass (no bounce), a little give in Vivid; under Reduce
 * Motion it simply moves (MotionConfig in App). On a phone the numbers give way
 * to "3 of 30" so the pager never spills sideways. Classic keeps its own
 * Newer/Older; this renders nothing there.
 *
 *   <Pager page={0} total={4851} pageSize={25} onPage={setPage} onPageSize={setPageSize} />
 *
 * `page` counts from 0, as the tables keep it.
 */
const SPRING = { glass: { type: 'spring', bounce: 0, duration: 0.3 }, vivid: { type: 'spring', bounce: 0.25, duration: 0.35 } };

function Chevron({ left }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d={left ? 'M10 3.5 5.5 8l4.5 4.5' : 'M6 3.5 10.5 8 6 12.5'} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Pager({ page, total, pageSize, onPage, onPageSize, sizes = PAGE_SIZES }) {
  const { design } = useDesign();
  const highlight = useId();
  if (design !== 'glass' && design !== 'vivid') return null;
  const glass = design === 'glass';
  const count = pageCount(total, pageSize);
  const current = Math.min(page + 1, count);
  const go = (n) => { if (n >= 1 && n <= count && n !== current) onPage(n - 1); };
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min((page + 1) * pageSize, total);

  const press = 'transition-transform duration-100 active:scale-95 disabled:active:scale-100';
  const number = glass
    ? 'relative inline-flex size-9 items-center justify-center rounded-full text-[15px] tnum'
    : 'relative inline-flex h-9 min-w-9 items-center justify-center rounded-lg px-2 text-[15px] tnum';
  const mark = glass ? 'absolute inset-0 rounded-full bg-info/12 ring-1 ring-info/45' : 'absolute inset-0 rounded-lg ring-1 ring-vivid-purple';

  return (
    <div className="flex flex-col items-center gap-2">
      <nav
        aria-label="Pages"
        className={`apple-pane inline-flex max-w-full items-center gap-1 bg-raised shadow-[0_1px_2px_rgb(0_0_0/0.04),0_10px_28px_-14px_rgb(0_0_0/0.22)] ${
          glass ? 'rounded-full py-1.5 pr-1.5 pl-2' : 'rounded-2xl border border-rule px-3 py-2'}`}
      >
        {glass ? (
          <button type="button" aria-label="Previous page" disabled={current === 1} onClick={() => go(current - 1)}
            className={`inline-flex size-9 items-center justify-center rounded-full text-ink hover:bg-[var(--g-hover)] disabled:text-faint disabled:hover:bg-transparent ${press}`}>
            <Chevron left />
          </button>
        ) : (
          <button type="button" disabled={current === 1} onClick={() => go(current - 1)}
            className={`rounded-lg px-2.5 py-1.5 text-[15px] text-ink hover:bg-[var(--g-hover)] disabled:text-faint disabled:hover:bg-transparent ${press}`}>
            Previous
          </button>
        )}

        {/* Wider than a phone: the numbers. */}
        <ul className="hidden items-center gap-0.5 sm:flex">
          {pageItems(current, count).map((n) => (typeof n === 'string' ? (
            <li key={n} aria-hidden="true" className="inline-flex size-9 items-center justify-center text-faint tracking-[0.15em]">•••</li>
          ) : (
            <li key={n}>
              <button type="button" aria-label={`Page ${n}`} aria-current={n === current ? 'page' : undefined} onClick={() => go(n)}
                className={`${number} ${press} ${n === current ? `font-semibold ${glass ? 'text-info' : 'text-ink'}` : 'text-ink hover:bg-[var(--g-hover)]'}`}>
                {n === current && <motion.span layoutId={highlight} transition={SPRING[design]} className={mark} aria-hidden="true" />}
                <span className="relative">{n}</span>
              </button>
            </li>
          )))}
        </ul>
        {/* A phone: where you are, in words. */}
        <span className="whitespace-nowrap px-2 text-[15px] text-ink tnum sm:hidden" aria-live="polite">{current} of {count}</span>

        {glass ? (
          <button type="button" aria-label="Next page" disabled={current === count} onClick={() => go(current + 1)}
            className={`inline-flex size-9 items-center justify-center rounded-full text-ink hover:bg-[var(--g-hover)] disabled:text-faint disabled:hover:bg-transparent ${press}`}>
            <Chevron />
          </button>
        ) : (
          <button type="button" disabled={current === count} onClick={() => go(current + 1)}
            className={`rounded-lg px-2.5 py-1.5 text-[15px] font-semibold text-vivid-purple hover:bg-[var(--g-hover)] disabled:font-normal disabled:text-faint disabled:hover:bg-transparent ${press}`}>
            Next
          </button>
        )}

        <span className={glass ? 'ml-2' : 'ml-3'}>
          <Dropdown
            pager={glass ? 'round' : 'square'}
            value={String(pageSize)}
            onChange={(v) => onPageSize(Number(v))}
            options={sizes.map((n) => ({ value: String(n), label: `${n} / page` }))}
            aria-label="Rows per page"
          />
        </span>
      </nav>
      <p className="text-[12px] text-muted tnum">{from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}</p>
    </div>
  );
}
