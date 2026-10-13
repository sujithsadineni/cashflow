import { motion, useReducedMotion } from 'motion/react';
import { Tile, GlassToolbar } from './glass-ui';

/**
 * Glass Settings (D244, D245): an Apple Settings window's toolbar.
 * Nine sections were nine segments in one bar, about twice what a segmented
 * control should carry, and every label weighed the same. Here they're a
 * toolbar in three groups, icon over label as Safari's and Mail's Settings
 * windows have it, each pane with its own coloured tile, so the eye finds
 * "Backups" by colour and place. It scrolls sideways on narrow screens.
 */

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };

const ICONS = {
  accounts: <path {...stroke} d="M3 9.5 12 4l9 5.5M5.5 10.5v7M10 10.5v7M14 10.5v7M18.5 10.5v7M3.5 20h17" />,
  loans: <g {...stroke}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></g>,
  people: <g {...stroke}><circle cx="9" cy="8.5" r="3" /><path d="M3.5 19c0-3.2 2.4-5 5.5-5s5.5 1.8 5.5 5" /><circle cx="17" cy="9.5" r="2.3" /><path d="M16.5 14.2c2.4.2 4 1.7 4 4.3" /></g>,
  categories: <g {...stroke}><path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3-8.7 8.7-8.3-8.3Z" /><circle cx="8" cy="8" r="1.4" /></g>,
  icons: <g {...stroke}><path d="M4 4h16l1 5.5H3L4 4ZM4.5 9.5V20h15V9.5M10 20v-5h4v5" /></g>,
  overview: <g {...stroke}><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></g>,
  design: <g {...stroke}><path d="M12 3.5a8.5 8.5 0 1 0 0 17c1 0 1.7-.8 1.7-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.7 1.7-1.7h2.1c2.2 0 4-1.8 4-4 0-4-3.8-7.2-8.5-7.2Z" /><circle cx="7.8" cy="11" r="1" /><circle cx="10.5" cy="7.3" r="1" /><circle cx="15" cy="7.5" r="1" /></g>,
  privacy: <g {...stroke}><path d="M3 3l18 18M10.6 5.6A9.6 9.6 0 0 1 12 5.5c5 0 8.5 4.5 9 6.5-.3 1-1.2 2.6-2.7 4M6.6 6.6C4.6 8 3.4 10.3 3 12c.5 2 4 6.5 9 6.5 1.7 0 3.2-.5 4.5-1.2" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></g>,
  backups: <g {...stroke}><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5M3.5 3.5v5h5" /><path d="M12 8v4l2.8 1.8" /></g>,
};

/** Apple's system colours, one per pane, light and dark alike (tiles carry white glyphs). */
const PANES = {
  accounts: { color: '#007AFF', description: 'Every card and bank account the household uses, and whose it is.' },
  loans: { color: '#FF9500', description: 'Balances you owe and when they need to be gone.' },
  people: { color: '#34C759', description: 'Who shares this ledger.' },
  categories: { color: '#AF52DE', description: 'The buckets spending is sorted into, and their icons.' },
  icons: { color: '#FF2D55', description: 'What the app has learned about each merchant, and its picture.' },
  overview: { color: '#5856D6', description: 'Which small cards show on the Overview page.' },
  design: { color: '#30B0C7', description: 'How the app looks on this browser.' },
  privacy: { color: '#8E8E93', description: 'Hide real names and amounts for a screenshot.' },
  backups: { color: '#A2845E', description: 'Daily copies of the database and statements, and how to restore one.' },
};

const GROUPS = [
  ['accounts', 'loans', 'people'],
  ['categories', 'icons'],
  ['overview', 'design', 'privacy', 'backups'],
];

export function PaneIcon({ pane, size = 28 }) {
  const glyph = Math.round(size * 0.62);
  return (
    <Tile color={PANES[pane].color} size={size}>
      <svg width={glyph} height={glyph} viewBox="0 0 24 24">{ICONS[pane]}</svg>
    </Tile>
  );
}

export function GlassSettings({ tabs, tab, setTab, description, children }) {
  const reduceMotion = useReducedMotion();
  const label = (value) => tabs.find((t) => t.value === value)?.label ?? value;

  return (
    // 80% of the main area on large screens (10% each side), centred; full width below lg.
    <div className="mx-auto w-full lg:w-4/5">
      <h2 className="page-title">Settings</h2>

      {/* The toolbar, as Safari and Mail lay out their Settings windows (D245). */}
      <GlassToolbar
        className="mt-4 mb-8"
        label="Settings sections"
        groups={GROUPS.map((group) => group.map((value) => ({ value, label: label(value) })))}
        value={tab}
        onChange={setTab}
        renderIcon={(value) => <PaneIcon pane={value} size={28} />}
        layoutId="gs-pane-selection"
      />

      {/* Keyed by pane, so each arrival starts fresh: no bounce, nothing to wait for. */}
      <motion.div
        key={tab}
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reduceMotion ? { duration: 0.15 } : { type: 'spring', bounce: 0, duration: 0.4 }}
      >
        <header className="mb-7 flex items-center gap-3.5">
          <PaneIcon pane={tab} size={40} />
          <div className="min-w-0">
            <h3 className="text-[1.375rem] leading-tight font-bold tracking-[-0.02em] text-ink">{label(tab)}</h3>
            <p className="mt-0.5 text-[13px] text-muted">{description ?? PANES[tab].description}</p>
          </div>
        </header>
        {children}
      </motion.div>
    </div>
  );
}
