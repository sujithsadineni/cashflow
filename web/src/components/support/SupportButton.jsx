import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useDesign } from '../../hooks/use-design';
import { ReportForm } from './ReportForm';
import { SupportPanel } from './SupportPanel';
import { BugIcon, BulbIcon, ChatTypingIcon, HeartIcon } from './SupportIcons';

/**
 * The small help button, bottom-right on every app page, under the
 * assistant's (D332) in Layout's corner stack. Its bubble's three dots
 * type now and then (D334, CSS), and every 30 seconds it gives a short
 * wiggle so it's findable without being loud; MotionConfig's
 * reducedMotion="user" (App.jsx) and index.css turn both off for anyone
 * who asked their OS for less motion. Clicking fans out three options
 * above it, each with its own icon (SupportIcons.jsx): the same line
 * icon in every design, white on Vivid's coloured circle.
 */

const NUDGE_EVERY_MS = 30_000;

const OPTIONS = [
  { key: 'feature', Icon: BulbIcon, label: 'Request a feature', vividBg: 'bg-vivid-amber' },
  { key: 'bug', Icon: BugIcon, label: 'Report an error', vividBg: 'bg-vivid-red' },
  { key: 'support', Icon: HeartIcon, label: 'Support the project', vividBg: 'bg-vivid-green' },
];

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
      <div ref={rootRef} className="flex flex-col items-end gap-2">
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
                className="support-item support-chip flex items-center gap-2 rounded-full border border-rule bg-raised py-1.5 pl-3 pr-1.5 text-sm text-ink shadow-md transition-colors hover:bg-band"
              >
                {o.label}
                <span className={`flex size-8 items-center justify-center rounded-full ${vivid ? `${o.vividBg} text-white` : 'bg-band text-ink'}`} aria-hidden="true">
                  <o.Icon size={18} />
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
          className={`help-button flex size-11 items-center justify-center rounded-full shadow-lg ${
            vivid ? 'bg-vivid-green text-white' : 'border border-rule-str bg-raised text-ink'
          }`}
        >
          {open ? <span className="text-xl leading-none">+</span> : <ChatTypingIcon />}
        </motion.button>
      </div>

      {(dialog === 'feature' || dialog === 'bug') && <ReportForm kind={dialog} onClose={() => setDialog(null)} />}
      {dialog === 'support' && <SupportPanel onClose={() => setDialog(null)} />}
    </>
  );
}
