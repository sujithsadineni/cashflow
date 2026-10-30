import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { stageBoxes } from '../../lib/imports/reading-stages';
import { PACE, leadingNumber } from '../../lib/imports/choreography';

/**
 * A statement being read, in six boxes (D325): a rail across the drop zone
 * on a desktop, no taller than the drop zone itself; a checklist on a
 * phone. One markup for both.
 *
 * Each box gets its own moment: about a second working, with its own icon
 * moving (the arrow rises, the magnifier sweeps the card, a line scans the
 * page…), then its tick, then the line draws to the next. The read itself
 * takes a second or two, so this is a replay of what each step really found
 * (the API's facts), never ahead of them: before the answer is in, the
 * replay waits on the box the read is at. A click skips to the end.
 *
 * It answers the owner's own upload, so it plays in every design (D171's
 * exception); under Reduce Motion the boxes show their result at once.
 */

// Every beat comes from lib/imports/choreography (PACE), tuned in one place.

const RESOLVED = new Set(['done', 'warn', 'ask', 'skip', 'stop']);

const TILE = {
  waiting: 'bg-band text-faint',
  active: 'bg-info/12 text-info',
  done: 'bg-info/12 text-info',
  warn: 'bg-warn/15 text-warn',
  ask: 'bg-warn/15 text-warn',
  stop: 'bg-spend/12 text-spend',
  skip: 'bg-band text-faint',
  off: 'bg-band text-faint',
};

// The box around each stage, on a desktop only: on a phone it's a plain checklist row.
const BOX = {
  waiting: 'md:border-rule',
  active: 'md:border-info/40 md:bg-info/5',
  done: 'md:border-rule',
  warn: 'md:border-warn/40 md:bg-warn/5',
  ask: 'md:border-warn/40 md:bg-warn/5',
  stop: 'md:border-spend/40 md:bg-spend/5',
  skip: 'md:border-rule',
  off: 'md:border-rule',
};

const loop = (duration, delay = 0) => ({ duration, delay, repeat: Infinity, ease: 'easeInOut' });

/** Each step's own picture; `working` sets it moving. */
function StepArt({ step, working }) {
  switch (step) {
    case 'upload': // an arrow rising out of the tray
      return (
        <>
          <path d="M4 12.5v3h12v-3" />
          <motion.g animate={working ? { y: [2, -2, 2] } : { y: 0 }} transition={working ? loop(1.1) : { duration: 0.2 }}>
            <path d="M10 12V4.5M6.8 7.6 10 4.5l3.2 3.1" />
          </motion.g>
        </>
      );
    case 'open': // the page's corner folding open
      return (
        <>
          <path d="M5.5 2.5h6l3 3v12h-9z" />
          <motion.path d="M11.5 2.5v3h3" animate={working ? { pathLength: [0, 1, 1], opacity: [0.3, 1, 1] } : { pathLength: 1, opacity: 1 }} transition={working ? loop(1.2) : { duration: 0.2 }} />
          <motion.path d="M8 10h4M8 13h4" animate={working ? { opacity: [0.2, 1, 0.2] } : { opacity: 1 }} transition={working ? loop(1.2, 0.3) : { duration: 0.2 }} />
        </>
      );
    case 'find': // a magnifier sweeping across the card
      return (
        <>
          <rect x="2" y="5" width="12" height="8.5" rx="1.6" />
          <path d="M2 8h12" />
          <motion.g animate={working ? { x: [-5, 0, -5] } : { x: 0 }} transition={working ? loop(1.4) : { duration: 0.2 }}>
            <circle cx="14" cy="12.5" r="2.8" />
            <path d="m16.1 14.6 2 2" />
          </motion.g>
        </>
      );
    case 'read': // a line scanning down the page
      return (
        <>
          <path d="M5 5.5h10M5 9h10M5 12.5h10M5 16h6" />
          <motion.rect x="3" width="14" height="1.6" rx="0.8" fill="currentColor" stroke="none" opacity="0.45"
            animate={working ? { y: [3.5, 15.5, 3.5] } : { y: 3.5, opacity: 0 }} transition={working ? loop(1.3) : { duration: 0.2 }} />
        </>
      );
    case 'sort': // bars shuffling into order
      return (
        <>
          {[['M4 6h12', 0], ['M4 10h8', 0.15], ['M4 14h5', 0.3]].map(([d, delay]) => (
            <motion.path key={d} d={d} animate={working ? { x: [0, 3, 0] } : { x: 0 }} transition={working ? loop(1, delay) : { duration: 0.2 }} />
          ))}
        </>
      );
    default: // check: the sum drawing in
      return (
        <motion.path d="M14.5 4.5h-9l4.8 5.5-4.8 5.5h9"
          animate={working ? { pathLength: [0, 1, 1] } : { pathLength: 1 }} transition={working ? loop(1.3) : { duration: 0.2 }} />
      );
  }
}

