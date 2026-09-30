import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { setGlobalErrorNotifier } from './api';

/**
 * Toasts — a fleeting "here's what just happened," not a persistent
 * inbox. Nothing here is stored: refresh the page and they're gone,
 * same as they would be if you'd simply looked away in time. A
 * notification CENTER (a bell icon, a read/unread list) is a
 * different, heavier feature this app hasn't asked for; this is
 * scoped to the transient-confirmation half of "notifications."
 */

const NotificationContext = createContext(null);

const DEFAULT_DURATION_MS = 4500;

let nextId = 1;

export function NotificationProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const notify = useCallback((message, { type = 'info', duration = DEFAULT_DURATION_MS } = {}) => {
    const id = nextId++;
    setToasts((current) => [...current, { id, message, type }]);
    if (duration > 0) {
      timers.current.set(id, setTimeout(() => dismiss(id), duration));
    }
    return id;
  }, [dismiss]);

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
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </NotificationContext.Provider>
  );
}

/** `notify('Statement uploaded')` or `notify('Upload failed', { type: 'error' })`. */
export function useNotify() {
  const notify = useContext(NotificationContext);
  if (!notify) throw new Error('useNotify must be used within a NotificationProvider');
  return notify;
}

const DOT_TONE = {
  success: 'bg-earn',
  error: 'bg-spend',
  info: 'bg-faint',
};

function Toast({ toast, onDismiss }) {
  return (
    <div
      role="status"
      className="animate-drop-in pointer-events-auto flex w-80 items-start gap-3 rounded-lg border border-rule bg-raised px-4 py-3 text-sm shadow-lg"
    >
      <span className={`mt-1.5 inline-block size-2 shrink-0 rounded-full ${DOT_TONE[toast.type] ?? DOT_TONE.info}`} />
      <span className="min-w-0 flex-1 text-ink">{toast.message}</span>
      <button
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss"
        className="shrink-0 text-faint transition-colors hover:text-ink"
      >
        ✕
      </button>
    </div>
  );
}

/**
 * Fixed to the viewport, not the page content — stacks new toasts
 * downward from a fixed point under the top edge so an arriving one
 * never reflows/jumps the ones already reading.
 */
function ToastStack({ toasts, onDismiss }) {
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex flex-col items-center gap-2">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
