import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatMoney } from '../api';
import { MonthPicker } from './MonthPicker';
import { Segmented, PageTitle } from './Form';
import { RecurringIcon } from './RecurringIcon';

/**
 * "What needs my attention?" — the persistent, browsable version of
 * the toasts App.jsx already shows once per load (alerts.js,
 * notification-context.jsx). Same four findings the API computes for
 * those toasts (routes/alerts.js), read here from the `alert` table
 * instead, so a month can be revisited later and a fixed problem
 * shows up as cleared rather than just going silent.
 *
 * Month/YTD picker is the exact pattern Overview.jsx uses (same
 * header shape: title/subtitle on the left, MonthPicker+Segmented
 * held tight together on the right) — meant to feel like the same
 * kind of page, not a different one bolted onto the nav.
 */

const currentMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

const monthLabel = (month) =>
  new Date(`${month}-01T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

const shortMonthLabel = (month) =>
  new Date(`${month}-01T00:00:00`).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

const dateLabel = (date) =>
  new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

const relativeLabel = (isoTimestamp) => {
  const days = Math.round((Date.now() - new Date(isoTimestamp).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
};

const VIEW_MODES = [
  { value: 'month', label: 'Month' },
  { value: 'ytd', label: 'YTD' },
];

// Priority order for the active list — most urgent first. Matches
// the toast system's own error/info split (alerts.js): a missing
// statement or a bill that didn't show up is money-affecting and
// comes first; a pending review or a newly-detected candidate is
// informational.
const TYPE_ORDER = ['OVERDUE_STATEMENT', 'MISSED_RECURRING', 'PENDING_REVIEW', 'NEW_RECURRING'];

const TYPE_META = {
  OVERDUE_STATEMENT: { tone: 'spend', to: '/import' },
  MISSED_RECURRING: { tone: 'spend', to: '/recurring' },
  PENDING_REVIEW: { tone: 'warn', to: '/import' },
  NEW_RECURRING: { tone: 'muted', to: '/recurring' },
};

const TONE_CLASSES = {
  spend: { dot: 'bg-spend', text: 'text-spend', ring: 'bg-spend/10' },
  warn: { dot: 'bg-warn', text: 'text-warn', ring: 'bg-warn/10' },
  muted: { dot: 'bg-faint', text: 'text-muted', ring: 'bg-band' },
};

// The two big filter buttons above the list. "Recurring" covers both
// recurring alert types (a missed bill and an unreviewed candidate
// are the same domain to a user deciding whether to go check the
// Recurring page); "Cards" is statements only — pending review is a
// Transactions-ledger concern, not a card/statement one, so it stays
// out of both and only shows in the unfiltered view.
const FILTER_TYPES = {
  RECURRING: ['MISSED_RECURRING', 'NEW_RECURRING'],
  CARDS: ['OVERDUE_STATEMENT'],
};

function StatementIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="3" y="1.5" width="10" height="13" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.5 5h5M5.5 7.5h5M5.5 10h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function ReviewIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.5 4h11M2.5 8h11M2.5 12h7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 8.5l3 3 7-7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Same stroke language as the sidebar's own 'recurring' and 'cards'
// icons (Layout.jsx) — not re-exported from there since every page in
// this app defines its own small local icon set (Overview.jsx does
// the same), but drawn identically so the filter buttons read as the
// same visual vocabulary as the nav they echo.
function RecurringFilterIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.5 8a5.5 5.5 0 019.5-3.5M13.5 8a5.5 5.5 0 01-9.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11 2.5v2.5h-2.5M5 13.5V11h2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CardsFilterIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.5" y="3.5" width="13" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="1.5" y1="6.5" x2="14.5" y2="6.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Type-specific icon + title + subtitle, all built off the JSON `detail` blob routes/alerts.js stored. */
function alertContent(alert) {
  const d = alert.detail;
  switch (alert.type) {
    case 'OVERDUE_STATEMENT':
      return {
        icon: <StatementIcon />,
        title: alert.title,
        subtitle: alert.resolved_at ? 'Uploaded' : `${d.days_overdue} day${d.days_overdue === 1 ? '' : 's'} overdue`,
      };
    case 'MISSED_RECURRING':
      return {
        icon: <RecurringIcon name={d.name} glyph={d.glyph} size={20} />,
        title: alert.title,
        subtitle: alert.resolved_at
          ? 'Posted'
          : `Expected ${dateLabel(d.expected_date)}${d.expected_amount_cents != null ? ` · ~${formatMoney(Math.abs(d.expected_amount_cents))}` : ''}`,
      };
    case 'PENDING_REVIEW':
      return {
        icon: <ReviewIcon />,
        title: alert.title,
        subtitle: alert.resolved_at ? 'Reviewed' : d.original_filename,
      };
    case 'NEW_RECURRING':
      return {
        icon: <RecurringIcon name={d.merchant} glyph={d.glyph} size={20} />,
        title: alert.title,
        subtitle: alert.resolved_at
          ? 'Reviewed'
          : `${d.cadence.charAt(0)}${d.cadence.slice(1).toLowerCase()}${d.expected_amount_cents != null ? ` · ~${formatMoney(Math.abs(d.expected_amount_cents))}` : ''}`,
      };
    default:
      return { icon: null, title: alert.title, subtitle: '' };
  }
}

/**
 * A whole clickable card, not a row with a trailing text link — same
 * hover lift + icon-spark + top-edge accent bar every summary card in
 * this app already uses (Overview.jsx's SummaryCard). Cleared cards
 * aren't links: there's nothing to act on, just a record.
 */
function AlertCard({ alert }) {
  const meta = TYPE_META[alert.type];
  const tone = TONE_CLASSES[meta.tone];
  const { icon, title, subtitle } = alertContent(alert);
  const cleared = alert.resolved_at != null;

  const card = (
    <div
      className={`group relative h-full overflow-hidden rounded-2xl border border-rule bg-raised p-4 transition-all ${
        cleared ? 'opacity-60' : 'group-hover:-translate-y-0.5 group-hover:border-rule-str group-hover:shadow-md'
      }`}
    >
      {!cleared && <div className={`absolute inset-x-0 top-0 h-[3px] ${tone.dot}`} />}
      {!cleared && <div className={`card-sweep ${tone.text}`} />}
      <div className="relative flex items-center gap-3">
        <span
          className={`icon-spark flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full transition-transform duration-300 group-hover:scale-110 ${
            cleared ? 'bg-band text-muted' : `${tone.ring} ${tone.text}`
          }`}
        >
          {cleared ? <CheckIcon /> : icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-ink">{title}</div>
          <div className="truncate text-xs text-faint">{cleared ? `Cleared ${relativeLabel(alert.resolved_at)}` : subtitle}</div>
        </div>
      </div>
    </div>
  );

  if (cleared) return card;
  return (
    <Link to={meta.to} className="group block h-full">
      {card}
    </Link>
  );
}

function EmptyState({ label }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-rule px-6 py-10 text-center">
      <span className="flex size-8 items-center justify-center rounded-full bg-band text-muted">
        <CheckIcon />
      </span>
      <div className="text-sm text-muted">{label}</div>
    </div>
  );
}

function FilterButton({ active, onClick, icon, label, count }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 items-center gap-3 rounded-2xl border px-5 py-4 text-left transition-all ${
        active
          ? 'border-rule-str bg-raised shadow-md'
          : 'border-rule bg-band/40 text-muted hover:border-rule-str hover:bg-raised hover:text-ink'
      }`}
    >
      <span className={`flex size-10 shrink-0 items-center justify-center rounded-full ${active ? 'bg-ink text-paper' : 'bg-band text-muted'}`}>
        {icon}
      </span>
      <div>
        <div className={`text-sm font-medium ${active ? 'text-ink' : ''}`}>{label}</div>
        <div className="text-xs text-faint tnum">{count} {count === 1 ? 'alert' : 'alerts'}</div>
      </div>
    </button>
  );
}

