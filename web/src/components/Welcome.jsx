import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MerchantAvatar } from './MerchantAvatar';
import { useDesign } from '../design-context';
import { VividWelcome } from './welcome/VividWelcome';

/**
 * The first thing the app shows, every time — a cover page, not a
 * dashboard. Rebuilt from scratch on direct request for a lot more
 * motion and energy, but deliberately still the app's own light
 * greenbar palette (never dark-mode) and zero new dependencies — a
 * couple of native Web Audio oscillator blips stand in for a real
 * audio library, the same "stdlib before a package" instinct the rest
 * of this codebase follows (D100's login, for instance, is hand-
 * rolled crypto rather than bcrypt/express-session).
 *
 * Sequence: the wordmark drops in large from above, then the subtitle
 * splits into two halves that slide in from opposite sides and meet
 * in the middle — the motion literally acts out "all accounts at one
 * place." Four medium feature cards (Income/Debt/Loans/Savings) each
 * join in from a different edge — left, right, top, bottom — with a
 * strip of real merchant logos across the bottom of each. A recurring-
 * detection banner follows, then the one button, last, with a little
 * more bounce than anything before it since it's the actual payoff.
 *
 * Sound is opt-in and muted by default (the toggle in the corner) —
 * a short tick on card hover, a slightly lower chime on the button.
 */

