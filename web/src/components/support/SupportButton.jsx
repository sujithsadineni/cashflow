import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useDesign } from '../../design-context';
import { ReportForm } from './ReportForm';
import { SupportPanel } from './SupportPanel';

/**
 * The small help button, bottom-right on every app page (mounted once in
 * Layout). Every 30 seconds it gives a short wiggle so it's findable
 * without being loud; MotionConfig's reducedMotion="user" (App.jsx)
 * turns that off for anyone who asked their OS for less motion.
 * Clicking fans out three options above it.
 */

const NUDGE_EVERY_MS = 30_000;

const OPTIONS = [
  { key: 'feature', emoji: '💡', label: 'Request a feature', vividBg: 'bg-vivid-amber' },
  { key: 'bug', emoji: '🐞', label: 'Report an error', vividBg: 'bg-vivid-red' },
  { key: 'support', emoji: '💚', label: 'Support the project', vividBg: 'bg-vivid-green' },
];

function ChatIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M4 4.5h12a1.5 1.5 0 011.5 1.5v7a1.5 1.5 0 01-1.5 1.5H9l-3.5 3v-3H4A1.5 1.5 0 012.5 13V6A1.5 1.5 0 014 4.5z"
            stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M6.5 8.5h7M6.5 11h4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function SupportButton() {
  const vivid = useDesign().design === 'vivid';
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState(null); // 'feature' | 'bug' | 'support' | null
  const [nudge, setNudge] = useState(0);
  const rootRef = useRef(null);

  // The periodic wiggle — paused while the menu or a dialog is open.
  useEffect(() => {
    if (open || dialog) return;
    const id = setInterval(() => setNudge((n) => n + 1), NUDGE_EVERY_MS);
    return () => clearInterval(id);
  }, [open, dialog]);

  // Esc or a click anywhere else closes the menu.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    const onClick = (e) => !rootRef.current?.contains(e.target) && setOpen(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  const choose = (key) => {
    setOpen(false);
    setDialog(key);
  };

  return (
    <>
      <div ref={rootRef} className="fixed bottom-5 right-5 z-30 flex flex-col items-end gap-2">
        <AnimatePresence>
          {open &&
            OPTIONS.map((o, i) => (
              <motion.button
                key={o.key}
                onClick={() => choose(o.key)}
                initial={{ opacity: 0, y: 12, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.9, transition: { duration: 0.12 } }}
                transition={{ type: 'spring', stiffness: 380, damping: 26, delay: (OPTIONS.length - 1 - i) * 0.05 }}
                className="flex items-center gap-2 rounded-full border border-rule bg-raised py-1.5 pl-3 pr-1.5 text-sm text-ink shadow-md transition-colors hover:bg-band"
              >
                {o.label}
                <span
                  className={`flex size-8 items-center justify-center rounded-full ${vivid ? `${o.vividBg} text-white` : 'bg-band'}`}
                  aria-hidden="true"
                >
                  {vivid ? <span className="text-base leading-none">{o.emoji}</span> : <span className="size-1.5 rounded-full bg-ink" />}
                </span>
              </motion.button>
            ))}
        </AnimatePresence>

        <motion.button
          key={nudge}
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? 'Close help menu' : 'Help: request a feature, report an error, or support the project'}
          aria-expanded={open}
          // Each nudge remounts the button (key), so it needs a real starting pose —
          // `initial={false}` would skip straight to the end and nothing would move.
          initial={nudge > 0 ? { rotate: 0, scale: 1 } : false}
          animate={nudge > 0 && !open ? { rotate: [0, -14, 12, -8, 6, 0], scale: [1, 1.12, 1] } : { rotate: open ? 45 : 0 }}
          transition={{ duration: nudge > 0 && !open ? 0.8 : 0.2 }}
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.94 }}
          className={`flex size-11 items-center justify-center rounded-full shadow-lg ${
            vivid ? 'bg-vivid-green text-white' : 'border border-rule-str bg-raised text-ink'
          }`}
        >
          {open ? <span className="text-xl leading-none">+</span> : vivid ? <span className="text-lg leading-none">💬</span> : <ChatIcon />}
        </motion.button>
      </div>

      {(dialog === 'feature' || dialog === 'bug') && <ReportForm kind={dialog} onClose={() => setDialog(null)} />}
      {dialog === 'support' && <SupportPanel onClose={() => setDialog(null)} />}
    </>
  );
}
