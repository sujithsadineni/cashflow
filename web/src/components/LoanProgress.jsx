import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { loanTypeIcon } from './LoanIcons';
import { useDesign } from '../design-context';
import { VIVID_LOAN, loanInsightsFor } from '../loan-progress';
import { formatMoney } from '../api';

/**
 * A type-themed "how much is cleared" animation — reusable across the
 * loans list (small) and a single loan's own detail view (large).
 * `percent` is real data (see loan-progress.js — never invented), so
 * this component itself stays dumb: given a number, animate toward
 * it; given null, render nothing rather than a misleading empty bar.
 *
 * Two track shapes, not five — a car and a car-shaped "other" loan
 * both travel a road; a card loan (credit card or a 0% balance
 * transfer) rings down instead, since a promo deadline reads better
 * as a countdown than a distance. Which icon rides the track still
 * comes from `loanTypeIcon`, the same icon set the list and detail
 * views already use, so the glyph never drifts from what the rest of
 * the app already calls this loan.
 */

const TRACK_BY_TYPE = {
  car: 'road',
  home: 'bar',
  other: 'bar',
  credit_card: 'ring',
  balance_transfer: 'ring',
};

/** Renders at 0% on first paint, then flips a tick later so the CSS
 * transition on width/stroke-dashoffset actually animates toward the
 * real value instead of snapping straight to it. `prefers-reduced-
 * motion` needs no special case here — the existing global rule in
 * index.css already clamps every transition-duration to ~0. */
function useRevealOnMount() {
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setRevealed(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  return revealed;
}

function LinearTrack({ icon, percent, height, road }) {
  const revealed = useRevealOnMount();
  const pct = revealed ? percent : 0;
  const marker = height + 6;

  // The road's dashes are a background-image, not a CSS border-style —
  // `border-dashed` exists but browsers render it so fine-grained at a
  // couple of pixels wide that it reads as solid; a repeating gradient
  // gives real, visible dash/gap control instead.
  const roadStyle = road
    ? { height, backgroundImage: 'repeating-linear-gradient(to right, var(--color-rule-str) 0 6px, transparent 6px 13px)' }
    : { height };

  return (
    <div className="relative flex-1" style={{ height: marker }}>
      <div
        className={`absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-full ${road ? '' : 'bg-band'}`}
        style={roadStyle}
      />
      {/* The stretch already behind the marker — a car's paved road, or
          any other type's plain fill — same element either way, just a
          different track texture underneath it. */}
      <div
        className="absolute left-0 top-1/2 -translate-y-1/2 rounded-full bg-earn transition-[width] duration-[900ms] ease-out"
        style={{ height, width: `${pct}%` }}
      />
      {/* Payoff marker — a plain tick, not a new icon asset for one pixel of flourish. */}
      <div className="absolute right-0 top-1/2 h-3 w-0.5 -translate-y-1/2 rounded-full bg-rule-str" />
      <div
        className="absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-earn text-white shadow-sm transition-[left] duration-[900ms] ease-out"
        style={{ left: `${pct}%`, width: marker, height: marker }}
      >
        {icon}
      </div>
    </div>
  );
}

function RingTrack({ icon, percent, size }) {
  const revealed = useRevealOnMount();
  const pct = revealed ? percent : 0;
  const stroke = Math.max(size * 0.08, 3);
  const r = size / 2 - stroke;
  const c = 2 * Math.PI * r;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-band)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-earn)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (pct / 100) * c}
          className="transition-[stroke-dashoffset] duration-[900ms] ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-earn">{icon}</div>
    </div>
  );
}

/**
 * Vivid's version (D140): the loan's own emoji rides the track — a
 * real 🚗 driving an asphalt road to a 🏁 for a car loan, which is the
 * picture the owner described when this component was first asked
 * for. Driven by `motion` so the trip takes ~1.6s with a bob while
 * moving (a finite three hops, never an idle loop), instead of Classic's
 * 0.9s CSS slide. Card loans still get the ring, emoji in its center.
 */
const ARRIVE = { duration: 1.6, ease: [0.16, 1, 0.3, 1] };

