import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { animate, motion, useMotionTemplate, useMotionValue, useSpring, useTransform } from 'motion/react';
import { api, formatMoney } from '../../api';
import { chord, note, setSoundEnabled, soundEnabled, whoosh } from '../../sound';
import { CategoryGlyph } from '../../category-icons';
import { AppearanceToggle } from '../AppearanceToggle';
import { pickWalletCards } from '../../wallet-pick';
import { accountArt, accountKind } from '../../account-art';

/**
 * The Glass design's intro (D235, richer in D238): a short keynote-style
 * story told with Apple's materials and springs.
 *
 *   Hero      A frosted pane clears to reveal the scene. One liquid orb
 *             splits into the four-square mark, which sends out a lens
 *             ripple; "cashflow" flips up letter by letter out of a blur,
 *             then a shimmer crosses it. A soft spotlight and the colour
 *             blooms follow the pointer (parallax).
 *   Wallet    The household's own cards (their photos, or their colours)
 *             fan out from a stack and lean with the pointer.
 *   Year      Glass panels count up this year's totals and draw each
 *             month's line as they scroll into view.
 *   Features  Tiles rise into place in depth; each leans toward the
 *             pointer, catches light, and runs a glowing edge on hover.
 *   Finish    A magnetic capsule. Pressing it opens a blue lens from the
 *             button that fills the screen, then lands on Overview.
 *
 * Springs are critically damped except where something lands with
 * momentum (the card fan). Reduced motion (MotionConfig, App.jsx) drops
 * the movement and keeps the fades; the blooms' drift stops too.
 */

const FEATURES = [
  { icon: 'tray-down', color: '#FF9500', title: 'Statements', info: 'PDF or CSV, read on this computer' },
  { icon: 'shield', color: '#34C759', title: 'Review first', info: 'Nothing saves until you approve it' },
  { icon: 'cart', color: '#FF3B30', title: 'Spend mix', info: 'Every month, by category' },
  { icon: 'refresh', color: '#30B0C7', title: 'Recurring', info: 'Bills found for you, flagged when late' },
  { icon: 'bank', color: '#007AFF', title: 'Loans', info: 'How close each payoff is' },
  { icon: 'card', color: '#AF52DE', title: 'Cards', info: 'Each card, its statements and spend' },
];

const MARK = [
  ['#34C759', -1, -1],
  ['#FF9F0A', 1, -1],
  ['#007AFF', -1, 1],
  ['#FF3B30', 1, 1],
];

// The script, in seconds: one place to retime the hero.
const FROST_CLEARS = 0.1;
const ORB_AT = 0.35;
const SPLIT_AT = 0.95;
const RIPPLE_AT = 1.4;
const WORD_AT = 1.25;
const LETTER_GAP = 0.055;
const SHIMMER_AT = 2.3;
const TAGLINE_AT = 1.95;
const FAN_AT = 2.5;

const settle = { type: 'spring', bounce: 0, duration: 0.7 };
const landed = { type: 'spring', bounce: 0.28, duration: 0.9 }; // the fan carries momentum
const materialize = (delay) => ({
  initial: { opacity: 0, y: 14, scale: 0.97, filter: 'blur(10px)' },
  animate: { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' },
  transition: { ...settle, delay },
});
const inView = (delay = 0) => ({
  initial: { opacity: 0, y: 40, rotateX: 18, filter: 'blur(12px)' },
  whileInView: { opacity: 1, y: 0, rotateX: 0, filter: 'blur(0px)' },
  viewport: { once: true, amount: 0.35 },
  transition: { ...settle, delay },
});

function CountUp({ cents, start }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!start) return undefined;
    const controls = animate(0, cents, { duration: 1.6, ease: [0.16, 1, 0.3, 1], onUpdate: (v) => setShown(Math.round(v)) });
    return () => controls.stop();
  }, [cents, start]);
  return <span className="tnum">{formatMoney(shown)}</span>;
}

