import { useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { PRIMARY } from './batch-buttons';
import { AnchoredPopover, PopoverHeader } from './AnchoredPopover';

/**
 * A locked PDF's password, in a small popup hung from the lock it opens
 * (D325, the owner's ask): the Open box on the reading rail, or the lock on
 * an upload's card (AnchoredPopover does the blur, the hole and the caret).
 *
 * It says how the password did: Unlocking…, then either the field shakes and
 * says it didn't open it (the popup stays for another try), or the lock's
 * shackle lifts with a tick and the popup closes by itself. The password
 * opens the file once; nothing stores it (the API never does).
 */

const Lock = ({ open, still }) => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="4.5" y="9" width="11" height="8" rx="2" />
    {/* The shackle lifts clear of the body once the password works. */}
    <motion.path d="M7 9V6.5a3 3 0 0 1 6 0V9"
      initial={false} animate={{ y: open ? -2.5 : 0 }}
      transition={still ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 14 }} />
  </svg>
);

/**
 * onUnlock(password) → 'ok' | 'wrong' (a promise). onDone() runs after the
 * "Unlocked" moment, to carry the read on; onClose() for Esc, the blur or ×.
 */
export function UnlockPopover({ anchorRef, fileName, onUnlock, onDone, onClose }) {
  // Kept on this computer, encrypted, so the next one opens by itself (D336): on unless unticked.
  const [remember, setRemember] = useState(true);
  const still = useReducedMotion();
  const [value, setValue] = useState('');
  const [shown, setShown] = useState(false);
  const [state, setState] = useState('idle'); // idle | busy | wrong | ok
  const [shakes, setShakes] = useState(0);
  const field = useRef(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!value.trim() || state === 'busy' || state === 'ok') return;
    setState('busy');
    const answer = await onUnlock(value, remember);
    if (answer === 'ok') {
      setState('ok');
      setTimeout(onDone, still ? 300 : 900);
    } else {
      setState('wrong');
      setShakes((n) => n + 1);
      requestAnimationFrame(() => field.current?.select());
    }
  };

  return (
    <AnchoredPopover anchorRef={anchorRef} label="Unlock this PDF" busy={state === 'busy'} onClose={onClose} as="form" onSubmit={submit}>
      <PopoverHeader
        tile={<Lock open={state === 'ok'} still={still} />}
        tone={state === 'ok' ? 'bg-info/12 text-info' : state === 'wrong' ? 'bg-spend/12 text-spend' : 'bg-warn/15 text-warn'}
        title={state === 'ok' ? 'Unlocked' : 'Unlock this PDF'}
        detail={fileName}
        busy={state === 'busy'}
        onClose={onClose}
      />

      <div className="flex items-center gap-2">
        <motion.label key={shakes} animate={shakes && !still ? { x: [0, -7, 7, -5, 5, 0] } : { x: 0 }} transition={{ duration: 0.4 }}
          className={`flex h-9 min-w-0 flex-1 items-center gap-2 rounded-xl px-3 ${state === 'wrong' ? 'bg-spend/8 ring-1 ring-spend/50 focus-within:ring-2 focus-within:ring-spend/70' : 'bg-band focus-within:ring-2 focus-within:ring-info'}`}>
          <input ref={field} autoFocus type={shown ? 'text' : 'password'} value={value} autoComplete="off"
            onChange={(e) => { setValue(e.target.value); if (state === 'wrong') setState('idle'); }}
            disabled={state === 'busy' || state === 'ok'} placeholder="Password" aria-label="PDF password"
            className="min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-faint" />
          <button type="button" onClick={() => setShown((s) => !s)} aria-label={shown ? 'Hide password' : 'Show password'} className="text-muted hover:text-ink">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2.5 10s2.8-5 7.5-5 7.5 5 7.5 5-2.8 5-7.5 5-7.5-5-7.5-5z" />
              {shown ? <circle cx="10" cy="10" r="2.2" /> : <path d="M3.5 3.5l13 13" />}
            </svg>
          </button>
        </motion.label>
        <button type="submit" disabled={!value.trim() || state === 'busy' || state === 'ok'} className={PRIMARY}>
          {state === 'busy' ? 'Unlocking…' : state === 'ok'
            ? <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-label="Unlocked"><path d="m5 10.5 3.2 3.2L15 6.8" /></svg>
            : 'Unlock'}
        </button>
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-3">
        <p role="status" className={`text-[12px] ${state === 'wrong' ? 'text-spend' : state === 'ok' ? 'text-info' : 'text-muted'}`}>
          {state === 'wrong' ? "That password didn't open it. Check it and try again."
            : state === 'ok' ? 'It opened. Reading the statement…'
              : remember ? 'Remembered on this computer, encrypted.' : 'Used for this file only.'}
        </p>
        <button type="button" role="switch" aria-checked={remember} onClick={() => setRemember((r) => !r)} disabled={state === 'busy' || state === 'ok'}
          className="flex shrink-0 items-center gap-2 text-[12px] text-ink">
          Remember
          <span className={`relative h-[18px] w-8 rounded-full transition-colors ${remember ? 'bg-info' : 'bg-rule-str'}`}>
            <span className={`absolute top-[2px] left-[2px] size-[14px] rounded-full bg-white shadow-sm transition-transform ${remember ? 'translate-x-[14px]' : ''}`} />
          </span>
        </button>
      </div>
    </AnchoredPopover>
  );
}
