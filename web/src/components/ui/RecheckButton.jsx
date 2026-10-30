import { motion, useReducedMotion } from 'motion/react';

/**
 * A page's Re-check (Review, Recurring — D363): an action, not a place, so it
 * sits with the title rather than among the tabs (tab-bars.md). The arrow turns
 * once per press (`runs` counts them); still under Reduce Motion.
 */
export function RecheckButton({ onClick, runs = 0, children = 'Re-check' }) {
  const reduceMotion = useReducedMotion();
  return (
    <button
      type="button"
      onClick={onClick}
      className="apple-pane inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-info/10 px-3.5 py-1.5 text-[15px] font-medium text-info transition-colors duration-150 hover:bg-info/15 active:bg-info/20"
    >
      <motion.svg
        width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"
        animate={{ rotate: reduceMotion ? 0 : runs * 360 }}
        transition={{ type: 'spring', bounce: 0, duration: 0.8 }}
      >
        <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </motion.svg>
      {children}
    </button>
  );
}
