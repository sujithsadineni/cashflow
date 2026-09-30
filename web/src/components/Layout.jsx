import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { usePrivacy } from '../privacy-context';
import { useDesign } from '../design-context';
import { motion } from 'motion/react';
import { api } from '../api';
import { SupportButton } from './support/SupportButton';

/**
 * A left sidebar rather than a top bar: it scales to more items
 * without crowding, and leaves the full page width to the numbers.
 *
 * Stays light, like every other page — a dark sidebar next to a light
 * "ledger paper" surface everywhere else would look bolted-on rather
 * than designed.
 */

const iconProps = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true };
const strokeProps = { stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' };

const ICONS = {
  overview: (
    <svg {...iconProps}>
      <path d="M1.5 8.5L8 2l6.5 6.5" {...strokeProps} />
      <path d="M3 7v7h10V7" {...strokeProps} />
    </svg>
  ),
  cards: (
    <svg {...iconProps}>
      <rect x="1.5" y="3.5" width="13" height="9" rx="1.5" {...strokeProps} />
      <line x1="1.5" y1="6.5" x2="14.5" y2="6.5" {...strokeProps} />
    </svg>
  ),
  transactions: (
    <svg {...iconProps}>
      <line x1="2" y1="4" x2="14" y2="4" {...strokeProps} />
      <line x1="2" y1="8" x2="14" y2="8" {...strokeProps} />
      <line x1="2" y1="12" x2="10" y2="12" {...strokeProps} />
    </svg>
  ),
  import: (
    <svg {...iconProps}>
      <path d="M8 1.5v8.5" {...strokeProps} />
      <path d="M4.5 6.5L8 10l3.5-3.5" {...strokeProps} />
      <path d="M2 12.5v1a1 1 0 001 1h10a1 1 0 001-1v-1" {...strokeProps} />
    </svg>
  ),
  settings: (
    <svg {...iconProps}>
      <circle cx="8" cy="8" r="2.4" {...strokeProps} />
      <path d="M8 1.8v1.6M8 12.6v1.6M14.2 8h-1.6M3.4 8H1.8M12.3 3.7l-1.1 1.1M4.8 11.1l-1.1 1.1M12.3 12.3l-1.1-1.1M4.8 4.9L3.7 3.8" {...strokeProps} />
    </svg>
  ),
  activity: (
    <svg {...iconProps}>
      <path d="M1.5 8.5h3l1.5-4 3 7 1.5-4h3" {...strokeProps} />
    </svg>
  ),
  recurring: (
    <svg {...iconProps}>
      <path d="M2.5 8a5.5 5.5 0 019.5-3.5M13.5 8a5.5 5.5 0 01-9.5 3.5" {...strokeProps} />
      <path d="M11 2.5v2.5h-2.5" {...strokeProps} />
      <path d="M5 13.5V11h2.5" {...strokeProps} />
    </svg>
  ),
  alerts: (
    <svg {...iconProps}>
      <path d="M8 2.2c-1.8 0-3 1.4-3 3.4v1.6c0 1-.35 1.75-1 2.4h8c-.65-.65-1-1.4-1-2.4V5.6c0-2-1.2-3.4-3-3.4z" {...strokeProps} />
      <path d="M6.3 12.1a1.8 1.8 0 003.4 0" {...strokeProps} />
    </svg>
  ),
};

// Two groups — viewing money, then managing the data behind it —
// split by a plain rule rather than a text label. A "MONEY" /
// "SYSTEM" eyebrow would just restate what the icons and grouping
// already say, and ALL-CAPS labels are on this app's avoid-list.
const NAV_GROUPS = [
  [
    { to: '/overview', label: 'Overview', end: true, icon: 'overview' },
    { to: '/alerts', label: 'Alerts', icon: 'alerts' },
    { to: '/cards', label: 'Cards', icon: 'cards' },
    { to: '/transactions', label: 'Transactions', icon: 'transactions' },
    { to: '/recurring', label: 'Recurring', icon: 'recurring' },
  ],
  [
    { to: '/import', label: 'Import', icon: 'import' },
    { to: '/activity', label: 'Activity', icon: 'activity' },
    { to: '/settings', label: 'Settings', icon: 'settings' },
  ],
];

// Vivid (Settings → Design): an emoji in a tinted tile per item, each
// item with its own color — asked for directly ("new icons with nice
// emojis"). Emoji are on this app's avoid-list for Classic, so they
// only ever appear in Vivid, the same way IncomeDetail's category
// emoji are a scoped, requested exception. Class strings stay static
// literals so Tailwind generates them.
const VIVID_NAV = {
  overview: { emoji: '🏠', tile: 'bg-vivid-green/15', active: 'bg-vivid-green/10', bar: 'bg-vivid-green' },
  alerts: { emoji: '🔔', tile: 'bg-vivid-red/15', active: 'bg-vivid-red/10', bar: 'bg-vivid-red' },
  cards: { emoji: '💳', tile: 'bg-vivid-blue/15', active: 'bg-vivid-blue/10', bar: 'bg-vivid-blue' },
  transactions: { emoji: '🧾', tile: 'bg-vivid-teal/15', active: 'bg-vivid-teal/10', bar: 'bg-vivid-teal' },
  recurring: { emoji: '🔁', tile: 'bg-vivid-purple/15', active: 'bg-vivid-purple/10', bar: 'bg-vivid-purple' },
  import: { emoji: '📥', tile: 'bg-vivid-amber/20', active: 'bg-vivid-amber/10', bar: 'bg-vivid-amber' },
  activity: { emoji: '📈', tile: 'bg-vivid-pink/15', active: 'bg-vivid-pink/10', bar: 'bg-vivid-pink' },
  settings: { emoji: '⚙️', tile: 'bg-rule/60', active: 'bg-band', bar: 'bg-ink' },
};

// One playful hop-and-tilt for every nav emoji, spring-timed so it
// reads as a bounce rather than a blink (D138's lesson).
const navEmojiHover = {
  rest: { rotate: 0, scale: 1, y: 0 },
  hover: { rotate: [0, -14, 10, -5, 0], scale: [1, 1.3, 1.1], y: [0, -3, 0], transition: { duration: 0.7, ease: 'easeOut' } },
};

function VividNavItem({ to, label, end, icon, alertBadge }) {
  const v = VIVID_NAV[icon];
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `relative -mx-2 block rounded-lg px-2 py-1.5 text-sm transition-colors ${
          isActive ? `${v.active} font-medium text-ink` : 'text-muted hover:bg-raised hover:text-ink'
        }`
      }
    >
      {({ isActive }) => (
        <motion.span className="flex items-center gap-2.5" initial="rest" animate="rest" whileHover="hover">
          {isActive && <span className={`absolute -left-5 top-1.5 bottom-1.5 w-[3px] rounded-r-full ${v.bar}`} />}
          <motion.span
            variants={navEmojiHover}
            className={`flex size-7 shrink-0 items-center justify-center rounded-lg text-[15px] leading-none ${v.tile}`}
            aria-hidden="true"
          >
            {v.emoji}
          </motion.span>
          {label}
          {icon === 'alerts' && alertBadge.count > 0 && (
            <span
              key={alertBadge.count}
              className={`animate-pop-in ml-auto flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold tnum text-white ${
                alertBadge.urgent ? 'bg-vivid-red' : 'bg-vivid-amber'
              }`}
            >
              {alertBadge.count}
            </span>
          )}
        </motion.span>
      )}
    </NavLink>
  );
}

