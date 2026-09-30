import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, animate, motion, useMotionValue, useSpring } from 'motion/react';
import { api, formatMoney } from '../../api';
import { C_MAJOR, PENTATONIC, chord, note, setSoundEnabled, soundEnabled, tick, whoosh } from '../../sound';
import {
  UploadDemo, ReviewDemo, MixDemo, RecurringDemo, LoanDemo,
  CardsDemo, CashbackDemo, HistoryDemo, HouseholdDemo, PrivacyDemo,
} from './FeatureDemos';

/**
 * The Vivid cover page (D153). Classic's Welcome stays as it was; this
 * one is a short, scored intro: a four-colour mark assembles, the
 * wordmark drops in letter by letter (one note of a C major scale
 * each), this year's figures count up, then ten small feature boxes
 * fly in from scattered positions — each one acting out its feature —
 * and the button pops in last on a chord.
 *
 * Every sound is synthesized (sound.js) and silent until the page has
 * had a click, which is what browsers require; "Replay intro" is both
 * the replay and the natural first click.
 */

const FEATURES = [
  { emoji: '📥', title: 'Statements', info: 'PDF or CSV, years of them', tint: 'bg-vivid-amber/15', dot: 'bg-vivid-amber', Demo: UploadDemo },
  { emoji: '✅', title: 'Review first', info: 'Nothing saves until you approve it', tint: 'bg-vivid-green/15', dot: 'bg-vivid-green', Demo: ReviewDemo },
  { emoji: '🥧', title: 'Spend mix', info: 'Every month, by category', tint: 'bg-vivid-red/10', dot: 'bg-vivid-red', Demo: MixDemo },
  { emoji: '🔁', title: 'Recurring', info: 'Bills found for you, flagged when late', tint: 'bg-vivid-teal/15', dot: 'bg-vivid-teal', Demo: RecurringDemo },
  { emoji: '🚗', title: 'Loans', info: 'See how close each payoff is', tint: 'bg-vivid-blue/10', dot: 'bg-vivid-blue', Demo: LoanDemo },
  { emoji: '💳', title: 'Cards', info: 'Each card, its statements and spend', tint: 'bg-vivid-purple/10', dot: 'bg-vivid-purple', Demo: CardsDemo },
  { emoji: '🎁', title: 'Cashback', info: 'Read off the statement, never guessed', tint: 'bg-vivid-green/10', dot: 'bg-vivid-green', Demo: CashbackDemo },
  { emoji: '🧾', title: 'History', info: 'Every edit, from → to', tint: 'bg-vivid-pink/10', dot: 'bg-vivid-pink', Demo: HistoryDemo },
  { emoji: '👨‍👩‍👧', title: 'Household', info: 'Everyone, one shared ledger', tint: 'bg-vivid-amber/10', dot: 'bg-vivid-amber', Demo: HouseholdDemo },
  { emoji: '🔒', title: 'Privacy', info: 'Hide amounts in one click', tint: 'bg-vivid-blue/15', dot: 'bg-vivid-blue', Demo: PrivacyDemo },
];

const MARK = [
  ['bg-vivid-green', -40, -40],
  ['bg-vivid-red', 40, -40],
  ['bg-vivid-amber', -40, 40],
  ['bg-vivid-blue', 40, 40],
];

// The script, in seconds — one place to retime the whole intro.
const LETTERS_AT = 0.7;
const LETTER_GAP = 0.12;
const TAGLINE_AT = 1.9;
const STATS_AT = 2.3;
const BOXES_AT = 2.9;
const BOX_GAP = 0.16;
const CTA_AT = BOXES_AT + FEATURES.length * BOX_GAP + 0.5;
// Each box replays its demo on this beat, offset per box so they never restart together.
const LOOP_MS = 5000;

const spring = { type: 'spring', stiffness: 120, damping: 17 };

/** A figure counting up from zero — this year's real totals. */
function CountUp({ cents, delay }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const controls = animate(0, cents, { duration: 2, delay, ease: [0.16, 1, 0.3, 1], onUpdate: (v) => setShown(Math.round(v)) });
    return () => controls.stop();
  }, [cents, delay]);
  return <span className="font-mono tnum">{formatMoney(shown)}</span>;
}

/** A little burst of dots from the emoji tile — plays once per hover. */
function Sparkles({ dot }) {
  return (
    <span className="pointer-events-none absolute left-7 top-7" aria-hidden="true">
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
        const a = (i / 8) * Math.PI * 2;
        return (
          <motion.span
            key={i}
            className={`absolute size-2 rounded-full ${dot}`}
            initial={{ x: 0, y: 0, scale: 1, opacity: 1 }}
            animate={{ x: Math.cos(a) * 42, y: Math.sin(a) * 42, scale: 0, opacity: 0 }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
          />
        );
      })}
    </span>
  );
}

