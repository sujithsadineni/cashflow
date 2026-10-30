import { useEffect, useState } from 'react';
import { motion } from 'motion/react';

/**
 * The Vivid welcome page's feature boxes each act out the feature they
 * name (D153) — a few seconds of motion, drawn with plain elements and
 * `motion`, no images. Each one plays when it mounts; VividWelcome
 * remounts it (a new `key`) to loop it, and on hover. All decorative:
 * the box's own title and text say the same thing in words.
 */

const spring = { type: 'spring', stiffness: 150, damping: 16 };

/** 📥 A statement drops into the tray and its rows come out. */
export function UploadDemo() {
  return (
    <div className="relative h-16 w-full">
      <motion.div
        className="absolute left-3 top-1 flex h-9 w-7 items-center justify-center rounded-md bg-raised text-[8px] font-bold text-vivid-red shadow-sm"
        initial={{ y: -30, opacity: 0, rotate: -12 }}
        animate={{ y: 6, opacity: 1, rotate: 0 }}
        transition={{ ...spring, delay: 0.1 }}
      >
        PDF
      </motion.div>
      <div className="absolute bottom-0 left-1 h-3 w-11 rounded-b-lg border-2 border-t-0 border-vivid-amber" />
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="absolute h-1.5 rounded-full bg-vivid-amber/70"
          style={{ left: 60, top: 14 + i * 12, width: 70 - i * 14 }}
          initial={{ x: -30, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ delay: 0.9 + i * 0.25, duration: 0.6, ease: 'easeOut' }}
        />
      ))}
    </div>
  );
}

/** ✅ Rows get approved, one tick at a time. */
export function ReviewDemo() {
  return (
    <div className="flex h-16 w-full flex-col justify-center gap-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-2">
          <motion.span
            className="flex size-3.5 items-center justify-center rounded-full bg-vivid-green text-[8px] font-bold text-white"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ ...spring, delay: 0.4 + i * 0.5 }}
          >
            ✓
          </motion.span>
          <span className="h-1.5 rounded-full bg-vivid-green/25" style={{ width: 90 - i * 18 }} />
        </div>
      ))}
    </div>
  );
}

/** 🥧 A spend-mix ring draws itself, slice by slice. */
export function MixDemo() {
  const slices = [
    ['var(--color-vivid-red)', 0.37],
    ['var(--color-vivid-amber)', 0.2],
    ['var(--color-vivid-teal)', 0.19],
    ['var(--color-vivid-blue)', 0.12],
    ['var(--color-vivid-purple)', 0.12],
  ];
  const c = 2 * Math.PI * 22;
  // Where each slice starts: the sum of the ones before it.
  const starts = slices.map((_, i) => slices.slice(0, i).reduce((sum, [, f]) => sum + f, 0));
  return (
    <div className="flex h-16 w-full items-center justify-center">
      <svg width="64" height="64" viewBox="0 0 64 64" className="-rotate-90">
        {slices.map(([color, frac], i) => {
          const offset = -starts[i] * c;
          return (
            <motion.circle
              key={color}
              cx="32"
              cy="32"
              r="22"
              fill="none"
              stroke={color}
              strokeWidth="9"
              strokeDashoffset={offset}
              initial={{ strokeDasharray: `0 ${c}` }}
              animate={{ strokeDasharray: `${frac * c - 1.5} ${c}` }}
              transition={{ delay: 0.3 + i * 0.3, duration: 0.7, ease: 'easeOut' }}
            />
          );
        })}
      </svg>
    </div>
  );
}

/** 🔁 A month of due dates fills in — mostly paid, one upcoming, one missed. */
export function RecurringDemo() {
  const dots = ['g', 'g', 'e', 'g', 'e', 'g', 'e', 'e', 'g', 'a', 'e', 'g', 'r', 'e'];
  const color = { g: 'bg-vivid-green', a: 'bg-vivid-amber', r: 'bg-vivid-red', e: 'bg-band' };
  return (
    <div className="grid h-16 w-full grid-cols-7 content-center gap-1.5">
      {dots.map((d, i) => (
        <motion.span
          key={i}
          className={`mx-auto size-4 rounded-md ${color[d]}`}
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ ...spring, delay: 0.15 + i * 0.1 }}
        />
      ))}
    </div>
  );
}

