import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { maskAddress } from '../../../api';
import { GroupBlock } from '../apple/grouped';
import { monthYear, accountWord, addressCase } from './person-format';

/**
 * Where a person's statements are mailed (D303): the current address, from
 * the newest statement, and under it Previous Addresses, a row that opens a
 * timeline of every earlier one with when statements went there. Each place
 * shows once however statements spell it (the API groups them). An old
 * statement uploaded later adds to the timeline; only a newer one changes
 * the current address. Hidden in privacy mode.
 */

const Pin = () => (
  <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-band text-muted" aria-hidden="true">
    <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 14s5-4.2 5-8A5 5 0 0 0 3 6c0 3.8 5 8 5 8Z" /><circle cx="8" cy="6" r="1.8" /></svg>
  </span>
);

const span = (a) => {
  const from = monthYear(a.first_seen);
  const to = monthYear(a.last_seen);
  return from === to ? from : `${from} – ${to}`;
};
const count = (n) => `${n} ${n === 1 ? 'statement' : 'statements'}`;

export function AddressHistory({ address, still }) {
  const [open, setOpen] = useState(false);
  const { current, previous } = address;

  if (!current) {
    return (
      <GroupBlock header="Address" footer="None of their statements print one on page one (Chase, Apple, Robinhood, Barclays, Bilt and SoFi don’t).">
        <div className="px-4 py-3 text-[15px] text-faint">Not on any statement yet</div>
      </GroupBlock>
    );
  }

  return (
    <GroupBlock header="Address" footer="Read off every statement they’re mailed. Hidden in privacy mode.">
      <div className="flex items-start gap-3 py-2.5 pr-4 pl-4">
        <Pin />
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] text-muted">Current</span>
          <span className="block text-[15px] leading-snug text-ink">{maskAddress(addressCase(current.line))}</span>
          <span className="mt-0.5 block text-[13px] text-muted tnum">
            Since {monthYear(current.first_seen)} · {count(current.statements)} · {accountWord(current.accounts)}
          </span>
        </span>
      </div>

      {previous.length > 0 && (
        <div className="pl-4">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="-ml-4 flex min-h-11 w-[calc(100%+1rem)] items-center gap-4 border-t border-rule py-2 pr-4 pl-4 text-left transition-colors duration-150 hover:bg-band active:bg-band"
          >
            <span className="flex-1 text-[15px] text-ink">Previous Addresses</span>
            <span className="text-[15px] text-muted tnum">{previous.length}</span>
            <svg
              width="8" height="13" viewBox="0 0 8 13" aria-hidden="true"
              className={`text-faint ${still ? '' : 'transition-transform duration-200'} ${open ? 'rotate-90' : ''}`}
            >
              <path d="M1.5 1.5 6.5 6.5l-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <AnimatePresence initial={false}>
            {open && (
              <motion.ol
                aria-label="Previous addresses, newest first"
                className="overflow-hidden"
                initial={still ? false : { height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={still ? { height: 0, opacity: 0, transition: { duration: 0 } } : { height: 0, opacity: 0 }}
                transition={{ type: 'spring', bounce: 0, duration: 0.35 }}
              >
                {previous.map((a, i) => (
                  <li key={a.line} className="relative flex gap-3 py-2.5 pr-4">
                    {/* The timeline: a dot per address, joined by a line down to the next. */}
                    <span className="flex w-8 shrink-0 flex-col items-center" aria-hidden="true">
                      <span className="mt-1.5 size-2.5 shrink-0 rounded-full border-2 border-faint bg-raised" />
                      {i < previous.length - 1 && <span className="-mb-4 mt-1 w-0.5 flex-1 rounded-full bg-rule-str" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] text-muted tnum">{span(a)}</span>
                      <span className="block text-[15px] leading-snug text-ink">{maskAddress(addressCase(a.line))}</span>
                      <span className="mt-0.5 block text-[13px] text-muted tnum">{count(a.statements)} · {accountWord(a.accounts)}</span>
                    </span>
                  </li>
                ))}
              </motion.ol>
            )}
          </AnimatePresence>
        </div>
      )}
    </GroupBlock>
  );
}
