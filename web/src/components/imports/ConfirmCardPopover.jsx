import { useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { maskName } from '../../api';
import { PRIMARY, QUIET } from './batch-buttons';
import { AnchoredPopover, PopoverHeader } from './AnchoredPopover';

/**
 * Find the card asks (D325, the owner's ask): the card read off the statement
 * is only a guess until the owner says so, so the reading boxes pause on
 * that box and this asks, hung from it like the password popup.
 *
 * "Yes, that's it" attaches the statement to that account there and then;
 * the box turns into a tick and the boxes play on. "No, something else"
 * lets them play on with the card still open, and the statement then asks
 * which account it is (no second "Yes, that's it" at the end). Nothing is
 * ever filed without this answer: the wrong card is the worst mistake an
 * import can make.
 */

const CardIcon = ({ settled, still }) => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2.5" y="5" width="15" height="10.5" rx="2" />
    <path d="M2.5 8.5h15" />
    {settled && (
      <motion.path d="m7.5 12.2 1.8 1.8 3.4-3.6" strokeWidth="2" initial={still ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.35 }} />
    )}
  </svg>
);

/**
 * account: the suggested one ({ name, mask, person_name }); holder: the name printed on the statement.
 * onYes() → 'ok' or an error message (a promise); onNo(); onDone() after the "That's the card" moment.
 */
export function ConfirmCardPopover({ anchorRef, account, holder, onYes, onNo, onDone, onClose }) {
  const still = useReducedMotion();
  const [state, setState] = useState('idle'); // idle | busy | ok
  const [error, setError] = useState(null);

  const yes = async () => {
    setState('busy');
    setError(null);
    const answer = await onYes();
    if (answer === 'ok') {
      setState('ok');
      setTimeout(onDone, still ? 300 : 800);
    } else {
      setState('idle');
      setError(answer);
    }
  };

  const label = [account.name, account.mask && `···${account.mask}`].filter(Boolean).join(' ');
  return (
    <AnchoredPopover anchorRef={anchorRef} label="Is this the card?" busy={state === 'busy'} onClose={onClose}>
      <PopoverHeader
        tile={<CardIcon settled={state === 'ok'} still={still} />}
        tone={state === 'ok' ? 'bg-info/12 text-info' : 'bg-warn/15 text-warn'}
        title={state === 'ok' ? "That's the card" : 'Is this the card?'}
        detail={holder ? `Printed for ${maskName(holder)}` : 'Read off the statement'}
        busy={state === 'busy'}
        onClose={onClose}
      />
      <p className="rounded-xl bg-band px-3 py-2 text-[14px] text-ink">
        <span className="font-medium">{account.name}</span>
        {account.mask && <span className="font-mono text-[13px] text-muted tnum"> ···{account.mask}</span>}
        {account.person_name && <span className="text-muted"> · {maskName(account.person_name)}</span>}
      </p>
      <div className="mt-2.5 flex items-center justify-end gap-2">
        <button type="button" onClick={onNo} disabled={state !== 'idle'} className={QUIET}>No, something else</button>
        <button type="button" onClick={yes} disabled={state !== 'idle'} autoFocus className={PRIMARY}>
          {state === 'busy' ? 'Attaching…' : state === 'ok'
            ? <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-label="Attached"><path d="m5 10.5 3.2 3.2L15 6.8" /></svg>
            : "Yes, that's it"}
        </button>
      </div>
      <p role="status" className={`mt-2 text-[12px] ${error ? 'text-spend' : state === 'ok' ? 'text-info' : 'text-muted'}`}>
        {error ?? (state === 'ok' ? `On ${label}. Reading on…` : 'Nothing is filed until you say which card.')}
      </p>
    </AnchoredPopover>
  );
}