function VividLoanProgress({ type, percent, size }) {
  const meta = VIVID_LOAN[type] ?? VIVID_LOAN.other;
  const shape = TRACK_BY_TYPE[type] ?? 'bar';
  const lg = size === 'lg';

  if (shape === 'ring') {
    const box = lg ? 76 : 50;
    const stroke = lg ? 7 : 5;
    const r = box / 2 - stroke;
    const c = 2 * Math.PI * r;
    return (
      <div className="flex items-center gap-3">
        <div className="relative shrink-0" style={{ width: box, height: box }}>
          <svg width={box} height={box} className="-rotate-90">
            <circle cx={box / 2} cy={box / 2} r={r} fill="none" stroke="var(--color-band)" strokeWidth={stroke} />
            <motion.circle
              cx={box / 2}
              cy={box / 2}
              r={r}
              fill="none"
              stroke={meta.stroke}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={c}
              initial={{ strokeDashoffset: c }}
              animate={{ strokeDashoffset: c - (percent / 100) * c }}
              transition={ARRIVE}
            />
          </svg>
          <motion.span
            className="absolute inset-0 flex items-center justify-center leading-none"
            style={{ fontSize: lg ? 28 : 19 }}
            initial={{ scale: 0, rotate: -120 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 180, damping: 11, delay: 0.25 }}
            aria-hidden="true"
          >
            {meta.emoji}
          </motion.span>
        </div>
        <div>
          <div className="font-mono text-sm font-semibold tnum text-ink">{percent}%</div>
          <div className="text-xs text-muted">of the way there</div>
        </div>
      </div>
    );
  }

  const emojiSize = lg ? 30 : 22;
  const road = shape === 'road';
  return (
    <div className="flex items-center gap-3">
      <div className="relative flex-1" style={{ height: emojiSize + 10 }}>
        <div
          className={`absolute inset-x-0 top-1/2 -translate-y-1/2 overflow-hidden rounded-full ${road ? 'bg-ink/75' : 'bg-band'}`}
          style={{ height: road ? (lg ? 14 : 10) : lg ? 10 : 7 }}
        >
          {road && (
            <div
              className="absolute inset-x-2 top-1/2 h-0.5 -translate-y-1/2"
              style={{ backgroundImage: 'repeating-linear-gradient(to right, rgb(255 255 255 / 0.85) 0 7px, transparent 7px 14px)' }}
            />
          )}
          <motion.div
            className={`absolute inset-y-0 left-0 ${meta.fill} ${road ? 'opacity-80' : ''}`}
            initial={{ width: '0%' }}
            animate={{ width: `${percent}%` }}
            transition={ARRIVE}
          />
        </div>
        <span className="absolute -right-1 top-1/2 -translate-y-1/2 leading-none" style={{ fontSize: emojiSize * 0.75 }} aria-hidden="true">
          🏁
        </span>
        <motion.div
          className="absolute top-0 leading-none"
          style={{ x: '-50%', fontSize: emojiSize }}
          initial={{ left: '0%' }}
          animate={{ left: `${percent}%`, y: [0, -3, 0, -3, 0, -2, 0] }}
          transition={{ left: ARRIVE, y: { duration: 1.4, ease: 'easeInOut' } }}
          aria-hidden="true"
        >
          <span className="inline-block" style={meta.flip ? { transform: 'scaleX(-1)' } : undefined}>
            {meta.emoji}
          </span>
        </motion.div>
      </div>
      <span className="shrink-0 font-mono text-xs font-semibold tnum text-ink">{percent}%</span>
    </div>
  );
}

export function LoanProgress({ type, percent, size = 'sm' }) {
  const { design } = useDesign();
  if (percent == null) return null;
  if (design === 'vivid') {
    return <VividLoanProgress type={type} percent={Math.min(Math.max(percent, 0), 100)} size={size} />;
  }
  const pct = Math.min(Math.max(percent, 0), 100);
  const shape = TRACK_BY_TYPE[type] ?? 'bar';
  const icon = loanTypeIcon(type);
  const dims = size === 'lg' ? { height: 8, ring: 60 } : { height: 5, ring: 38 };

  return (
    <div className="flex items-center gap-3">
      {shape === 'ring' ? (
        <RingTrack icon={icon} percent={pct} size={dims.ring} />
      ) : (
        <LinearTrack icon={icon} percent={pct} height={dims.height} road={shape === 'road'} />
      )}
      <span className="shrink-0 font-mono text-xs tnum text-muted">{pct}%</span>
    </div>
  );
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MILESTONE = {
  start: '🌱 Just getting started',
  quarter: '💪 A quarter down',
  half: '🎉 Over halfway',
  stretch: '🏆 Home stretch',
};

/**
 * Vivid's "thoughts" for one loan (D140), as a row of chips — every
 * one read off the loan's own data by loanInsightsFor, formatted here
 * so money goes through formatMoney (and privacy mode) like everywhere
 * else. Renders nothing in Classic, so callers can drop it in freely.
 */
export function LoanInsights({ loan, percent }) {
  const { design } = useDesign();
  if (design !== 'vivid') return null;

  const i = loanInsightsFor(loan, percent);
  const chips = [];
  if (i.monthsLeft != null) chips.push(`🗓️ ${i.monthsLeft} month${i.monthsLeft === 1 ? '' : 's'} to go`);
  if (i.payoffDate) {
    const [y, m] = i.payoffDate.split('-').map(Number);
    chips.push(`🏁 Paid off by ${SHORT_MONTHS[m - 1]} ${y}`);
  }
  if (i.monthlyCents != null) chips.push(`💸 ${formatMoney(i.monthlyCents)}/month`);
  if (i.daysLeft != null) chips.push(i.daysLeft === 0 ? '⏳ Promo has ended' : `⏳ ${i.daysLeft} days until the promo ends`);
  if (i.neededCents != null) chips.push(`🎯 ≈ ${formatMoney(i.neededCents)}/month clears it in time`);
  if (i.milestone) chips.push(MILESTONE[i.milestone]);
  if (chips.length === 0) return null;

  return (
    <ul className="flex flex-wrap gap-1.5">
      {chips.map((text, n) => (
        <motion.li
          key={text}
          className="rounded-full border border-rule bg-raised/80 px-2.5 py-1 text-xs text-ink"
          initial={{ opacity: 0, y: 6, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ delay: 0.5 + n * 0.08, type: 'spring', stiffness: 260, damping: 18 }}
        >
          {text}
        </motion.li>
      ))}
    </ul>
  );
}
