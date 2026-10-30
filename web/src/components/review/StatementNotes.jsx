import { useEffect, useRef, useState } from 'react';

/**
 * What the statement shows that's worth knowing (D360), beside the reading's
 * progress and, once it's read, beside the limit line. One line tall and one
 * note at a time (the owner's ask): each holds a few seconds, then the next
 * takes its place, round again. While the statement is read, a note that
 * arrives shows at once. Hovering holds the one shown and lights the line it
 * came from on the page, as hovering a row does; a click (or Enter) steps to
 * the next. It's always there, saying so when the statement has nothing new.
 * Each leads with an emoji (the owner's ask, in every design: an exception to
 * Classic's no-emoji rule like the reading's own motion, D171); a note
 * without one falls back to a dot in its tone.
 */
const DOT = { warn: 'bg-warn', earn: 'bg-earn', info: 'bg-faint' };
const HOLD_MS = 4500;

// One line tall: the box beside it is the same.
export const NOTES_BOX = 'h-[2.625rem] rounded-xl border border-rule px-3.5';

export function StatementNotes({ notes, onFocusRow, onFocusFigure, arriving = false, empty = 'Nothing new on this statement.' }) {
  const [at, setAt] = useState(0);
  const [held, setHeld] = useState(false);
  const count = useRef(notes.length);
  // A note just read shows at once.
  useEffect(() => {
    if (arriving && notes.length > count.current) setAt(notes.length - 1);
    count.current = notes.length;
  }, [notes.length, arriving]);
  // Then the next, every few seconds, unless the pointer is holding one.
  useEffect(() => {
    if (held || notes.length < 2) return undefined;
    const t = setTimeout(() => setAt((i) => (i + 1) % notes.length), HOLD_MS);
    return () => clearTimeout(t);
  }, [at, held, notes.length]);

  const shown = Math.min(at, notes.length - 1);
  const n = notes[shown];
  const enter = () => {
    setHeld(true);
    if (n?.target?.figure) onFocusFigure?.(n.target.figure);
    if (n?.target?.row != null) onFocusRow?.(n.target.row);
  };
  const leave = () => { setHeld(false); onFocusFigure?.(null); };
  // The whole box is the button to the next note; a click on it never reaches the reading (which skips on a click).
  const next = (e) => { e.stopPropagation(); if (notes.length > 1) setAt((i) => (i + 1) % notes.length); };
  return (
    <button type="button" aria-label={notes.length > 1 ? `What this statement shows, ${shown + 1} of ${notes.length}: next note` : 'What this statement shows'}
      aria-live="polite" onClick={next} onMouseEnter={enter} onMouseLeave={leave}
      className={`${NOTES_BOX} flex w-full min-w-0 items-center gap-2 text-left text-[13px] text-ink transition-colors ${notes.length > 1 || n?.target ? 'hover:bg-band/60' : ''} ${notes.length > 1 ? 'cursor-pointer' : 'cursor-default'}`}>
      {!n ? <span className="text-faint">{empty}</span> : (
        // Keyed by the note, so each one slides in as it takes the place of the last.
        <span key={n.key} data-note={n.key} className="flex min-w-0 flex-1 items-center gap-2">
          {/* reveal-arrive makes its element inline-block, so it goes on the pieces, never the flex row. */}
          {n.emoji
            ? <span aria-hidden="true" className="reveal-arrive shrink-0 text-[14px] leading-none">{n.emoji}</span>
            : <span aria-hidden="true" className={`reveal-arrive size-1.5 shrink-0 rounded-full ${DOT[n.tone] ?? DOT.info}`} />}
          <span className="reveal-arrive min-w-0 truncate" title={n.text}>{n.text}</span>
        </span>
      )}
      {notes.length > 1 && <span aria-hidden="true" className="shrink-0 text-[12px] text-faint tnum">{shown + 1}/{notes.length}</span>}
    </button>
  );
}
