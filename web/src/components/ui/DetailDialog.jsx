import { useEffect, useId, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useDesign } from '../../design-context';
import { Segmented } from '../Form';

/**
 * The one drill-down dialog shell (D149). Ten components each hand-wrote
 * the same overlay + panel + ✕; the popups behind Overview's cards now
 * share this, and so does their layout:
 *
 *   title / emoji / tint   header (the emoji tile and tinted band are Vivid-only)
 *   hero                   { label, value, tone: 'spend'|'earn'|'ink' } — this month
 *   side                   { label, value, trend } — the year so far, beside it
 *   sections               [{ key, label, tab?, count?, content }] — `tab` is a
 *                          shorter name for the tab bar (label stays the heading
 *                          in Classic's stacked view). Vivid shows ONE at
 *                          a time behind tabs, which is what keeps a dialog from
 *                          turning into a wall as months of data pile up; Classic
 *                          stacks them as it always did
 *   note                   the small explanation at the bottom
 *   actions                extra header buttons, left of ✕ (Zelle's Contacts)
 *
 * Esc closes it, and it's a real dialog to a screen reader.
 */
const TONE = { spend: 'text-spend', earn: 'text-earn', ink: 'text-ink' };

export function DetailDialog({ title, emoji, tint = 'bg-band', hero, side, sections = [], note, onClose, width = 'max-w-lg', actions }) {
  const { design } = useDesign();
  const vivid = design === 'vivid';
  const titleId = useId();
  const visible = sections.filter(Boolean);
  const [active, setActive] = useState(visible[0]?.key);
  const current = visible.find((s) => s.key === active) ?? visible[0];

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const heading = (
    <div className="flex items-start justify-between gap-3">
      <h3 id={titleId} className={`flex items-center gap-2.5 font-medium text-ink ${vivid ? 'text-lg' : 'text-base'}`}>
        {vivid && emoji && (
          <span className="flex size-9 items-center justify-center rounded-xl bg-raised text-lg leading-none shadow-sm" aria-hidden="true">
            {emoji}
          </span>
        )}
        {title}
      </h3>
      <div className="flex shrink-0 items-center gap-3">
        {actions}
        <button onClick={onClose} aria-label="Close" className="text-muted transition-colors hover:text-ink">
          ✕
        </button>
      </div>
    </div>
  );

  const figures = (hero || side) && (
    <div className="mt-3 flex items-end justify-between gap-4">
      {hero && (
        <div>
          <div className="text-xs text-muted">{hero.label}</div>
          <div className={`font-mono font-semibold tnum ${vivid ? 'text-3xl' : 'text-2xl'} ${TONE[hero.tone ?? 'ink']}`}>{hero.value}</div>
        </div>
      )}
      {side && (
        <div className="text-right">
          <div className="text-xs text-muted">{side.label}</div>
          <div className="mt-0.5 flex items-center justify-end gap-2">
            {side.trend}
            <span className={`font-mono text-lg font-semibold tnum ${TONE[side.tone ?? 'ink']}`}>{side.value}</span>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-ink/30 p-4" onClick={onClose}>
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        initial={vivid ? { opacity: 0, scale: 0.96, y: 8 } : false}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        className={`flex max-h-[85vh] w-full flex-col overflow-hidden border border-rule bg-raised shadow-lg ${width} ${vivid ? 'rounded-2xl' : 'rounded-lg'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`shrink-0 ${vivid ? `${tint} px-5 pt-5 pb-4` : 'px-5 pt-5'}`}>
          {heading}
          {figures}
          {vivid && visible.length > 1 && (
            <div className="mt-4 overflow-x-auto [&_button]:whitespace-nowrap">
              <Segmented
                value={current.key}
                onChange={setActive}
                options={visible.map((s) => ({ value: s.key, label: s.count != null ? `${s.tab ?? s.label} · ${s.count}` : s.tab ?? s.label }))}
              />
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-4 pb-5">
          {vivid ? (
            <AnimatePresence mode="wait" initial={false}>
              {current && (
                <motion.div
                  key={current.key}
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.18 }}
                >
                  {visible.length === 1 && <SectionLabel>{current.label}</SectionLabel>}
                  {current.content}
                </motion.div>
              )}
            </AnimatePresence>
          ) : (
            visible.map((s, i) => (
              <div key={s.key} className={i > 0 ? 'mt-5' : ''}>
                <SectionLabel>{s.label}</SectionLabel>
                {s.content}
              </div>
            ))
          )}
          {note && <p className="mt-5 text-sm text-muted">{note}</p>}
        </div>
      </motion.div>
    </div>
  );
}

function SectionLabel({ children }) {
  return <div className="mb-2 text-xs font-medium uppercase tracking-wide text-faint">{children}</div>;
}

/**
 * The first `limit` items, then "Show all N" — so a list that grows with
 * every statement stays one screen tall until someone asks for the rest.
 * `as` lets a grid of cards use it as well as a plain list.
 */
export function ShowMore({ items, limit = 6, render, className = 'flex flex-col gap-2', as: Tag = 'div' }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, limit);
  return (
    <>
      <Tag className={className}>{shown.map(render)}</Tag>
      {items.length > limit && (
        <button
          onClick={() => setAll(!all)}
          className="mt-3 w-full rounded-lg border border-dashed border-rule-str py-2 text-sm text-muted transition-colors hover:bg-band hover:text-ink"
        >
          {all ? 'Show fewer' : `Show all ${items.length}`}
        </button>
      )}
    </>
  );
}

/**
 * A labeled amount with a bar against the largest in its list — the
 * row every "by month / by account / by category" breakdown needs.
 * `tone` colors the bar and figure by money direction.
 */
export function BarRow({ label, amount, max, formatted, tone = 'spend', sub }) {
  const pct = max > 0 ? (Math.abs(amount) / max) * 100 : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 truncate text-ink">{label}</span>
        <span className={`shrink-0 font-mono tnum ${TONE[tone]}`}>{formatted}</span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-band">
        <div className={`animate-bar-grow h-1.5 rounded-full ${tone === 'earn' ? 'bg-earn' : 'bg-spend'}`} style={{ width: `${Math.max(pct, amount ? 2 : 0)}%` }} />
      </div>
      {sub && <div className="mt-0.5 text-[11px] text-faint">{sub}</div>}
    </div>
  );
}
