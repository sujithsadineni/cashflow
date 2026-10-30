import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NotificationContext } from '../hooks/use-notify';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { setGlobalErrorNotifier } from '../api';
import { TOASTS, toastName } from '../lib/app/toast-names';
import { useToastNames } from '../hooks/use-toast-names';
import { useDesign } from '../hooks/use-design';
import { useToastLook } from '../hooks/use-toast-look';
import { ToastFace } from '../components/ui/ToastFace';
import { cardLook } from '../lib/app/toast-surface';

/**
 * Toasts — a fleeting "here's what just happened," not a persistent
 * inbox. Nothing here is stored: refresh the page and they're gone,
 * same as they would be if you'd simply looked away in time. A
 * notification CENTER (a bell icon, a read/unread list) is a
 * different, heavier feature this app hasn't asked for; this is
 * scoped to the transient-confirmation half of "notifications."
 *
 * Where and how (D383, the owner's pick; was top-right, D201/D287): at the
 * bottom, centred under the page's content. Every page keeps its own controls
 * along the top, the assistant and help buttons sit bottom-right and the status
 * icons bottom-left; the bottom centre was the one place nothing lived, and it's
 * where a phone's thumb already is for Undo.
 *   - It arrives as a small capsule holding its icon, which opens out to the
 *     whole toast (the Dynamic Island's motion), and folds back the same way to
 *     leave. Critically damped: nothing was thrown, so nothing bounces.
 *   - The time left is a ring around the icon. Hovering the toasts holds every
 *     timer, so one you're reading never leaves mid-sentence.
 *   - Several stack like a phone's notifications: the newest in front, two more
 *     peeking behind it, smaller. Hovering fans them out into a list.
 *   - Swipe one down to dismiss it: it follows the pointer, a flick throws it,
 *     a short drag springs back.
 *   - An error shakes once after it lands, the way a wrong password does on a
 *     Mac, so it reads differently from a success by motion as well as glyph.
 *   - Short (D287): a title of a few words, one line under it, a one-word
 *     action ("Cards", "Review", "Undo").
 *   - Reduce Motion: a fade in and out, no opening, shake or swipe.
 */


const DEFAULT_DURATION_MS = 5000;


export function NotificationProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  // Ids from a ref, not a module counter: a hot reload re-ran the module and restarted
  // the count while older toasts were still showing, so two shared a key (D388).
  const nextId = useRef(1);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer.handle);
      timers.current.delete(id);
    }
  }, []);

  const start = useCallback((id, ms) => {
    timers.current.set(id, { handle: setTimeout(() => dismiss(id), ms), started: Date.now(), remaining: ms });
  }, [dismiss]);

  /** Hovering a toast holds its timer; leaving resumes what was left. */
  const pause = useCallback((id) => {
    const t = timers.current.get(id);
    if (!t || t.paused) return;
    clearTimeout(t.handle);
    timers.current.set(id, { ...t, paused: true, remaining: Math.max(t.remaining - (Date.now() - t.started), 800) });
  }, []);
  const resume = useCallback((id) => {
    const t = timers.current.get(id);
    if (t?.paused) start(id, t.remaining);
  }, [start]);

  // A toast named by key (D384) shows the household's name for it, else its own;
  // read through a ref so notify itself never changes identity.
  const saved = useToastNames().saved;
  const { design } = useDesign();
  const names = useRef({ saved: null, design });
  useEffect(() => { names.current = { saved, design }; }, [saved, design]);

  const notify = useCallback((message, { name = null, type, duration = DEFAULT_DURATION_MS, title = null, action = null } = {}) => {
    const id = nextId.current++;
    if (import.meta.env.DEV && name && !TOASTS[name]) console.error(`notify: no toast named "${name}" in lib/app/toast-names.js`);
    const kind = type ?? TOASTS[name]?.type ?? 'info';
    // Named in this design's own words (D386): Classic plain, Glass Title Case, Vivid friendly.
    const heading = name ? toastName(name, names.current.saved, names.current.design) : title;
    const emoji = TOASTS[name]?.emoji ?? { success: '✅', error: '⚠️', info: '💬' }[kind];
    setToasts((current) => [...current, { id, message, type: kind, title: heading, emoji, action, duration }]);
    if (duration > 0) start(id, duration);
    return id;
  }, [start]);

  // api.js's request() can't call a hook itself (it's a plain
  // module) — this is the same bridge privacy-context.jsx uses for
  // setGlobalPrivacyMode, just for the error-toast direction instead.
  useEffect(() => {
    setGlobalErrorNotifier((message) => notify(message, { name: 'error.app' }));
    return () => setGlobalErrorNotifier(() => {});
  }, [notify]);

  // Development only (stripped from the build): lets the screenshot and E2E scripts raise a toast.
  useEffect(() => {
    if (!import.meta.env.DEV) return undefined;
    window.__notify = notify;
    return () => { delete window.__notify; };
  }, [notify]);

  return (
    <NotificationContext.Provider value={notify}>
      {children}
      <ToastStack toasts={toasts} onDismiss={dismiss} onPause={pause} onResume={resume} />
    </NotificationContext.Provider>
  );
}


