import { useEffect, useRef, useState } from 'react';
import { useDesign } from '../../hooks/use-design';
import { useHealth } from '../../hooks/use-health';
import { APPEARANCES } from '../../lib/app/designs';
import { usePrivacy } from '../../hooks/use-privacy';
import { StatusCard } from './StatusCard';

/**
 * Three round icons, bottom-left (D333), the mirror of the assistant and
 * help buttons on the right: the API, the database, and Light / Dark /
 * Auto. They used to be lines at the foot of the sidebar, which scrolled
 * off long pages. The owner picked style C, "Heartbeat"
 * (docs/concepts/status-icons/styles.html), with style A's theme icons: a pulse
 * line runs through the API and goes flat when it stops; the database is
 * three discs that drop onto each other, and come apart when it's down.
 * Greys only, in every design (the owner's call, over a coloured
 * version). Working is quiet; down is faded, dashed and the only state
 * with a pulse ring; going down shakes once, coming back pops. Clicking
 * the API
 * or database opens its own card (StatusCard) with what's behind it;
 * the theme icon steps to the next choice. A fourth icon shows only while
 * Privacy mode is on; clicking it turns Privacy off. All motion is CSS, off under Reduce Motion.
 */

const STATE_WORDS = { ok: 'running', down: 'not reachable', unknown: 'unknown', checking: 'checking…' };

function ApiIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="3.5" />
      <path className="ecg-base" d="M3 12h4l2-4.5 3 9 2.5-6 1.5 1.5h5" strokeLinecap="round" strokeLinejoin="round" opacity="0.3" />
      <path className="ecg" d="M3 12h4l2-4.5 3 9 2.5-6 1.5 1.5h5" strokeLinecap="round" strokeLinejoin="round" />
      <path className="flat" d="M5 12h14" strokeLinecap="round" strokeDasharray="2 2.5" />
    </svg>
  );
}

/** Three discs, bottom one first (disc-1); index.css drops them onto each other. */
function DatabaseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
      {[16.5, 11.5, 6.5].map((y, i) => (
        <g key={y} className={`disc disc-${i + 1}`}>
          <path d={`M5 ${y}v1.6c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V${y}`} />
          <ellipse cx="12" cy={y} rx="7" ry="2.5" fill="var(--color-raised)" />
        </g>
      ))}
    </svg>
  );
}

const THEME_ICON = {
  dark: (
    <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
      <path d="M15.5 12A6.5 6.5 0 018 4.5a6.5 6.5 0 107.5 7.5z" />
      <path className="star star-a" d="M14.5 3.2v2.6M13.2 4.5h2.6" strokeLinecap="round" />
      <circle className="star star-b" cx="17" cy="8" r="0.7" fill="currentColor" stroke="none" />
    </svg>
  ),
  light: (
    <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <circle cx="10" cy="10" r="3.5" />
      <path className="sun-rays" d="M10 2.5v1.8M10 15.7v1.8M2.5 10h1.8M15.7 10h1.8M4.7 4.7l1.3 1.3M14 14l1.3 1.3M4.7 15.3L6 14M14 6l1.3-1.3" />
    </svg>
  ),
  system: (
    <svg className="theme-auto" viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="10" cy="10" r="6.5" />
      <path d="M10 3.5a6.5 6.5 0 010 13z" fill="currentColor" stroke="none" />
    </svg>
  ),
};

/** `state` (ok | checking | down | unknown) drives the colour, pulse and moments in index.css; the theme button has none. */
function RoundButton({ kind, state, label, onClick, expanded, small = false, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-expanded={expanded}
      className={`status-button status-${kind} ${state ? `s-${state}` : ''} relative flex ${small ? 'size-10' : 'size-11'} shrink-0 items-center justify-center rounded-full shadow-lg transition-transform hover:scale-[1.08] active:scale-[0.94] border border-rule-str bg-raised text-ink`}
    >
      {children}
    </button>
  );
}

/** The fourth icon, only while Privacy mode is on: an eye with a slash that blinks now and then. */
function PrivacyIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <g className="privacy-eye">
        <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z" />
        <circle cx="12" cy="12" r="2.6" />
      </g>
      <path className="privacy-slash" d="M4 20L20 4" />
    </svg>
  );
}

/** `narrow` in the phone drawer, where a full-width card would be cut off. */
export function StatusIcons({ className = '', narrow = false }) {
  const health = useHealth();
  const { privacyMode, setPrivacyMode } = usePrivacy();
  const { appearance, setAppearance, theme } = useDesign();
  const [open, setOpen] = useState(null); // 'api' | 'db' | null
  const [caretLeft, setCaretLeft] = useState(16);
  // Four icons (Privacy on) are a size smaller, so the row always fits the sidebar's width.
  const small = privacyMode;
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && setOpen(null);
    const onClick = (e) => !rootRef.current?.contains(e.target) && setOpen(null);
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  const i = APPEARANCES.findIndex((a) => a.value === appearance);
  const current = APPEARANCES[i] ?? APPEARANCES[2];
  const next = APPEARANCES[(i + 1) % APPEARANCES.length];
  const themeWords = current.value === 'system' ? `Auto (${theme})` : current.label;
  // A press opens that button's card (or closes it, if it's the one open) and checks again.
  // The caret points at the middle of whichever button was pressed, wherever centring put it.
  const toggle = (kind, e) => {
    const b = e.currentTarget;
    setCaretLeft(b.offsetLeft + b.offsetWidth / 2 - 6);
    setOpen((v) => (v === kind ? null : kind));
    if (open !== kind) health.check();
  };

  return (
    <div className={className}>
      <div ref={rootRef} className="apple-pane relative flex items-center justify-center gap-2">
        {open && (
          <StatusCard
            key={open}
            kind={open}
            health={health}
            caretLeft={caretLeft}
            narrow={narrow}
            icon={open === 'api' ? <ApiIcon /> : <DatabaseIcon />}
          />
        )}
        <RoundButton kind="api" state={health.api} label={`API ${STATE_WORDS[health.api]}`} onClick={(e) => toggle('api', e)} small={small} expanded={open === 'api'}>
          <ApiIcon />
        </RoundButton>
        <RoundButton
          kind="db"
          state={health.db}
          label={health.db === 'ok' && health.database ? `Connected to ${health.database}` : `Database ${STATE_WORDS[health.db]}`}
          onClick={(e) => toggle('db', e)} small={small}
          expanded={open === 'db'}
        >
          <DatabaseIcon />
        </RoundButton>
        <RoundButton kind="theme" label={`Appearance: ${themeWords}. Click for ${next.label}`} onClick={() => setAppearance(next.value)} small={small}>
          {/* Keyed so each change plays the swap-in. */}
          <span key={current.value} className="status-swap flex">{THEME_ICON[current.value]}</span>
        </RoundButton>
        {privacyMode && (
          <RoundButton kind="privacy" label="Privacy mode on: names and numbers hidden. Click to show them" onClick={() => setPrivacyMode(false)} small={small}>
            <PrivacyIcon />
          </RoundButton>
        )}
      </div>
    </div>
  );
}