/** A month-by-month line that draws itself in. */
function Spark({ values, color, start }) {
  const w = 220;
  const h = 44;
  if (values.length < 2) return null;
  const max = Math.max(...values.map(Math.abs), 1);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 4 - (Math.abs(v) / max) * (h - 8)]);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-3 h-11 w-full overflow-visible" aria-hidden="true">
      <motion.path d={`${d} L${w} ${h} L0 ${h} Z`} fill={color} initial={{ opacity: 0 }} animate={{ opacity: start ? 0.12 : 0 }} transition={{ duration: 1, delay: 0.6 }} />
      <motion.path d={d} fill="none" stroke={color} strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round"
        initial={{ pathLength: 0 }} animate={{ pathLength: start ? 1 : 0 }} transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1] }} />
      <motion.circle cx={pts.at(-1)[0]} cy={pts.at(-1)[1]} r="3.5" fill={color} initial={{ scale: 0 }} animate={{ scale: start ? 1 : 0 }} transition={{ ...landed, delay: 1.3 }} />
    </svg>
  );
}

function StatPanel({ stat, delay }) {
  const [seen, setSeen] = useState(false);
  return (
    <motion.div {...inView(delay)} onViewportEnter={() => setSeen(true)} style={{ transformPerspective: 900 }} className="welcome-glass rounded-[24px] p-5 text-left">
      <p className="text-sm text-muted">{stat.label}</p>
      <p className="mt-1 text-[1.75rem] font-semibold tracking-[-0.025em]" style={{ color: stat.color }}>
        <CountUp cents={stat.cents} start={seen} />
      </p>
      <Spark values={stat.series} color={stat.color} start={seen} />
    </motion.div>
  );
}

/** A glass tile that leans toward the pointer, catches light, and runs a glowing edge on hover. */
function Tile({ feature, delay, index }) {
  const ref = useRef(null);
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const rotateX = useSpring(useTransform(py, [0, 1], [7, -7]), { bounce: 0, duration: 0.4 });
  const rotateY = useSpring(useTransform(px, [0, 1], [-8, 8]), { bounce: 0, duration: 0.4 });
  const glow = useSpring(0, { bounce: 0, duration: 0.3 });
  const sheen = useTransform([px, py], ([x, y]) => `radial-gradient(16rem circle at ${x * 100}% ${y * 100}%, rgb(255 255 255 / 0.35), transparent 60%)`);
  const [hover, setHover] = useState(false);

  const track = (e) => {
    const r = ref.current.getBoundingClientRect();
    px.set((e.clientX - r.left) / r.width);
    py.set((e.clientY - r.top) / r.height);
  };

  return (
    <motion.div {...inView(delay)} onViewportEnter={() => note([659.25, 783.99, 880, 987.77, 1046.5, 1174.66][index], { gain: 0.016, pan: (index % 3) * 0.6 - 0.6 })} style={{ perspective: 900 }}>
      <motion.div
        ref={ref}
        onPointerMove={track}
        onPointerEnter={() => { setHover(true); glow.set(1); }}
        onPointerLeave={() => { setHover(false); glow.set(0); px.set(0.5); py.set(0.5); }}
        whileTap={{ scale: 0.97 }}
        style={{ rotateX, rotateY, transformStyle: 'preserve-3d' }}
        className={`welcome-glass edge-glow relative h-full overflow-hidden rounded-[24px] p-6 text-left ${hover ? 'is-lit' : ''}`}
      >
        <motion.div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ backgroundImage: sheen, opacity: glow }} />
        <motion.span
          className="relative flex size-12 items-center justify-center rounded-[14px] text-white shadow-lg"
          style={{ backgroundColor: feature.color, translateZ: 30 }}
          animate={hover ? { scale: 1.12, rotate: -6 } : { scale: 1, rotate: 0 }}
          transition={{ type: 'spring', bounce: 0.45, duration: 0.5 }}
        >
          <CategoryGlyph iconKey={feature.icon} size={22} />
        </motion.span>
        <p className="relative mt-5 text-lg font-semibold tracking-[-0.015em] text-ink" style={{ transform: 'translateZ(20px)' }}>{feature.title}</p>
        <p className="relative mt-1 text-sm leading-snug text-muted">{feature.info}</p>
      </motion.div>
    </motion.div>
  );
}