const strokeProps = { stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' };
const Icon = ({ children, size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" {...strokeProps} aria-hidden="true">{children}</svg>
);

const CARDS = [
  {
    key: 'income', label: 'Income', tone: 'earn', fx: -70, fy: 0,
    body: 'Every paycheck and deposit, credited the month it landed.',
    merchants: ['Chase', 'Apple', 'Google', 'Venmo'],
  },
  {
    key: 'debt', label: 'Debt', tone: 'spend', fx: 70, fy: 0,
    body: 'What you spent, by card and by category.',
    merchants: ['Amazon', 'Target', 'Costco', 'Walmart'],
  },
  {
    key: 'loans', label: 'Loans', tone: 'accent2', fx: 0, fy: -60,
    body: 'Balance and payoff date — a car loan, a balance transfer.',
    merchants: ['Tesla', 'Chase', 'Delta', 'Bank Of America'],
  },
  {
    key: 'savings', label: 'Savings', tone: 'info', fx: 0, fy: 60,
    body: 'What is actually left over, tagged explicitly, not guessed.',
    merchants: ['Bank Of America', 'Chase', 'Apple', 'Paypal'],
  },
];

const TONE_CLASSES = {
  earn: { bar: 'bg-earn', text: 'text-earn' },
  spend: { bar: 'bg-spend', text: 'text-spend' },
  accent2: { bar: 'bg-accent2', text: 'text-accent2' },
  info: { bar: 'bg-info', text: 'text-info' },
};

// The sequence, timed as one script rather than hand-tuned per
// element: wordmark -> subtitle halves -> four cards (staggered) ->
// recurring banner -> button, the finale.
const WORDMARK_DELAY = 0;
const SUBTITLE_DELAY = 500;
const CARDS_START = 1150;
const CARDS_STAGGER = 160;
const BANNER_DELAY = CARDS_START + CARDS.length * CARDS_STAGGER + 250;
const BUTTON_DELAY = BANNER_DELAY + 500;

/** A few tiny oscillator blips — the whole "audio library." `pan`
 * (-1 left to 1 right) gives a left-entering element a sound that
 * actually arrives from the left, and a right-entering one from the
 * right — real stereo, not just a different pitch standing in for it. */
function useBlip() {
  const ctxRef = useRef(null);
  return useCallback((freq, duration, pan = 0) => {
    if (!ctxRef.current) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      ctxRef.current = new AudioCtx();
    }
    const ctx = ctxRef.current;
    if (ctx.state === 'suspended') ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const panner = ctx.createStereoPanner();
    osc.type = 'sine';
    osc.frequency.value = freq;
    panner.pan.value = pan;
    gain.gain.setValueAtTime(0.07, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain).connect(panner).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  }, []);
}

function SoundToggle({ on, onToggle }) {
  return (
    <button
      onClick={onToggle}
      aria-label={on ? 'Mute sound' : 'Unmute sound'}
      aria-pressed={on}
      className="fixed right-5 top-5 flex size-9 items-center justify-center rounded-full border border-rule
                 text-muted transition-colors hover:border-rule-str hover:text-ink"
    >
      {on ? (
        <Icon><path d="M2 6.5h2.5L8 3.5v9L4.5 9.5H2z" /><path d="M10.5 5.5a4 4 0 010 5.5" /><path d="M12.3 3.7a7 7 0 010 8.6" /></Icon>
      ) : (
        <Icon><path d="M2 6.5h2.5L8 3.5v9L4.5 9.5H2z" /><path d="M10.5 5.5l4 5M14.5 5.5l-4 5" /></Icon>
      )}
    </button>
  );
}

function FeatureCard({ label, tone, fx, fy, body, merchants, delay, soundOn, blip }) {
  const { bar, text } = TONE_CLASSES[tone];
  // Pan follows which edge the card actually enters from; a top/bottom
  // card has no left-right motion to echo, so it stays centered.
  const pan = fx < 0 ? -0.7 : fx > 0 ? 0.7 : 0;
  const freq = fy < 0 ? 620 : fy > 0 ? 430 : 520;
  return (
    <div
      className="animate-join-in flex flex-col rounded-xl border border-rule bg-raised p-4 text-left"
      style={{ '--fx': `${fx}px`, '--fy': `${fy}px`, animationDelay: `${delay}ms` }}
      onAnimationStart={() => soundOn && blip(freq, 0.08, pan)}
      onMouseEnter={() => soundOn && blip(760, 0.05)}
    >
      <div className={`h-1 w-8 rounded-full ${bar}`} />
      <p className={`mt-2.5 text-sm font-medium ${text}`}>{label}</p>
      <p className="mt-1 text-xs text-muted">{body}</p>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-rule pt-3">
        {merchants.map((m) => (
          <MerchantAvatar key={m} merchant={m} size={22} clickable={false} />
        ))}
      </div>
    </div>
  );
}

export function Welcome(props) {
  return useDesign().design === 'vivid' ? <VividWelcome {...props} /> : <ClassicWelcome {...props} />;
}

function ClassicWelcome({ hasData, loaded }) {
  const navigate = useNavigate();
  const [soundOn, setSoundOn] = useState(true);
  const blip = useBlip();

  const buttonClick = () => {
    if (soundOn) blip(500, 0.14);
    navigate(hasData ? '/overview' : '/import');
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-raised px-6 py-16">
      <SoundToggle on={soundOn} onToggle={() => setSoundOn((v) => !v)} />

      <div className="mx-auto flex w-full max-w-3xl flex-col items-center text-center">
        <h1
          className="animate-drop-in text-6xl font-medium tracking-tight text-ink sm:text-7xl"
          style={{ animationDelay: `${WORDMARK_DELAY}ms`, '--dy': '-48px' }}
        >
          cashflow
        </h1>

        <p className="mt-4 flex flex-wrap items-center justify-center gap-x-2 text-lg text-muted sm:text-xl">
          <span
            className="animate-join-in inline-block font-medium text-ink"
            style={{ '--fx': '-60px', animationDelay: `${SUBTITLE_DELAY}ms` }}
            onAnimationStart={() => soundOn && blip(440, 0.09, -0.8)}
          >
            All accounts,
          </span>
          <span
            className="animate-join-in inline-block"
            style={{ '--fx': '60px', animationDelay: `${SUBTITLE_DELAY}ms` }}
            onAnimationStart={() => soundOn && blip(660, 0.09, 0.8)}
          >
            at one place.
          </span>
        </p>

        <div className="mt-12 grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
          {CARDS.map((c, i) => (
            <FeatureCard key={c.key} {...c} delay={CARDS_START + i * CARDS_STAGGER} soundOn={soundOn} blip={blip} />
          ))}
        </div>

        <div
          className="animate-drop-in mt-6 flex w-full items-center gap-3 rounded-xl border border-rule bg-band/40 px-5 py-4 text-left"
          style={{ animationDelay: `${BANNER_DELAY}ms` }}
        >
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-raised text-muted">
            <Icon><path d="M2.5 8a5.5 5.5 0 019.5-3.5M13.5 8a5.5 5.5 0 01-9.5 3.5" /><path d="M11 2.5v2.5h-2.5" /><path d="M5 13.5V11h2.5" /></Icon>
          </div>
          <div>
            <p className="text-sm font-medium text-ink">Recurring, detected automatically</p>
            <p className="text-xs text-muted">Subscriptions and bills, found in your history — not entered by hand.</p>
          </div>
        </div>

        <div className="animate-pop-in mt-10" style={{ animationDelay: `${BUTTON_DELAY}ms` }}>
          <button
            onClick={buttonClick}
            disabled={!loaded}
            className="rounded-md bg-ink px-10 py-4 text-base font-medium text-paper
                       transition-colors hover:bg-ink/90 disabled:cursor-not-allowed disabled:opacity-0"
          >
            {hasData ? 'Open my cashflow' : 'Upload your first statement'}
          </button>
        </div>
      </div>
    </div>
  );
}