/** The box's tile: its picture while waiting or working, then a tick (or ! / ×) that lands with a small pop. */
function StepIcon({ step, state, still }) {
  const working = state === 'active' && !still;
  const resolved = RESOLVED.has(state);
  return (
    <motion.span
      key={resolved ? state : 'art'}
      initial={still || !resolved ? false : { scale: 0.7 }}
      animate={{ scale: 1 }}
      transition={{ type: 'spring', stiffness: 460, damping: 18 }}
      className={`relative z-10 flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-300 ${TILE[state]}`}
    >
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {state === 'done' ? <motion.path d="m5 10.5 3.2 3.2L15 6.8" strokeWidth="2.2" initial={still ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.35, ease: 'easeOut' }} />
          : state === 'warn' ? <path d="M10 5v6.5M10 15v.01" strokeWidth="2.2" />
            : state === 'ask' ? <path d="M7.6 7.4a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .8-1 1.5v.6M10 15v.01" strokeWidth="2.1" />
            : state === 'stop' ? <path d="M6 6l8 8M14 6l-8 8" strokeWidth="2.2" />
              : state === 'skip' ? <path d="M6 10h8" strokeWidth="2.2" />
                : <StepArt step={step} working={working} />}
      </svg>
    </motion.span>
  );
}

/** A note whose leading number counts up as it appears ("48 rows"), over about half a second. */
function Note({ text, still }) {
  const lead = leadingNumber(text);
  const [n, setN] = useState(still || !lead ? lead?.n : 0);
  useEffect(() => {
    if (still || !lead) return undefined;
    const t0 = performance.now();
    let frame;
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / 550);
      setN(Math.round(lead.n * (1 - (1 - k) ** 3)));
      if (k < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [still, lead?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  return lead ? <>{n}{lead.rest}</> : text;
}

const GLOW = { done: 'ring-info/70', ask: 'ring-warn/70', warn: 'ring-warn/70' };

/** reading: what Import knows so far (see lib/imports/reading-stages). */
export function ReadingStages({ reading, accountName, label, still, onSettled, onClose, fix, stopRef, onStopClick, onAsk, onProgress }) {
  const { boxes } = stageBoxes(reading, { accountName, label });
  const settled = Boolean(reading.facts || reading.error);
  const stopAt = boxes.findIndex((b) => b.state === 'stop');
  // How far the replay may go: all of it once the answer is in; before that,
  // only the boxes already known for real (Upload, a CSV's skipped Open).
  const firstOpen = boxes.findIndex((b) => !RESOLVED.has(b.state));
  const reach = settled ? (stopAt === -1 ? boxes.length : stopAt + 1) : (firstOpen === -1 ? boxes.length : firstOpen);
  // A card read off the statement is asked about on its own box (D325): the boxes pause there
  // until the owner answers, and only then play on.
  const askAt = boxes.findIndex((b) => b.state === 'ask');
  const asked = settled && askAt !== -1 && Boolean(onAsk) && !reading.answered;
  // Held on a box while the page acts on its answer (`holdAt`): a confirmed card is shown in the
  // deck before the boxes go on to Read rows (D325).
  const held = settled && reading.holdAt != null;
  const waiting = asked || held;
  const known = asked ? Math.min(reach, askAt + 1) : held ? Math.min(reach, reading.holdAt + 1) : reach;

  const [played, setPlayed] = useState(0);
  const [resting, setResting] = useState(false); // a box's tick, before the next one starts
  // Under Reduce Motion the answer shows at once: worked out here, not set by an effect.
  const shown = still ? known : played;
  const nextSkips = boxes[shown]?.state === 'skip';

  useEffect(() => {
    if (still) return undefined;
    if (resting) {
      // Its tick lands, then the line draws to the next box.
      const t = setTimeout(() => setResting(false), PACE.tick + PACE.link);
      return () => clearTimeout(t);
    }
    if (played < known) {
      const t = setTimeout(() => { setPlayed((p) => p + 1); setResting(true); }, nextSkips ? PACE.step / 3 : PACE.step);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [still, resting, played, known, nextSkips]);

  // Import re-renders while this plays (the list reloads); the latest callback, without restarting the timers.
  const settledRef = useRef(onSettled);
  useEffect(() => { settledRef.current = onSettled; });
  const finished = settled && !waiting && shown >= known && (still || !resting);
  // The boxes have reached the question: ask it, once.
  const asking = asked && shown >= known && (still || !resting);
  const askRef = useRef(onAsk);
  useEffect(() => { askRef.current = onAsk; });
  useEffect(() => { if (asking) askRef.current?.(); }, [asking]);
  const failed = Boolean(reading.error);
  useEffect(() => {
    if (!finished) return undefined;
    const t = setTimeout(() => settledRef.current?.(), still ? 200 : failed ? PACE.stopHold : PACE.hold);
    return () => clearTimeout(t);
  }, [finished, still, failed]);

  // How many boxes are done, for whoever follows along (the month filling as the read goes on).
  const progressRef = useRef(onProgress);
  useEffect(() => { progressRef.current = onProgress; });
  useEffect(() => { progressRef.current?.(shown); }, [shown]);

  const skippable = !still && shown < known;
  const skip = () => { if (skippable) { setPlayed(known); setResting(false); } };

  // What's on screen: what the replay has reached, the box it's on working, the rest waiting.
  const view = boxes.map((b, i) => {
    if (i < shown) return b;
    // The Upload box names the file from the start.
    const idle = { ...b, note: i === 0 ? reading.fileName : null, title: i === 0 ? b.title : null };
    if (i === shown && !finished && !resting && !waiting) return { ...idle, state: 'active' };
    if (finished && b.state === 'off') return b;
    return { ...idle, state: 'waiting' };
  });
  // A stop that waits for the owner (not one that closes by itself) can be put away.
  const stopped = finished && failed && !reading.error.existing;

  return (
    <div role="status" aria-live="polite">
    <div onClick={skip} title={skippable ? 'Click to skip' : undefined}
      className={`flex items-center gap-3 ${skippable ? 'cursor-pointer' : ''}`}>
      <ol className="grid min-w-0 flex-1 grid-cols-1 gap-2 md:grid-cols-6 md:gap-3">
        {view.map((b, i) => {
          const reached = i > 0 && RESOLVED.has(view[i - 1].state);
          return (
            <li key={b.key}
              // The stopped box anchors its fix's popup (a locked PDF's password); clicking it opens that again.
              ref={b.state === 'stop' || (waiting && i === askAt) ? stopRef : undefined}
              onClick={b.state === 'stop' && stopped && onStopClick ? (e) => { e.stopPropagation(); onStopClick(); }
                : asking && i === askAt ? (e) => { e.stopPropagation(); onAsk(); } : undefined}
              className={`relative flex min-w-0 items-center gap-2.5 transition-colors duration-300 md:rounded-xl md:border md:px-2.5 md:py-2 ${BOX[b.state]} ${b.state === 'off' ? 'opacity-45' : ''} ${(b.state === 'stop' && stopped && onStopClick) || (asking && i === askAt) ? 'cursor-pointer' : ''}`}>
              {/* The line from the box before: across on a desktop, down the checklist on a phone. */}
              {i > 0 && (
                <>
                  <span aria-hidden="true" className="absolute -top-2 left-[15px] h-2 w-0.5 bg-rule md:hidden">
                    <motion.span className="block h-full w-full origin-top bg-info" initial={false} animate={{ scaleY: reached ? 1 : 0 }} transition={still ? { duration: 0 } : { duration: PACE.link / 1000, delay: reached ? PACE.tick / 1000 : 0, ease: 'easeInOut' }} />
                  </span>
                  <span aria-hidden="true" className="absolute -left-3 top-1/2 hidden h-0.5 w-3 bg-rule md:block">
                    <motion.span className="block h-full w-full origin-left bg-info" initial={false} animate={{ scaleX: reached ? 1 : 0 }} transition={still ? { duration: 0 } : { duration: PACE.link / 1000, delay: reached ? PACE.tick / 1000 : 0, ease: 'easeInOut' }} />
                  </span>
                </>
              )}
              {/* A soft glow round the box as it finishes, once. */}
              {!still && GLOW[b.state] && (
                <motion.span key={b.state} aria-hidden="true" className={`pointer-events-none absolute inset-0 hidden rounded-xl ring-2 md:block ${GLOW[b.state]}`}
                  initial={{ opacity: 1 }} animate={{ opacity: 0 }} transition={{ duration: 0.9, ease: 'easeOut' }} />
              )}
              <StepIcon step={b.key} state={b.state} still={still} />
              <div className="min-w-0 flex-1">
                <p className={`truncate text-[13px] font-medium ${b.state === 'waiting' || b.state === 'off' ? 'text-muted' : 'text-ink'}`}>{b.label}</p>
                <motion.p key={b.note ?? b.state}
                  initial={still || !b.note ? false : { opacity: 0, y: 2 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}
                  title={b.title ?? b.note ?? undefined}
                  className={`truncate text-[12px] tnum ${b.state === 'warn' || b.state === 'ask' ? 'text-warn' : b.state === 'stop' ? 'text-spend' : 'text-muted'}`}>
                  {b.note ? <Note text={b.note} still={still || i === 0} /> : (b.state === 'active' ? 'Working…' : ' ')}
                </motion.p>
              </div>
              {b.state === 'active' && !still && (
                <span aria-hidden="true" className="pointer-events-none absolute inset-0 hidden overflow-hidden rounded-xl md:block">
                  <motion.span className="absolute bottom-0 left-0 h-0.5 w-1/3 bg-info/60"
                    initial={{ x: '-100%' }} animate={{ x: '300%' }} transition={{ duration: 1.1, repeat: Infinity, ease: [0.65, 0, 0.35, 1] }} />
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {stopped && onClose && (
        <button type="button" onClick={(e) => { e.stopPropagation(); onClose(); }} aria-label="Choose another file" title="Choose another file"
          className="flex size-8 shrink-0 items-center justify-center self-start rounded-full bg-band text-muted transition-colors hover:text-ink md:self-center">
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2 2 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        </button>
      )}
    </div>
      {/* Where it stopped, what to do about it (step 3): the password, Try again, Read with Claude. */}
      {stopped && fix && (
        <motion.div initial={still ? false : { opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>{fix}</motion.div>
      )}
    </div>
  );
}
