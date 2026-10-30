import { motion } from 'motion/react';
import { vividTone } from '../../lib/app/toast-surface';

/**
 * What a toast looks like (D383, a look per design D387, four kept D388): the card's own
 * surface and what's on it, for each look in lib/app/toast-look.js. The live
 * toast (context/notification-context.jsx) and the previews in Settings →
 * Notifications draw the same thing. Motion lives with the toast; this is the
 * still picture, plus the parts that move inside it (the timer, the check).
 *
 *   ledger, capsule — the glyph in a ring of time left, the words, the button.
 *                     Classic's on solid paper; Glass's on its frosted card
 *                     (`.toast-card`), with a light that sweeps once.
 *   island          — always black, a bright glyph, like the Dynamic Island.
 *   candy           — Vivid: a colour for the kind, a white emoji tile.
 *   sticker         — Vivid: a coloured border with a 3D edge, a tilted tile.
 */

const GLYPH = {
  success: { tone: 'bg-earn/15 text-earn', ring: 'text-earn', path: 'M3.5 8.5l3 3 6-7' },
  error: { tone: 'bg-spend/15 text-spend', ring: 'text-spend', path: 'M8 4v5M8 11.5v.5' },
  info: { tone: 'bg-band text-muted', ring: 'text-faint', path: 'M8 7v5M8 4.5v.5' },
};
// Apple's system colours for the Island's glyph, which sits on black in every theme.
const ISLAND = { success: '#30D158', error: '#FF453A', info: '#0A84FF' };
const RING = 2 * Math.PI * 13; // the timer ring's length

function Ring({ toast, paused, className }) {
  return (
    <svg viewBox="0 0 28 28" className={`absolute inset-0 size-7 -rotate-90 ${className}`} aria-hidden="true">
      <circle cx="14" cy="14" r="13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
        strokeDasharray={RING} className="toast-ring"
        style={{ '--ring': RING, animationDuration: `${toast.duration}ms`, animationPlayState: paused ? 'paused' : 'running' }} />
    </svg>
  );
}

const X = (
  <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
);

/**
 * The words and controls of a toast in a look. `ring` draws the time left where
 * the look has one; `paused` holds it; `hidden` hides the words (a toast behind
 * the newest in a closed stack); `still` draws it without its inner motion (the
 * previews, Reduce Motion); `preview` draws its controls as shapes rather than
 * buttons; `textMotion` is passed to the words.
 */
export function ToastFace({ toast, look = 'ledger', ring = false, paused = false, hidden = false, still = false, preview = false, textMotion = {}, onAction, onDismiss }) {
  // A preview (Settings) sits inside a button that chooses it, so its own controls are drawn, not buttons.
  const Control = preview ? 'span' : 'button';
  const controlProps = preview ? {} : { type: 'button' };
  const glyph = GLYPH[toast.type] ?? GLYPH.info;
  const words = (title, line) => (
    <motion.div className="min-w-0 flex-1 leading-snug" {...textMotion}>
      {toast.title && <div className={`truncate ${title}`}>{toast.title}</div>}
      <div className={`line-clamp-2 ${line}`}>{toast.message}</div>
    </motion.div>
  );
  const button = (cls, style) => toast.action && <Control {...controlProps} onClick={onAction} style={style} className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-[filter,background-color] ${cls}`}>{toast.action.label}</Control>;
  const close = (cls) => <Control {...controlProps} onClick={onDismiss} aria-label={preview ? undefined : 'Dismiss'} className={`flex size-6 shrink-0 items-center justify-center rounded-full transition-colors ${cls}`}>{X}</Control>;
  const row = `flex min-h-[52px] items-center gap-3 text-left transition-opacity duration-200 ${hidden ? 'opacity-0' : ''}`;
  const timed = ring && toast.duration > 0;

  if (look === 'island') {
    return (
      <div className={`${row} py-2.5 pl-2.5 pr-3`}>
        {/* The glyph pops in as the Island opens. */}
        <motion.span
          className="flex size-[34px] shrink-0 items-center justify-center rounded-full text-white"
          style={{ background: ISLAND[toast.type] ?? ISLAND.info }}
          initial={still ? false : { scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', bounce: 0.5, duration: 0.5, delay: 0.24 }}
          aria-hidden="true"
        >
          <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d={glyph.path} /></svg>
        </motion.span>
        {words('text-[13.5px] font-semibold', 'text-xs text-white/65')}
        {/* The button and ✕ arrive with the words, not while the Island is still a pill. */}
        <motion.span className="flex shrink-0 items-center gap-3" {...textMotion}>
          {button('bg-white/15 text-white hover:bg-white/25')}
          {close('text-white/60 hover:bg-white/15 hover:text-white')}
        </motion.span>
      </div>
    );
  }

  if (look === 'candy' || look === 'sticker') {
    const candy = look === 'candy';
    const { bright, deep } = vividTone(toast);
    return (
      <div className={`${row} ${candy ? 'py-2.5 pl-2.5 pr-2.5' : 'px-3 py-3'}`}>
        <motion.span
          className={`flex shrink-0 items-center justify-center text-xl leading-none ${candy ? 'size-[38px] rounded-[13px] bg-white' : 'size-10 rounded-xl'}`}
          style={candy ? undefined : { background: bright }}
          // Candy's emoji spins in with the pop; Sticker's tile gives a "boing" once the card has landed.
          initial={still ? false : candy ? { rotate: -40, scale: 0.4 } : { rotate: -6, scale: 0.7 }}
          animate={candy ? { rotate: 0, scale: 1 } : { rotate: [-6, -16, -3, -6], scale: [0.7, 1.22, 0.96, 1] }}
          transition={candy ? { type: 'spring', bounce: 0.55, duration: 0.6, delay: 0.12 } : { duration: 0.55, delay: 0.5, times: [0, 0.4, 0.75, 1], ease: 'easeOut' }}
          aria-hidden="true"
        >{toast.emoji}</motion.span>
        {candy
          ? words('text-[13.5px] font-semibold', 'text-xs text-white/85')
          : words('text-[14.5px] font-extrabold text-ink', 'text-xs text-muted')}
        {/* Candy's button takes the card's colour for its words; Sticker's is filled with it. */}
        {button(candy ? 'bg-white font-semibold hover:brightness-95' : 'font-extrabold uppercase tracking-wider text-white shadow-[0_3px_0_rgb(0_0_0/0.25)] hover:brightness-110', candy ? { color: deep } : { background: deep })}
        {close(candy ? 'text-white/75 hover:bg-white/20 hover:text-white' : 'text-faint hover:bg-band hover:text-ink')}
      </div>
    );
  }

  // ledger (Classic) and capsule (Glass)
  return (
    <div className={`${row} py-2 pl-3 pr-2.5`}>
      <span className="relative flex size-7 shrink-0 items-center justify-center" aria-hidden="true">
        <span className={`flex size-[22px] items-center justify-center rounded-full ${glyph.tone}`}>
          <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={glyph.path} /></svg>
        </span>
        {timed && <Ring toast={toast} paused={paused} className={glyph.ring} />}
      </span>
      {words('text-[13px] font-medium text-ink', toast.title ? 'text-xs text-muted' : 'text-[13px] text-ink')}
      {button('bg-band text-ink hover:bg-rule')}
      {close('text-faint hover:bg-band hover:text-ink')}
    </div>
  );
}