function ConnectionDot({ state, detail }) {
  const dot = { checking: 'bg-faint', ok: 'bg-earn', down: 'bg-spend' }[state];
  const text = {
    checking: 'Checking…',
    ok: `Connected to ${detail}`,
    down: 'Backend not reachable',
  }[state];

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={`inline-block size-1.5 rounded-full ${dot}`} />
      <span className={state === 'down' ? 'text-spend' : 'text-faint'}>{text}</span>
    </div>
  );
}

/**
 * Refetched on every route change, not just once on mount — cheap
 * (one small query, see routes/alerts.js), and the Alerts page itself
 * clears things as its underlying data changes, so navigating away
 * from it should drop the badge immediately rather than waiting for
 * an unrelated future reload.
 */
function useAlertBadge() {
  const location = useLocation();
  const [state, setState] = useState({ count: 0, urgent: false });

  useEffect(() => {
    let cancelled = false;
    api.alerts().then((a) => {
      if (cancelled) return;
      const urgentCount = a.overdue_statements.length + a.missed_recurring.length;
      const infoCount = a.new_recurring.length + a.pending_review.length;
      setState({ count: urgentCount + infoCount, urgent: urgentCount > 0 });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [location.pathname]);

  return state;
}

export function Layout({ connection, database }) {
  const { privacyMode } = usePrivacy();
  const { design } = useDesign();
  const vivid = design === 'vivid';
  const location = useLocation();
  const alertBadge = useAlertBadge();
  return (
    <div className="flex min-h-screen bg-paper">
      <aside className="flex w-52 shrink-0 flex-col border-r border-rule bg-band/40 px-5 py-8">
        <Link to="/" className="flex items-center gap-2 text-lg font-medium tracking-tight text-ink">
          {vivid && (
            <span className="grid size-5 grid-cols-2 gap-0.5" aria-hidden="true">
              <span className="rounded-[3px] bg-vivid-green" />
              <span className="rounded-[3px] bg-vivid-amber" />
              <span className="rounded-[3px] bg-vivid-blue" />
              <span className="rounded-[3px] bg-vivid-red" />
            </span>
          )}
          cashflow
        </Link>

        <nav className="mt-8 flex flex-col gap-4">
          {NAV_GROUPS.map((group, i) => (
            <div key={i} className={`flex flex-col gap-1 ${i > 0 ? 'border-t border-rule pt-4' : ''}`}>
              {vivid && group.map((item) => <VividNavItem key={item.to} {...item} alertBadge={alertBadge} />)}
              {!vivid && group.map(({ to, label, end, icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    `relative -mx-2 flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors ${
                      isActive ? 'bg-raised font-medium text-ink shadow-sm' : 'text-muted hover:bg-raised/60 hover:text-ink'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && <span className="absolute -left-5 top-1 bottom-1 w-[3px] rounded-r-full bg-ink" />}
                      <span className="shrink-0">{ICONS[icon]}</span>
                      {label}
                      {icon === 'alerts' && alertBadge.count > 0 && (
                        <span
                          key={alertBadge.count}
                          className={`animate-pop-in ml-auto flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold tnum text-paper ${
                            alertBadge.urgent ? 'bg-spend' : 'bg-warn'
                          }`}
                        >
                          {alertBadge.count}
                        </span>
                      )}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="mt-auto flex flex-col gap-3 pt-8">
          {privacyMode && (
            <div className="flex items-center gap-2 rounded-md border border-rule-str bg-band px-2.5 py-1.5 text-xs text-muted">
              <span className="inline-block size-1.5 rounded-full bg-warn" />
              Privacy mode — names and numbers hidden
            </div>
          )}
          <ConnectionDot state={connection} detail={database} />
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-8 py-10">
        <div className="mx-auto max-w-5xl">
          {import.meta.env.VITE_DEMO === '1' && (
            <p className="mb-6 rounded-lg border border-rule bg-band px-4 py-2 text-sm text-muted">
              Demo — an invented household, not real data. Look around; changes aren't saved.
            </p>
          )}
          {/* Vivid: each page rises in when you navigate to it (keyed by
              path, so switching pages replays it). ~0.4s, once per visit. */}
          {vivid ? (
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            >
              <Outlet />
            </motion.div>
          ) : (
            <Outlet />
          )}
        </div>
      </main>
      <SupportButton />
    </div>
  );
}