/** 🚗 A loan drives toward its payoff flag. */
export function LoanDemo() {
  return (
    <div className="relative flex h-16 w-full items-center">
      <div
        className="h-2.5 w-full rounded-full bg-ink/75"
        style={{ backgroundImage: 'repeating-linear-gradient(to right, rgb(255 255 255 / 0.8) 0 6px, transparent 6px 12px)', backgroundSize: '100% 2px', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' }}
      />
      <span className="absolute -right-1 text-base leading-none" aria-hidden="true">🏁</span>
      <motion.span
        className="absolute text-2xl leading-none"
        style={{ top: 10, x: '-50%' }}
        initial={{ left: '0%' }}
        animate={{ left: '72%', y: [0, -3, 0, -3, 0, -2, 0] }}
        transition={{ left: { duration: 2.8, ease: [0.16, 1, 0.3, 1], delay: 0.3 }, y: { duration: 2.4, delay: 0.3 } }}
        aria-hidden="true"
      >
        <span className="inline-block" style={{ transform: 'scaleX(-1)' }}>🚗</span>
      </motion.span>
    </div>
  );
}

/** 💳 A stack of cards fans out into a wallet. */
export function CardsDemo() {
  const cards = [
    ['bg-vivid-blue', -14, -18],
    ['bg-vivid-purple', 0, 0],
    ['bg-vivid-teal', 14, 18],
  ];
  return (
    <div className="relative flex h-16 w-full items-center justify-center">
      {cards.map(([bg, rotate, x], i) => (
        <motion.div
          key={bg}
          className={`absolute h-10 w-16 rounded-md shadow-md ${bg}`}
          initial={{ rotate: 0, x: 0 }}
          animate={{ rotate, x }}
          transition={{ ...spring, delay: 0.4 + i * 0.12 }}
        >
          <span className="absolute left-1.5 top-1.5 h-1.5 w-3 rounded-sm bg-white/60" />
        </motion.div>
      ))}
    </div>
  );
}

/** 🧾 An edit, written down from → to. */
export function HistoryDemo() {
  return (
    <div className="flex h-16 w-full items-center justify-center gap-2 text-xs">
      <motion.span
        className="rounded-md bg-vivid-red/10 px-2 py-1 text-vivid-loss"
        initial={{ textDecorationColor: 'rgba(178,58,38,0)' }}
        animate={{ textDecorationColor: 'rgba(178,58,38,0.6)' }}
        style={{ textDecorationLine: 'line-through' }}
        transition={{ delay: 0.6, duration: 0.5 }}
      >
        Shopping
      </motion.span>
      <motion.span className="text-faint" initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 1.1, duration: 0.4 }}>
        →
      </motion.span>
      <motion.span
        className="rounded-md bg-vivid-green/10 px-2 py-1 font-medium text-vivid-green"
        initial={{ scale: 0.4, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ ...spring, delay: 1.5 }}
      >
        Costco
      </motion.span>
    </div>
  );
}

/** 👨‍👩‍👧 The household bounces in. */
export function HouseholdDemo() {
  return (
    <div className="flex h-16 w-full items-end justify-center gap-1.5 pb-2">
      {['👩', '👨', '🧒', '🐶'].map((e, i) => (
        <motion.span
          key={e}
          className="flex size-9 items-center justify-center rounded-full bg-raised text-lg leading-none shadow-sm"
          initial={{ y: 30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 12, delay: 0.2 + i * 0.22 }}
        >
          {e}
        </motion.span>
      ))}
    </div>
  );
}

/** 🔒 An amount scrambles, then hides. Illustrative figure, never real data. */
export function PrivacyDemo() {
  const target = '$1,234.56';
  const [text, setText] = useState(target);
  useEffect(() => {
    const chars = '0123456789$*';
    let frame = 0;
    let timer;
    // Show the real-looking figure for a beat, then scramble it away.
    const start = setTimeout(() => {
      timer = setInterval(() => {
        frame += 1;
        if (frame < 10) setText(target.replace(/\d/g, () => chars[Math.floor(Math.random() * chars.length)]));
        else {
          setText('$***.**');
          clearInterval(timer);
        }
      }, 110);
    }, 900);
    return () => {
      clearTimeout(start);
      clearInterval(timer);
    };
  }, []);
  return (
    <div className="flex h-16 w-full items-center justify-center">
      <span className="rounded-lg bg-raised px-3 py-1.5 font-mono text-lg font-semibold tnum text-ink shadow-sm">{text}</span>
    </div>
  );
}

/** 🎁 Cashback, read off the statement: a coin flips in and the credit floats up. */
export function CashbackDemo() {
  return (
    <div className="flex h-16 w-full flex-col items-center justify-center gap-1">
      <motion.span
        className="rounded-full bg-vivid-green/15 px-2 py-0.5 font-mono text-[11px] font-semibold text-vivid-green"
        initial={{ y: 12, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 1.4, duration: 0.6, ease: 'easeOut' }}
      >
        +cashback
      </motion.span>
      <motion.span
        className="flex size-8 items-center justify-center rounded-full bg-vivid-amber text-sm font-bold text-white shadow-sm"
        style={{ transformPerspective: 200 }}
        initial={{ rotateY: 0, y: -10 }}
        animate={{ rotateY: 720, y: 0 }}
        transition={{ duration: 1.4, ease: 'easeOut', delay: 0.2 }}
      >
        $
      </motion.span>
    </div>
  );
}