/**
 * One feature box: flies in from a scattered spot, then loops its demo.
 * Hover tilts it toward the cursor, wiggles the emoji, bursts sparkles
 * and replays the demo from the top.
 */
function FeatureBox({ feature, index, leaving }) {
  const { emoji, title, info, tint, dot, Demo } = feature;
  const [demoKey, setDemoKey] = useState(0);
  const [hovered, setHovered] = useState(false);

  // Keep the demo alive: replay it every LOOP_MS once the intro is done.
  useEffect(() => {
    let loop;
    const start = setTimeout(() => {
      loop = setInterval(() => setDemoKey((k) => k + 1), LOOP_MS);
    }, (CTA_AT + index * 0.45) * 1000);
    return () => {
      clearTimeout(start);
      clearInterval(loop);
    };
  }, [index]);
  const rx = useSpring(useMotionValue(0), { stiffness: 200, damping: 18 });
  const ry = useSpring(useMotionValue(0), { stiffness: 200, damping: 18 });
  // Scattered but deterministic, so every replay flies in the same way.
  const from = { x: ((index * 137) % 240) - 120, y: ((index * 89) % 120) + 80, rotate: ((index * 53) % 30) - 15 };

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    ry.set(((e.clientX - r.left) / r.width - 0.5) * 14);
    rx.set(-((e.clientY - r.top) / r.height - 0.5) * 14);
  };
  const onEnter = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    tick(((r.left + r.width / 2) / window.innerWidth) * 2 - 1);
    setDemoKey((k) => k + 1);
    setHovered(true);
  };
  const onLeave = () => {
    setHovered(false);
    rx.set(0);
    ry.set(0);
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.6, ...from }}
      animate={leaving ? { opacity: 0, scale: 0.85, y: -24, x: 0, rotate: 0 } : { opacity: 1, scale: 1, x: 0, y: 0, rotate: 0 }}
      transition={leaving ? { duration: 0.3, delay: index * 0.025 } : { ...spring, delay: BOXES_AT + index * BOX_GAP }}
      whileHover={{ y: -6, scale: 1.03 }}
      style={{ rotateX: rx, rotateY: ry, transformPerspective: 600 }}
      onMouseMove={onMove}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      className="relative rounded-2xl bg-raised shadow-sm transition-shadow duration-300 hover:shadow-lg"
    >
      <AnimatePresence>{hovered && <Sparkles key={demoKey} dot={dot} />}</AnimatePresence>
      {/* Opaque underneath, so the drifting bands never show through the tint. */}
      <div className={`flex h-full flex-col rounded-2xl p-3.5 text-left ${tint}`}>
        <div className="flex items-center gap-2">
          <motion.span
            className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-raised text-base leading-none shadow-sm"
            animate={hovered ? { rotate: [0, -14, 12, -8, 0], scale: 1.2 } : { rotate: 0, scale: 1 }}
            transition={hovered ? { rotate: { duration: 0.9, repeat: Infinity, repeatDelay: 0.5 }, scale: spring } : { duration: 0.25 }}
            aria-hidden="true"
          >
            {emoji}
          </motion.span>
          <span className="text-sm font-semibold text-ink">{title}</span>
        </div>
        <div className="my-2" aria-hidden="true">
          <Demo key={demoKey} />
        </div>
        <p className="text-xs leading-snug text-muted">{info}</p>
      </div>
    </motion.div>
  );
}

