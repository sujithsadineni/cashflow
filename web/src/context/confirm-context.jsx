import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ConfirmContext } from '../hooks/use-confirm';

/**
 * One confirm sheet for the whole app (D312), shaped like a macOS alert: a
 * short title, an optional line under it, Cancel and the action. The action
 * is red when it throws something away. Focus starts on Cancel for a
 * destructive one, on the action otherwise; Esc cancels, Enter takes the
 * focused button. The e2e suite sets `window.__confirmAll` so it doesn't
 * stop to answer (it used to override window.confirm).
 */
export function ConfirmProvider({ children }) {
  const [ask, setAsk] = useState(null);
  const still = useReducedMotion();

  const confirm = useCallback((options) => {
    if (typeof window !== 'undefined' && window.__confirmAll) return Promise.resolve(true);
    const o = typeof options === 'string' ? { title: options } : options;
    return new Promise((resolve) => setAsk({ ...o, resolve }));
  }, []);

  const answer = (value) => {
    ask?.resolve(value);
    setAsk(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {createPortal(
        <AnimatePresence>
          {ask && <Sheet key="confirm" ask={ask} still={still} onAnswer={answer} />}
        </AnimatePresence>,
        document.body,
      )}
    </ConfirmContext.Provider>
  );
}

function Sheet({ ask, still, onAnswer }) {
  const cancelRef = useRef(null);
  const actionRef = useRef(null);
  useEffect(() => {
    (ask.destructive ? cancelRef : actionRef).current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); onAnswer(false); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ask, onAnswer]);

  const fade = still ? {} : { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } };
  const pop = still ? {} : { initial: { opacity: 0, scale: 0.96 }, animate: { opacity: 1, scale: 1 }, exit: { opacity: 0, scale: 0.98 }, transition: { type: 'spring', bounce: 0, duration: 0.25 } };
  const button = 'flex-1 rounded-[10px] px-3 py-2 text-[15px] font-medium transition-[background-color,filter] duration-150';

  return (
    <div className="apple-pane fixed inset-0 z-[90] flex items-center justify-center p-4">
      <motion.div {...fade} className="absolute inset-0 bg-black/30" onClick={() => onAnswer(false)} aria-hidden="true" />
      <motion.div
        {...pop}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby={ask.message ? 'confirm-message' : undefined}
        className="relative w-full max-w-[19rem] rounded-2xl border border-rule bg-raised p-5 text-center shadow-[0_20px_60px_-20px_rgb(0_0_0/0.45)]"
      >
        <h2 id="confirm-title" className="text-[17px] font-semibold text-ink">{ask.title}</h2>
        {ask.message && <p id="confirm-message" className="mt-1.5 text-[13px] leading-snug text-muted">{ask.message}</p>}
        <div className="mt-5 flex gap-2">
          <button ref={cancelRef} type="button" onClick={() => onAnswer(false)} className={`${button} bg-band text-ink hover:brightness-95`}>
            {ask.cancel ?? 'Cancel'}
          </button>
          <button ref={actionRef} type="button" onClick={() => onAnswer(true)}
            className={`${button} text-white hover:brightness-110 ${ask.destructive ? 'bg-spend' : 'bg-info'}`}>
            {ask.confirm ?? 'OK'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
