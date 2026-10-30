import { useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion } from 'motion/react';

/**
 * A small popup hung from the thing it's about (D325): a locked PDF's Open
 * box or lock, a guessed card's Find the card box. The page blurs; the
 * thing stays sharp in a hole cut in the blur (an even-odd clip-path),
 * ringed in the accent, with the popup's caret pointing at it. Esc, the
 * blur or the popup's own close button put it away, except while it's busy.
 *
 * The password (UnlockPopover) and the card question (ConfirmCardPopover)
 * are the same object with different insides.
 */

const WIDTH = 340;
const GAP = 12;

/** Where the hole, the ring and the popup go, from the anchor's place on screen. */
function useAnchor(anchorRef) {
  const [rect, setRect] = useState(null);
  useLayoutEffect(() => {
    const measure = () => {
      const r = anchorRef.current?.getBoundingClientRect();
      if (r) setRect({ left: r.left, top: r.top, width: r.width, height: r.height });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => { window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
  }, [anchorRef]);
  return rect;
}

export function AnchoredPopover({ anchorRef, label, busy = false, onClose, as = 'div', onSubmit, children }) {
  const still = useReducedMotion();
  const rect = useAnchor(anchorRef);

  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [busy, onClose]);

  if (!rect) return null;
  // The hole in the blur, a little bigger than the anchor, and the popup under it (or over it near the bottom).
  const pad = 6;
  const hole = { x: rect.left - pad, y: rect.top - pad, w: rect.width + pad * 2, h: rect.height + pad * 2 };
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(WIDTH, vw - 32);
  const left = Math.min(Math.max(16, rect.left + rect.width / 2 - width / 2), vw - 16 - width);
  const below = vh - (hole.y + hole.h) > 210;
  const caretX = Math.min(Math.max(18, rect.left + rect.width / 2 - left), width - 18);
  const clip = `path(evenodd, 'M0 0H${vw}V${vh}H0Z M${hole.x} ${hole.y}h${hole.w}v${hole.h}h-${hole.w}Z')`;
  const Panel = as === 'form' ? motion.form : motion.div;

  return createPortal(
    <>
      <motion.div aria-hidden="true" className="fixed inset-0 z-[60] bg-ink/25 backdrop-blur-[3px]" style={{ clipPath: clip }}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}
        onPointerDown={() => { if (!busy) onClose(); }} />
      {/* The anchor, sharp in its hole, ringed so the popup reads as its own. */}
      <span aria-hidden="true" className="pointer-events-none fixed z-[61] rounded-xl ring-2 ring-info"
        style={{ left: hole.x, top: hole.y, width: hole.w, height: hole.h }} />

      <Panel role="dialog" aria-label={label} onSubmit={onSubmit}
        initial={still ? false : { opacity: 0, y: below ? -6 : 6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 420, damping: 30 }}
        className="apple-pane fixed z-[62] rounded-2xl border border-rule bg-raised p-3 shadow-[0_16px_40px_-16px_rgb(0_0_0/0.45)]"
        style={{ left, width, ...(below ? { top: hole.y + hole.h + GAP } : { bottom: vh - hole.y + GAP }) }}>
        {/* The caret, pointing at the anchor. */}
        <span aria-hidden="true" className={`absolute size-3 rotate-45 border-rule bg-raised ${below ? '-top-1.5 border-l border-t' : '-bottom-1.5 border-b border-r'}`}
          style={{ left: caretX - 6 }} />
        {children}
      </Panel>
    </>,
    document.body,
  );
}

/** The popup's top line: the tile, a title and a detail, and its ×. */
export function PopoverHeader({ tile, tone, title, detail, busy, onClose }) {
  return (
    <div className="mb-2.5 flex items-center gap-2.5">
      <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors ${tone}`}>{tile}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-medium text-ink">{title}</p>
        <p className="truncate text-[12px] text-muted" title={detail}>{detail}</p>
      </div>
      <button type="button" onClick={onClose} disabled={busy} aria-label="Close"
        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-band text-muted transition-colors hover:text-ink">
        <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2 2 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
      </button>
    </div>
  );
}