const PILL = 52;                 // the capsule it opens from: as wide as the toast is tall
const MAX_WIDTH = 416;           // 26rem
const PEEK = 3;                  // toasts showing in a closed stack
const SETTLE = { type: 'spring', bounce: 0, duration: 0.42 };   // critically damped, Apple's "response" ≈ 0.4

/**
 * Where the toasts sit (D387): the fixed strip for each place. Below 1024px
 * the right-hand places use the centre (a phone has no room beside the
 * content), and the bottom ones sit above the assistant and help buttons. On a
 * laptop, bottom right sits above those buttons too; the top ones sit 16px down.
 */
const PLACES = {
  'bottom-center': { top: false, strip: 'inset-x-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] lg:left-52 lg:right-0 lg:bottom-[calc(1.25rem+env(safe-area-inset-bottom))]' },
  'top-center': { top: true, strip: 'inset-x-4 top-[calc(4.5rem+env(safe-area-inset-top))] lg:left-52 lg:right-0 lg:top-4' },
  'bottom-right': { top: false, strip: 'inset-x-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] lg:left-auto lg:right-5 lg:w-[26rem]' },
  'top-right': { top: true, strip: 'inset-x-4 top-[calc(4.5rem+env(safe-area-inset-top))] lg:left-auto lg:right-5 lg:top-4 lg:w-[26rem]' },
};

/**
 * How each look arrives, settles and leaves (D383, D387, four kept D388). `from` is +1 at the
 * bottom (it rises) and −1 at the top (it drops). A clip that opens the card
 * is lifted once it has (`transitionEnd`), so it doesn't cut off the card's
 * own shadow. Reduce Motion: a fade, for every look.
 */
function lookMotion(look, { width, from, reduce, thrown }) {
  if (reduce) return { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0, transition: { duration: 0.15 } }, transition: { duration: 0.15 } };
  const flung = { y: from * 140, opacity: 0, transition: { duration: 0.22, ease: 'easeIn' } };
  const whole = 'inset(0px 0px 0px 0px round 22px)';
  if (look === 'island') {
    // Two beats, like the Dynamic Island: a small black pill arrives, then springs
    // open with a little give. Leaving, it folds back into the pill, then the pill goes.
    const sx = Math.max((width - 126) / 2, 0);
    const pill = `inset(16% ${sx}px 16% ${sx}px round 20px)`, open = 'inset(0% 0px 0% 0px round 30px)';
    return {
      initial: { clipPath: pill, opacity: 0, y: from * 12, scale: 0.9 },
      animate: { clipPath: open, opacity: 1, y: 0, scale: 1, transitionEnd: { clipPath: 'none' } },
      exit: thrown ? flung : { clipPath: [open, pill, pill], opacity: [1, 1, 0], scale: [1, 1, 0.85], transition: { duration: 0.5, times: [0, 0.55, 1], ease: [0.4, 0, 0.2, 1] } },
      transition: {
        opacity: { duration: 0.16 }, y: { type: 'spring', bounce: 0.2, duration: 0.4 }, scale: { type: 'spring', bounce: 0.2, duration: 0.4 },
        clipPath: { type: 'spring', bounce: 0.28, duration: 0.6, delay: 0.14 },
      },
    };
  }
  if (look === 'candy') return {
    // Pops in with a bounce; leaves by shrinking away.
    initial: { opacity: 0, y: from * 28, scale: 0.6 }, animate: { opacity: 1, y: 0, scale: 1 },
    exit: thrown ? flung : { opacity: 0, y: from * 20, scale: 0.85, transition: { duration: 0.24, ease: 'easeIn' } },
    transition: { type: 'spring', bounce: 0.45, duration: 0.55 },
  };
  if (look === 'sticker') return {
    // Drops in tilted, rocks past level both ways and settles: a wobble, not a spring's overshoot. Leaves by peeling away.
    initial: { opacity: 0, y: from * 44, rotate: -from * 7, scale: 0.92 },
    animate: { opacity: [0, 1, 1, 1, 1], y: [from * 44, 0, 0, 0, 0], rotate: [-from * 7, 3, -1.6, 0.6, 0], scale: [0.92, 1.03, 0.99, 1, 1] },
    exit: thrown ? flung : { opacity: 0, y: from * 26, rotate: 6, scale: 0.85, transition: { duration: 0.26, ease: 'easeIn' } },
    transition: { duration: 0.8, times: [0, 0.42, 0.62, 0.8, 1], ease: 'easeOut' },
  };
  // ledger, capsule: rises as a capsule holding its glyph (the glyph's square, moved to the middle), then opens.
  const side = (width - PILL) / 2;
  const capsule = `inset(0px ${width - PILL}px 0px 0px round ${PILL / 2}px)`;
  return {
    initial: { clipPath: capsule, x: side, opacity: 0, y: from * 20 },
    animate: { clipPath: whole, x: 0, opacity: 1, y: 0, transitionEnd: { clipPath: 'none' } },
    exit: thrown ? flung : { clipPath: [whole, capsule, capsule], x: [0, side, side], opacity: [1, 1, 0], y: [0, 0, from * 16], transition: { duration: 0.42, times: [0, 0.6, 1] } },
    // Two beats, like the Dynamic Island: it rises, then opens.
    transition: { ...SETTLE, clipPath: { ...SETTLE, delay: 0.18, duration: 0.5 }, x: { ...SETTLE, delay: 0.18, duration: 0.5 } },
  };
}