export function VividWelcome({ hasData, loaded }) {
  const navigate = useNavigate();
  const [run, setRun] = useState(0);
  const [soundOn, setSoundOn] = useState(soundEnabled);
  const [leaving, setLeaving] = useState(false);
  const [ytd, setYtd] = useState(null);

  // This year so far, for the count-up chips. Only once there's data.
  useEffect(() => {
    if (!hasData) return;
    let cancelled = false;
    api
      .summary(new Date().toISOString().slice(0, 7))
      .then((s) => {
        if (cancelled) return;
        setYtd({
          earned: Number(s.spend.year_to_date_income_cents ?? 0),
          spent: Math.abs(Number(s.spend.year_to_date_spend_cents ?? 0)),
          saved: Number(s.savings?.year_to_date_savings_cents ?? 0),
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [hasData]);

  // The score, scheduled on the audio clock so it stays in time with the motion.
  useEffect(() => {
    C_MAJOR.forEach((f, i) => note(f, { delay: LETTERS_AT + i * LETTER_GAP, type: 'triangle', gain: 0.04 }));
    whoosh({ delay: BOXES_AT - 0.15, dur: 0.6, gain: 0.05 });
    FEATURES.forEach((_, i) =>
      note(PENTATONIC[(i * 3) % PENTATONIC.length], { delay: BOXES_AT + i * BOX_GAP, gain: 0.03, pan: ((i % 5) / 4) * 1.6 - 0.8 }),
    );
    chord([523.25, 659.25, 783.99, 1046.5], { delay: CTA_AT, dur: 0.6, gain: 0.035 });
  }, [run]);

  const toggleSound = () => {
    setSoundEnabled(!soundOn);
    setSoundOn(!soundOn);
  };

  const go = () => {
    whoosh({ dur: 0.45 });
    setLeaving(true);
    setTimeout(() => navigate(hasData ? '/overview' : '/import'), 500);
  };

  const year = new Date().getFullYear();
  const stats = ytd && [
    { label: `Earned in ${year}`, cents: ytd.earned, tone: 'bg-vivid-green/15 text-vivid-green' },
    { label: 'Spent', cents: ytd.spent, tone: 'bg-vivid-red/10 text-vivid-loss' },
    { label: 'Saved', cents: ytd.saved, tone: 'bg-vivid-purple/10 text-vivid-purple' },
  ];

  return (
    <div className="relative min-h-screen overflow-hidden bg-paper px-4 pt-16 pb-12 sm:px-6 sm:pt-12">
      {/* Greenbar bands, drifting — the ledger paper the app is named after. */}
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        {[12, 38, 64, 90].map((top, i) => (
          <motion.div
            key={top}
            className="absolute -left-1/4 h-16 w-[150%] bg-band/70"
            style={{ top: `${top}%` }}
            animate={{ x: i % 2 ? ['0%', '-6%'] : ['-6%', '0%'] }}
            transition={{ duration: 18 + i * 3, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' }}
          />
        ))}
      </div>

      <div className="fixed right-4 top-4 z-10 flex gap-2">
        <button
          onClick={() => setRun((r) => r + 1)}
          className="rounded-full bg-raised px-3.5 py-2 text-sm text-muted shadow-sm transition-colors hover:text-ink"
        >
          ↺ Replay intro
        </button>
        <button
          onClick={toggleSound}
          aria-label={soundOn ? 'Mute sound' : 'Unmute sound'}
          aria-pressed={soundOn}
          className="flex size-9 items-center justify-center rounded-full bg-raised shadow-sm"
        >
          {soundOn ? '🔊' : '🔇'}
        </button>
      </div>

      <div key={run} className="relative mx-auto flex w-full max-w-5xl flex-col items-center text-center">
        <div className="grid grid-cols-2 gap-1" aria-hidden="true">
          {MARK.map(([bg, x, y], i) => (
            <motion.span
              key={bg}
              className={`size-4 rounded-[5px] ${bg}`}
              initial={{ x, y, rotate: 90, opacity: 0 }}
              animate={{ x: 0, y: 0, rotate: 0, opacity: 1 }}
              transition={{ ...spring, delay: 0.1 + i * 0.12 }}
            />
          ))}
        </div>

        <h1 className="mt-4 flex text-6xl font-semibold tracking-tight text-ink sm:text-7xl" aria-label="cashflow">
          {[...'cashflow'].map((ch, i) => (
            <motion.span
              key={i}
              aria-hidden="true"
              initial={{ y: -60, opacity: 0, rotate: -8 }}
              animate={{ y: 0, opacity: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 220, damping: 13, delay: LETTERS_AT + i * LETTER_GAP }}
            >
              {ch}
            </motion.span>
          ))}
        </h1>

        <motion.p
          className="mt-3 text-lg text-muted sm:text-xl"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: TAGLINE_AT, duration: 0.7 }}
        >
          Every account in the household, on one page.
        </motion.p>

        {stats && (
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {stats.map((s, i) => (
              <motion.div
                key={s.label}
                className={`flex items-baseline gap-2 rounded-full px-4 py-1.5 text-sm ${s.tone}`}
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ ...spring, delay: STATS_AT + i * 0.1 }}
              >
                <span className="text-xs text-muted">{s.label}</span>
                <span className="font-semibold">
                  <CountUp cents={s.cents} delay={STATS_AT + i * 0.1} />
                </span>
              </motion.div>
            ))}
          </div>
        )}

        <div className="mt-10 grid w-full grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {FEATURES.map((f, i) => (
            <FeatureBox key={f.title} feature={f} index={i} leaving={leaving} />
          ))}
        </div>

        <motion.div
          className="mt-10"
          initial={{ opacity: 0, scale: 0.5 }}
          animate={leaving ? { opacity: 0, scale: 0.9 } : { opacity: 1, scale: 1 }}
          transition={leaving ? { duration: 0.25 } : { type: 'spring', stiffness: 200, damping: 11, delay: CTA_AT }}
        >
          <motion.button
            onClick={go}
            disabled={!loaded || leaving}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="rounded-2xl bg-vivid-green px-10 py-4 text-base font-semibold text-white shadow-md disabled:cursor-not-allowed disabled:opacity-40"
          >
            {hasData ? 'Open my cashflow' : 'Upload your first statement'}
          </motion.button>
        </motion.div>
      </div>
    </div>
  );
}