/** The household's cards, fanned like Wallet, leaning with the pointer. */
function WalletFan({ cards, tiltX, tiltY }) {
  const n = cards.length;
  return (
    <motion.div className="relative mx-auto mt-14 h-52 w-full max-w-xl" style={{ perspective: 1200, rotateX: tiltX, rotateY: tiltY }} aria-hidden="true">
      {cards.map((c, i) => {
        const mid = (n - 1) / 2;
        const off = i - mid;
        return (
          <motion.div
            key={c.id}
            className="absolute left-1/2 top-0 h-48 w-[19rem] -ml-[9.5rem] overflow-hidden rounded-[20px] text-white shadow-[0_24px_60px_-20px_rgb(0_0_0/0.5)]"
            style={{ ...c.style, zIndex: n - Math.abs(Math.round(off)) }}
            initial={{ opacity: 0, y: 80, rotate: 0, x: 0, scale: 0.9 }}
            animate={{ opacity: 1, y: Math.abs(off) * 14, rotate: off * 9, x: off * 120, scale: 1 - Math.abs(off) * 0.04 }}
            transition={{ ...landed, delay: FAN_AT + i * 0.07 }}
          >
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
            {c.logo && (
              <span className="absolute right-4 top-4 flex h-8 items-center rounded-md bg-white/95 px-2 shadow-sm">
                <img src={c.logo} alt="" className="h-5 w-auto max-w-20 object-contain" />
              </span>
            )}
            {c.kind && <span className="absolute left-4 top-4 text-xs font-semibold uppercase tracking-[0.12em] text-white/85">{c.kind}</span>}
            <motion.div
              className="absolute inset-y-0 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-white/40 to-transparent"
              initial={{ x: '-150%' }}
              animate={{ x: '400%' }}
              transition={{ duration: 1.1, delay: FAN_AT + 0.7 + i * 0.12, ease: 'easeInOut' }}
            />
            <div className="absolute inset-x-4 bottom-3 flex items-end justify-between">
              <span className="truncate pr-3 text-sm font-semibold drop-shadow">{c.name}</span>
              <span className="text-xs font-medium tracking-wider opacity-90">•• {c.mask}</span>
            </div>
          </motion.div>
        );
      })}
    </motion.div>
  );
}

