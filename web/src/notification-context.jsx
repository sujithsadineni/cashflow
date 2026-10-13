import { useCallback, useEffect, useRef, useState } from 'react';
import { NotificationContext } from './use-notify';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { setGlobalErrorNotifier } from './api';
import { useDesign } from './use-design';

/**
 * Toasts — a fleeting "here's what just happened," not a persistent
 * inbox. Nothing here is stored: refresh the page and they're gone,
 * same as they would be if you'd simply looked away in time. A
 * notification CENTER (a bell icon, a read/unread list) is a
 * different, heavier feature this app hasn't asked for; this is
 * scoped to the transient-confirmation half of "notifications."
 *
 * Where and how (D201): bottom-right on a desktop, bottom-centre on a
 * phone. They used to drop in at the top centre, right over the page
 * title and the first figures you came to read. The corner is where
 * the eye isn't, and it sits closest to the hand on a phone.
 *   - Newest at the bottom, the stack growing upward, so an arriving
 *     toast never moves the one you're reading.
 *   - At most three show; the rest fold into "N more", so a page load
 *     with seven alerts doesn't become a wall.
 *   - A thin bar shows the time left. Hovering pauses it, so a toast
 *     you're reading doesn't vanish mid-sentence.
 *   - An optional action ("Open Review") takes you where it can be dealt with.
 *   - It slides in 24px from the right and fades out the same way:
 *     a short ease in Classic, a soft spring in Vivid, fade only under
 *     reduced motion. Classic already animated toasts (drop-in); this
 *     keeps the motion as small, and adds the exit it lacked.
 */


const DEFAULT_DURATION_MS = 5000;
const VISIBLE = 3;

let nextId = 1;

export function NotificationProvider({ children }) {
  const [toasts, setToasts] = useState([]);
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

  const notify = useCallback((message, { type = 'info', duration = DEFAULT_DURATION_MS, title = null, action = null } = {}) => {
    const id = nextId++;
    setToasts((current) => [...current, { id, message, type, title, action, duration }]);
    if (duration > 0) start(id, duration);
    return id;
  }, [start]);

  // api.js's request() can't call a hook itself (it's a plain
  // module) — this is the same bridge privacy-context.jsx uses for
  // setGlobalPrivacyMode, just for the error-toast direction instead.
  useEffect(() => {
    setGlobalErrorNotifier((message) => notify(message, { type: 'error' }));
    return () => setGlobalErrorNotifier(() => {});
  }, [notify]);

  return (
    <NotificationContext.Provider value={notify}>
      {children}
      <ToastStack toasts={toasts} onDismiss={dismiss} onPause={pause} onResume={resume} />
    </NotificationContext.Provider>
  );
}

const DOT_TONE = {
  success: 'bg-earn',
  error: 'bg-spend',
  info: 'bg-faint',
};
const BAR_TONE = {
  success: 'bg-earn/50',
  error: 'bg-spend/50',
  info: 'bg-rule-str',
};

function Toast({ toast, onDismiss, onPause, onResume, vivid, reduce }) {
  const navigate = useNavigate();
  const [paused, setPaused] = useState(false);
  const enter = reduce ? { opacity: 0 } : { opacity: 0, x: 24, scale: vivid ? 0.96 : 1 };
  const transition = reduce
    ? { duration: 0.15 }
    : vivid
      ? { type: 'spring', stiffness: 420, damping: 32 }
      : { duration: 0.22, ease: [0.16, 1, 0.3, 1] };

  return (
    <motion.div
      layout={!reduce}
      role={toast.type === 'error' ? 'alert' : 'status'}
      initial={enter}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, x: 24, transition: { duration: 0.16 } }}
      transition={transition}
      onMouseEnter={() => { setPaused(true); onPause(toast.id); }}
      onMouseLeave={() => { setPaused(false); onResume(toast.id); }}
      className={`toast-card pointer-events-auto relative w-full overflow-hidden border border-rule bg-raised text-sm shadow-lg sm:w-96 ${vivid ? 'rounded-2xl' : 'rounded-lg'}`}
    >
      <div className="flex items-start gap-3 px-4 py-3">
        <span className={`mt-1.5 inline-block size-2 shrink-0 rounded-full ${DOT_TONE[toast.type] ?? DOT_TONE.info}`} />
        <div className="min-w-0 flex-1">
          {toast.title && <div className="font-medium text-ink">{toast.title}</div>}
          <div className={toast.title ? 'mt-0.5 text-muted' : 'text-ink'}>{toast.message}</div>
          {toast.action && (
            <button
              onClick={() => { onDismiss(toast.id); if (toast.action.onClick) toast.action.onClick(); else navigate(toast.action.to); }}
              className="mt-1.5 text-sm text-ink underline underline-offset-4 decoration-rule-str hover:decoration-ink"
            >
              {toast.action.label}
            </button>
          )}
        </div>
        <button onClick={() => onDismiss(toast.id)} aria-label="Dismiss" className="shrink-0 text-faint transition-colors hover:text-ink">
          ✕
        </button>
      </div>
      {toast.duration > 0 && !reduce && (
        <span
          aria-hidden
          className={`toast-timer absolute bottom-0 left-0 h-0.5 w-full origin-left ${BAR_TONE[toast.type] ?? BAR_TONE.info}`}
          style={{ animationDuration: `${toast.duration}ms`, animationPlayState: paused ? 'paused' : 'running' }}
        />
      )}
    </motion.div>
  );
}

/**
 * Fixed to the viewport, bottom-right (bottom-centre on a phone, with
 * the page's 16px gutter), sitting just above the help button in that
 * corner (SupportButton, bottom-5 right-5) rather than over it. Newest
 * at the bottom; past three, the oldest fold into "N more".
 */
function ToastStack({ toasts, onDismiss, onPause, onResume }) {
  const vivid = useDesign().design === 'vivid';
  const reduce = useReducedMotion();
  const [expanded, setExpanded] = useState(false);
  const hidden = expanded ? 0 : Math.max(toasts.length - VISIBLE, 0);
  const shown = toasts.slice(hidden);

  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-20 z-50 flex flex-col items-center gap-2 sm:inset-x-auto sm:right-5 sm:bottom-20 sm:items-end">
      {hidden > 0 && (
        <button
          onClick={() => setExpanded(true)}
          className="pointer-events-auto rounded-full border border-rule bg-raised px-3 py-1 text-xs text-muted shadow-sm transition-colors hover:text-ink"
        >
          <span className="tnum">{hidden}</span> more
        </button>
      )}
      <AnimatePresence initial={false} mode="popLayout">
        {shown.map((toast) => (
          <Toast key={toast.id} toast={toast} onDismiss={onDismiss} onPause={onPause} onResume={onResume} vivid={vivid} reduce={reduce} />
        ))}
      </AnimatePresence>
      {expanded && toasts.length > VISIBLE && (
        <button onClick={() => setExpanded(false)} className="pointer-events-auto text-xs text-muted underline-offset-4 hover:text-ink hover:underline">
          Show fewer
        </button>
      )}
    </div>
  );
}