function sortByPriority(alerts) {
  return [...alerts].sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type));
}

/** Groups a flat, multi-month list (YTD) by its own `month` field, most recent first — the flat single-month case just skips this. */
function groupByMonth(alerts) {
  const groups = new Map();
  for (const a of alerts) {
    if (!groups.has(a.month)) groups.set(a.month, []);
    groups.get(a.month).push(a);
  }
  return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

const CARD_GRID = 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3';

function AlertGrid({ alerts, isYtd }) {
  if (!isYtd) {
    return (
      <div className={CARD_GRID}>
        {alerts.map((a) => <AlertCard key={`${a.type}:${a.natural_key}`} alert={a} />)}
      </div>
    );
  }
  return (
    <>
      {groupByMonth(alerts).map(([m, items]) => (
        <div key={m} className="flex flex-col gap-2">
          <div className="text-xs font-medium text-muted">{shortMonthLabel(m)}</div>
          <div className={CARD_GRID}>
            {sortByPriority(items).map((a) => <AlertCard key={`${a.type}:${a.natural_key}`} alert={a} />)}
          </div>
        </div>
      ))}
    </>
  );
}

export function Alerts() {
  const [month, setMonth] = useState(currentMonth());
  const [viewMode, setViewMode] = useState('month');
  const [filter, setFilter] = useState(null); // null | 'RECURRING' | 'CARDS'
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const isYtd = viewMode === 'ytd';

  const load = useCallback(() => {
    setLoading(true);
    const request = isYtd
      ? api.alertHistory({ year: month.slice(0, 4), ytd: true })
      : api.alertHistory({ month });
    request.then(setData).catch(() => setData(null)).finally(() => setLoading(false));
  }, [month, isYtd]);

  useEffect(load, [load]);

  const active = useMemo(() => (data ? sortByPriority(data.active) : []), [data]);
  const cleared = useMemo(() => (data ? sortByPriority(data.cleared).reverse() : []), [data]);

  const recurringCount = active.filter((a) => FILTER_TYPES.RECURRING.includes(a.type)).length;
  const cardsCount = active.filter((a) => FILTER_TYPES.CARDS.includes(a.type)).length;

  const visibleTypes = filter ? FILTER_TYPES[filter] : null;
  const visibleActive = visibleTypes ? active.filter((a) => visibleTypes.includes(a.type)) : active;
  const visibleCleared = visibleTypes ? cleared.filter((a) => visibleTypes.includes(a.type)) : cleared;

  const periodCaption = isYtd ? `Jan–${shortMonthLabel(month).split(' ')[0]} ${month.slice(0, 4)}` : monthLabel(month);
  const toggleFilter = (name) => setFilter((current) => (current === name ? null : name));

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <PageTitle as="h1" className="text-2xl font-medium tracking-tight text-ink" emoji="🔔" tint="bg-vivid-red/15">Alerts</PageTitle>
          <p className="mt-1 text-sm text-muted">Statements, recurring charges, and reviews that need a look.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <MonthPicker value={month} onChange={setMonth} />
          <Segmented value={viewMode} onChange={setViewMode} options={VIEW_MODES} />
        </div>
      </header>

      <div className="flex flex-col gap-3 sm:flex-row">
        <FilterButton
          active={filter === 'RECURRING'}
          onClick={() => toggleFilter('RECURRING')}
          icon={<RecurringFilterIcon />}
          label="Recurring"
          count={recurringCount}
        />
        <FilterButton
          active={filter === 'CARDS'}
          onClick={() => toggleFilter('CARDS')}
          icon={<CardsFilterIcon />}
          label="Cards"
          count={cardsCount}
        />
      </div>

      {loading && <div className="text-sm text-faint">Loading…</div>}

      {!loading && data && (
        <>
          <section className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-medium text-ink">Active</h2>
              <span className="text-xs text-faint">{periodCaption}</span>
            </div>
            {visibleActive.length === 0 ? (
              <EmptyState label={`All clear for ${periodCaption}`} />
            ) : (
              <AlertGrid alerts={visibleActive} isYtd={isYtd} />
            )}
          </section>

          {visibleCleared.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-medium text-ink">Cleared</h2>
              <AlertGrid alerts={visibleCleared} isYtd={isYtd} />
            </section>
          )}
        </>
      )}
    </div>
  );
}