export function GlassWelcome({ hasData, loaded, accounts = [] }) {
  const navigate = useNavigate();
  const [soundOn, setSoundOn] = useState(soundEnabled);
  const [summary, setSummary] = useState(null);
  const [dive, setDive] = useState(null); // { x, y } of the button when leaving
  const ctaRef = useRef(null);

  // The pointer, as -0.5..0.5 across the window: drives the spotlight, the
  // blooms' parallax and the wallet's lean.
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const sx = useSpring(mx, { bounce: 0, duration: 0.8 });
  const sy = useSpring(my, { bounce: 0, duration: 0.8 });
  const spotX = useTransform(sx, (v) => `${(v + 0.5) * 100}%`);
  const spotY = useTransform(sy, (v) => `${(v + 0.5) * 100}%`);
  const spotlight = useMotionTemplate`radial-gradient(38rem circle at ${spotX} ${spotY}, rgb(255 255 255 / 0.10), transparent 65%)`;
  const tiltX = useTransform(sy, [-0.5, 0.5], [8, -8]);
  const tiltY = useTransform(sx, [-0.5, 0.5], [-10, 10]);
  const bloomX = useTransform(sx, [-0.5, 0.5], [40, -40]);
  const bloomY = useTransform(sy, [-0.5, 0.5], [30, -30]);

  // The CTA leans toward the pointer when it's near (magnetic).
  const ctaX = useSpring(0, { bounce: 0.3, duration: 0.5 });
  const ctaY = useSpring(0, { bounce: 0.3, duration: 0.5 });

  const onMove = (e) => {
    mx.set(e.clientX / window.innerWidth - 0.5);
    my.set(e.clientY / window.innerHeight - 0.5);
    const b = ctaRef.current?.getBoundingClientRect();
    if (b) {
      const dx = e.clientX - (b.left + b.width / 2);
      const dy = e.clientY - (b.top + b.height / 2);
      const near = Math.hypot(dx, dy) < 160;
      ctaX.set(near ? dx * 0.18 : 0);
      ctaY.set(near ? dy * 0.25 : 0);
    }
  };

  useEffect(() => {
    if (!hasData) return undefined;
    let cancelled = false;
    api.summary(new Date().toISOString().slice(0, 7)).then((s) => !cancelled && setSummary(s)).catch(() => {});
    return () => { cancelled = true; };
  }, [hasData]);

  // The score, on the motion's beats.
  useEffect(() => {
    chord([392, 523.25, 659.25], { delay: SPLIT_AT, dur: 0.6, gain: 0.03 });
    note(1046.5, { delay: RIPPLE_AT, dur: 0.4, gain: 0.02, type: 'triangle' });
    whoosh({ delay: FAN_AT - 0.1, dur: 0.6, gain: 0.04 });
  }, []);

  // Apple Card in the middle, one card per company, a spread of kinds (D239).
  const cards = useMemo(() => pickWalletCards(accounts).map((a) => ({
    id: a.id,
    name: a.name,
    mask: a.mask ?? '····',
    kind: accountKind(a),
    ...accountArt(a),
  })), [accounts]);

  const year = new Date().getFullYear();
  const stats = summary && (() => {
    const months = summary.income_by_month ?? [];
    const spend = summary.spend_by_month ?? [];
    const income = months.map((m) => Number(m.income_cents ?? 0));
    const out = spend.map((m) => Math.abs(Number(m.spend_cents ?? 0)));
    return [
      { label: `Earned in ${year}`, cents: Number(summary.spend.year_to_date_income_cents ?? 0), color: 'var(--color-earn)', series: income },
      { label: `Spent in ${year}`, cents: Math.abs(Number(summary.spend.year_to_date_spend_cents ?? 0)), color: 'var(--color-spend)', series: out },
      { label: 'Put aside', cents: Number(summary.savings?.year_to_date_savings_cents ?? 0), color: 'var(--color-info)', series: income.map((v, i) => Math.max(0, v - (out[i] ?? 0))) },
    ];
  })();

  const go = () => {
    const b = ctaRef.current.getBoundingClientRect();
    whoosh({ dur: 0.5, gain: 0.05 });
    chord([523.25, 783.99, 1046.5], { dur: 0.5, gain: 0.03 });
    setDive({ x: b.left + b.width / 2, y: b.top + b.height / 2 });
    setTimeout(() => navigate(hasData ? '/overview' : '/import'), 650);
  };

  const toggleSound = () => { setSoundEnabled(!soundOn); setSoundOn(!soundOn); };

  return (
    <div className="relative min-h-screen overflow-x-hidden" onPointerMove={onMove}>
      {/* Light behind the glass: blooms that drift slowly and lean away from the pointer. */}
      <motion.div aria-hidden="true" className="pointer-events-none fixed inset-0" style={{ x: bloomX, y: bloomY }}>
        {[['#34C759', '10%', '6%', 0], ['#AF52DE', '82%', '2%', 1], ['#007AFF', '50%', '62%', 2], ['#FF9F0A', '90%', '70%', 3]].map(([c, x, y, i]) => (
          <motion.div
            key={c}
            className="glass-bloom absolute size-[36rem] rounded-full"
            style={{ left: x, top: y, x: '-50%', background: c, filter: 'blur(130px)', animationDelay: `${i * -6}s` }}
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 0.24, scale: 1 }}
            transition={{ duration: 2.4, delay: 0.2 + i * 0.15, ease: [0.16, 1, 0.3, 1] }}
          />
        ))}
      </motion.div>
      <motion.div aria-hidden="true" className="pointer-events-none fixed inset-0" style={{ backgroundImage: spotlight }} />

      {/* The opening: frosted glass that clears. */}
      <motion.div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-30"
        initial={{ backdropFilter: 'blur(40px) saturate(1.8)', WebkitBackdropFilter: 'blur(40px) saturate(1.8)', backgroundColor: 'rgb(var(--g-tint) / 0.7)' }}
        animate={{ backdropFilter: 'blur(0px) saturate(1)', WebkitBackdropFilter: 'blur(0px) saturate(1)', backgroundColor: 'rgb(var(--g-tint) / 0)' }}
        transition={{ duration: 1.3, delay: FROST_CLEARS, ease: [0.4, 0, 0.2, 1] }}
      />

      <div className="absolute right-4 top-4 z-20 flex items-center gap-1 rounded-full welcome-glass p-1">
        <AppearanceToggle />
        <button
          type="button"
          onClick={toggleSound}
          aria-label={soundOn ? 'Mute the intro' : 'Play the intro sound'}
          className="flex size-9 items-center justify-center rounded-full text-muted transition-colors hover:text-ink"
        >
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2.5 6h2.5L8.5 3v10L5 10H2.5z" />
            {soundOn ? <path d="M11 5.5a3.5 3.5 0 010 5M12.8 3.8a6 6 0 010 8.4" /> : <path d="M11 6l3 4M14 6l-3 4" />}
          </svg>
        </button>
      </div>

      {/* ---------------- Hero ---------------- */}
      <section className="relative flex min-h-screen flex-col items-center justify-center px-5 pb-10 pt-20 text-center">
        {/* The mark: one liquid orb splits into four squares, then a lens ripple. */}
        <div className="relative size-[4.5rem]" aria-hidden="true">
          {MARK.map(([color, dx, dy]) => (
            <motion.span
              key={color}
              className="absolute size-8"
              style={{ backgroundColor: color, left: '50%', top: '50%', marginLeft: -16, marginTop: -16 }}
              initial={{ x: 0, y: 0, scale: 0, borderRadius: '50%', filter: 'blur(8px)', opacity: 0.9 }}
              animate={{
                x: [0, 0, dx * 19],
                y: [0, 0, dy * 19],
                scale: [0, 1.5, 1],
                borderRadius: ['50%', '50%', '9px'],
                filter: ['blur(8px)', 'blur(2px)', 'blur(0px)'],
                opacity: 1,
              }}
              transition={{ duration: 1.1, delay: ORB_AT, times: [0, 0.45, 1], ease: [0.2, 0.9, 0.3, 1] }}
            />
          ))}
          {[0, 1].map((k) => (
            <motion.span
              key={k}
              className="absolute inset-0 rounded-[18px] border-2 border-white/70"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: [0.9, 2.6], opacity: [0.8, 0] }}
              transition={{ duration: 1.2, delay: RIPPLE_AT + k * 0.25, ease: 'easeOut' }}
            />
          ))}
          <motion.span
            className="pointer-events-none absolute inset-0 overflow-hidden rounded-[14px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 0] }}
            transition={{ duration: 1, delay: RIPPLE_AT + 0.2, times: [0, 0.4, 1] }}
          >
            <motion.span
              className="absolute inset-y-0 w-1/2 -skew-x-12 bg-gradient-to-r from-transparent via-white/80 to-transparent"
              initial={{ x: '-120%' }}
              animate={{ x: '260%' }}
              transition={{ duration: 1, delay: RIPPLE_AT + 0.2, ease: 'easeInOut' }}
            />
          </motion.span>
        </div>

        {/* The wordmark flips up out of a blur, then a shimmer crosses it. */}
        <h1 className="relative mt-8 text-[4.5rem] font-semibold leading-none tracking-[-0.05em] text-ink sm:text-[6.5rem]" style={{ perspective: 600 }} aria-label="cashflow">
          <span className="flex" aria-hidden="true">
            {'cashflow'.split('').map((ch, i) => (
              <motion.span
                key={i}
                className="inline-block origin-bottom"
                initial={{ opacity: 0, y: 40, rotateX: -85, filter: 'blur(14px)' }}
                animate={{ opacity: 1, y: 0, rotateX: 0, filter: 'blur(0px)' }}
                transition={{ type: 'spring', bounce: 0.2, duration: 0.9, delay: WORD_AT + i * LETTER_GAP }}
              >
                {ch}
              </motion.span>
            ))}
          </span>
          <motion.span
            aria-hidden="true"
            className="wordmark-shimmer pointer-events-none absolute inset-0"
            initial={{ backgroundPosition: '-60% 0', opacity: 1 }}
            animate={{ backgroundPosition: '220% 0', opacity: [1, 1, 0] }}
            transition={{ duration: 1.4, delay: SHIMMER_AT, ease: 'easeInOut', opacity: { duration: 1.6, delay: SHIMMER_AT, times: [0, 0.85, 1] } }}
          >
            cashflow
          </motion.span>
        </h1>

        <p className="mt-6 flex max-w-2xl flex-wrap justify-center gap-x-[0.3em] text-xl leading-snug text-muted sm:text-[1.6rem]">
          {'Every account, in one calm place.'.split(' ').map((w, i) => (
            <motion.span key={i} {...materialize(TAGLINE_AT + i * 0.06)}>{w}</motion.span>
          ))}
        </p>
        <motion.p {...materialize(TAGLINE_AT + 0.45)} className="mt-2 text-base text-ink/80 sm:text-lg">
          Read on your computer, never sent anywhere.
        </motion.p>

        {cards.length > 0 && <WalletFan cards={cards} tiltX={tiltX} tiltY={tiltY} />}

        <motion.div
          className="mt-10 flex flex-col items-center gap-1 text-xs text-faint"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: FAN_AT + 1 }}
        >
          Scroll
          <motion.svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
            initial={{ y: 0 }} animate={{ y: [0, 5, 0] }} transition={{ duration: 1.2, delay: FAN_AT + 1, repeat: 2 }} aria-hidden="true">
            <path d="M4 6l4 4 4-4" />
          </motion.svg>
        </motion.div>
      </section>

      {/* ---------------- This year ---------------- */}
      {stats && (
        <section className="relative mx-auto max-w-5xl px-5 py-16">
          <motion.h2 {...inView()} className="text-center text-3xl font-semibold tracking-[-0.03em] text-ink sm:text-4xl">Your {year}, so far.</motion.h2>
          <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-3" style={{ perspective: 1000 }}>
            {stats.map((s, i) => <StatPanel key={s.label} stat={s} delay={i * 0.1} />)}
          </div>
        </section>
      )}

      {/* ---------------- Features ---------------- */}
      <section className="relative mx-auto max-w-5xl px-5 py-16">
        <motion.h2 {...inView()} className="text-center text-3xl font-semibold tracking-[-0.03em] text-ink sm:text-4xl">Everything, in its place.</motion.h2>
        <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => <Tile key={f.title} feature={f} index={i} delay={(i % 3) * 0.08} />)}
        </div>
      </section>

      {/* ---------------- Finish ---------------- */}
      <section className="relative flex flex-col items-center px-5 pb-28 pt-12 text-center">
        <motion.h2 {...inView()} className="max-w-2xl text-4xl font-semibold tracking-[-0.035em] text-ink sm:text-5xl">
          Your money, at a glance.
        </motion.h2>
        <motion.div {...inView(0.1)} className="mt-9">
          <motion.button
            ref={ctaRef}
            type="button"
            onClick={go}
            disabled={!loaded}
            style={{ x: ctaX, y: ctaY }}
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.95 }}
            className="cta-shine relative overflow-hidden rounded-full bg-info px-11 py-5 text-lg font-semibold tracking-[-0.01em] text-white shadow-[0_14px_40px_-10px_rgb(0_113_227/0.7)] disabled:opacity-0"
          >
            {hasData ? 'Open my cashflow' : 'Upload your first statement'}
          </motion.button>
        </motion.div>
      </section>

      {/* Leaving: a blue lens opens from the button and fills the screen. */}
      {dive && (
        <motion.div
          aria-hidden="true"
          className="fixed inset-0 z-40 bg-info"
          initial={{ clipPath: `circle(0px at ${dive.x}px ${dive.y}px)` }}
          animate={{ clipPath: `circle(150vmax at ${dive.x}px ${dive.y}px)` }}
          transition={{ duration: 0.6, ease: [0.7, 0, 0.3, 1] }}
        />
      )}
    </div>
  );
}