/** Vivid's Candy: a success throws a little confetti from its tile (D387). */
function confetti(el, from) {
  const r = el.getBoundingClientRect();
  const colours = ['green', 'amber', 'blue', 'pink', 'teal', 'purple'].map((c) => `var(--color-vivid-${c})`);
  for (let i = 0; i < 18; i++) {
    const bit = document.createElement('span');
    Object.assign(bit.style, { position: 'fixed', left: `${r.left + 30}px`, top: `${r.top + r.height / 2}px`, width: '7px', height: '7px', borderRadius: '2px', background: colours[i % 6], pointerEvents: 'none', zIndex: 60 });
    document.body.appendChild(bit);
    const angle = Math.random() * Math.PI + (from > 0 ? Math.PI : 0), far = 50 + Math.random() * 80;
    bit.animate([{ transform: 'translate(0,0) rotate(0)', opacity: 1 }, { transform: `translate(${Math.cos(angle) * far}px, ${Math.sin(angle) * far}px) rotate(${Math.random() * 540}deg)`, opacity: 0 }],
      { duration: 900 + Math.random() * 400, easing: 'cubic-bezier(.1,.8,.3,1)' }).finished.then(() => bit.remove());
  }
}

function Toast({ toast, depth, open, onDismiss, reduce, room, look, top }) {
  const navigate = useNavigate();
  const [thrown, setThrown] = useState(false);
  const card = useRef(null);
  const from = top ? -1 : 1;
  // As wide as the stack's own space allows (measured, so it follows a resize or a phone turning).
  const width = Math.min(MAX_WIDTH, room);
  const motionFor = lookMotion(look, { width, from, reduce, thrown });
  const surface = cardLook(look, toast);
  // The words arrive once the card has opened: after the capsule's two beats, or sharpening as the Island opens.
  const textMotion = reduce ? {} : look === 'ledger' || look === 'capsule'
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0, transition: { duration: 0.12 } }, transition: { delay: 0.34, duration: 0.22 } }
    : look === 'island'
      ? { initial: { opacity: 0, filter: 'blur(4px)' }, animate: { opacity: 1, filter: 'blur(0px)' }, exit: { opacity: 0, transition: { duration: 0.1 } }, transition: { delay: 0.3, duration: 0.25 } }
      : {};

  useEffect(() => {
    if (look !== 'candy' || toast.type !== 'success' || reduce) return undefined;
    const t = setTimeout(() => card.current && confetti(card.current, from), 260);
    return () => clearTimeout(t);
  }, [look, toast.type, reduce, from]);

  return (
    // Outer: its place in the stack. Closed, the older ones sit behind the newest,
    // smaller, peeking out away from the edge; open, they're a list.
    <motion.div
      layout={reduce ? false : 'position'}
      className={open ? 'pointer-events-auto relative' : `pointer-events-auto relative [grid-area:1/1] ${top ? 'self-start' : 'self-end'}`}
      style={{ zIndex: 100 - depth }}
      animate={open || reduce
        ? { y: 0, scale: 1, opacity: 1 }
        : { y: -from * depth * 10, scale: 1 - depth * 0.05, opacity: depth >= PEEK ? 0 : 1 - depth * 0.2 }}
      transition={SETTLE}
      aria-hidden={!open && depth >= PEEK ? true : undefined}
    >
      {/* Middle: an error shakes once, after it has landed. */}
      <motion.div
        animate={!reduce && toast.type === 'error' ? { x: [0, -7, 6, -4, 3, 0] } : { x: 0 }}
        transition={{ delay: 0.5, duration: 0.45, ease: 'easeInOut' }}
      >
        {/* Inner: the toast itself, in its look; it swipes away toward its edge. */}
        <motion.div
          ref={card}
          role={toast.type === 'error' ? 'alert' : 'status'}
          initial={motionFor.initial}
          animate={motionFor.animate}
          exit={motionFor.exit}
          transition={motionFor.transition}
          drag={reduce || depth > 0 ? false : 'y'}
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={top ? { top: 0.9, bottom: 0.06 } : { top: 0.06, bottom: 0.9 }}
          dragSnapToOrigin
          onDragEnd={(_, info) => {
            const away = from * info.offset.y > 48 || from * info.velocity.y > 500;
            if (away) { setThrown(true); onDismiss(toast.id); }
          }}
          style={{ width, maxWidth: '100%', ...surface.style }}
          className={`relative touch-none overflow-hidden ${surface.className}`}
          data-look={look}
        >
          {/* Behind the newest in a closed stack only the card's edge shows, not its words. */}
          <ToastFace
            toast={toast}
            look={look}
            ring={!reduce}
            paused={open}
            hidden={depth > 0 && !open}
            still={reduce}
            textMotion={textMotion}
            onAction={() => { onDismiss(toast.id); if (toast.action.onClick) toast.action.onClick(); else navigate(toast.action.to); }}
            onDismiss={() => onDismiss(toast.id)}
          />
          {/* Glass's capsule: a light sweeps across it once it has opened. */}
          {look === 'capsule' && !reduce && (
            <motion.span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 bg-[linear-gradient(105deg,transparent_35%,rgb(255_255_255/0.5)_50%,transparent_65%)]"
              initial={{ x: '-120%' }} animate={{ x: '120%' }} transition={{ delay: 0.7, duration: 0.9, ease: 'easeInOut' }}
            />
          )}
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

/**
 * Fixed to its place (D387): bottom or top, centred under the page's content
 * or at the right. Newest in front; hovering opens the stack into a list and
 * holds every timer. The look is the design's own choice in Settings →
 * Notifications.
 */
function ToastStack({ toasts, onDismiss, onPause, onResume }) {
  const { design } = useDesign();
  const { style: look, position } = useToastLook(design);
  const place = PLACES[position] ?? PLACES['bottom-center'];
  // The width the toasts have: the fixed strip's own, measured before paint and on every resize.
  const strip = useRef(null);
  const [room, setRoom] = useState(MAX_WIDTH);
  useLayoutEffect(() => {
    const el = strip.current;
    const measure = () => setRoom(el.clientWidth);
    measure();
    const seen = new ResizeObserver(measure);
    seen.observe(el);
    return () => seen.disconnect();
  }, []);
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const newestFirst = [...toasts].reverse();
  const isOpen = open && toasts.length > 0;

  const enter = () => { setOpen(true); toasts.forEach((t) => onPause(t.id)); };
  const leave = () => { setOpen(false); toasts.forEach((t) => onResume(t.id)); };

  return (
    <div ref={strip} data-place={position} className={`apple-pane pointer-events-none fixed z-50 flex justify-center ${place.strip}`}>
      <div
        onMouseEnter={enter}
        onMouseLeave={leave}
        className={isOpen ? `flex max-w-full items-center gap-2 ${place.top ? 'flex-col' : 'flex-col-reverse'}` : 'grid max-w-full justify-items-center'}
      >
        <AnimatePresence initial={false}>
          {newestFirst.map((toast, depth) => (
            <Toast key={toast.id} toast={toast} depth={depth} open={isOpen} onDismiss={onDismiss} reduce={reduce} room={room} look={look} top={place.top} />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
