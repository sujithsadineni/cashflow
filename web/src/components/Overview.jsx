import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatMoney, maskName } from '../api';
import { MonthPicker } from './MonthPicker';
import { MerchantAvatar } from './MerchantAvatar';
import { SavingsDetail } from './SavingsDetail';
import { IncomeDetail } from './IncomeDetail';
import { SpendDetail } from './SpendDetail';
import { LoansDetail } from './LoansDetail';
import { SecondaryDetail } from './SecondaryDetail';
import { ZelleReview } from './ZelleReview';
import { loanTypeIcon, LOAN_TYPE_LABEL } from './LoanIcons';
import { Segmented, PageTitle } from './Form';
import { CategoryDonut, SpendMixBars } from './CategoryDonut';
import { useDesign } from '../design-context';
import { motion } from 'motion/react';
import {
  IncomeIcon, SpentIcon, LoansIcon, SavingsIcon, CashbackIcon, FeeIcon,
  TransferOutIcon, PersonTransferIcon, InvestmentIcon,
} from './CardIcons';
import { VIVID_MIX_COLORS } from '../designs';
import { PersonAvatar } from './ui/PersonAvatar';
import { OVERVIEW_CARDS, OVERVIEW_CARDS_SETTING_KEY } from '../overview-cards';

/**
 * "How did this month go?" at a glance.
 *
 * The four-tile grid was tried once before (D27/D29) and reverted
 * (D32) because icon-badged tiles at equal visual weight made
 * unrelated facts read as one story. This is a second, deliberately
 * plainer four-tile pass, per the owner's explicit ask: Salary, Spent,
 * Loans, Savings, as quiet bordered cards with no icons, no trend
 * pills, no accent bars — just a label and a number, so the mistake
 * that got this reverted last time doesn't repeat. Below the cards,
 * the Activity chart, category breakdown and largest transactions are
 * unchanged from the previous pass.
 *
 * Colour discipline unchanged: spend (oxblood) and earn (pine) mean
 * money out and money in, everywhere, and nothing else.
 */

const monthLabel = (month) =>
  new Date(`${month}-01T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

// "Jan–Sep 2026" — the caption every card switches to in YTD mode,
// replacing whatever month-specific caption it normally shows (a
// single month name, a vs-last-month comparison). Always starts in
// January of the selected month's own year, matching how every
// year_to_date_*_cents figure is already computed server-side.
const ytdLabel = (month) => {
  const [year, monthNum] = month.split('-').map(Number);
  const abbr = new Date(`${month}-01T00:00:00`).toLocaleDateString('en-US', { month: 'short' });
  return monthNum === 1 ? `Jan ${year}` : `Jan–${abbr} ${year}`;
};

const currentMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

/* ------------------------------------------------------------------
   Summary cards — an icon badge plus a top accent bar (style "B" from
   the owner's own comparison of four options), same treatment on all
   four cards now. A `to` navigates on click (used by Loans, which has
   no drill-down page yet — clicking it goes to where loans are
   actually managed).
   ------------------------------------------------------------------ */

// The nine card icons live in CardIcons.jsx, animated per part with
// the `motion` library (D138) — see SummaryCard for how a card's hover
// reaches them.

// Tailwind needs every class name it generates CSS for to appear as a
// literal string somewhere in the source — `bg-${tone}` at runtime
// would silently generate nothing. This map is what keeps the tone
// prop dynamic while every actual class stays a static, scannable
// string.
const TONE = {
  earn: { text: 'text-earn', bg: 'bg-earn' },
  spend: { text: 'text-spend', bg: 'bg-spend' },
  ink: { text: 'text-ink', bg: 'bg-rule-str' },
};

// Compact cards (the secondary row) are a different SHAPE, not just
// a smaller copy of the main one — label+icon on the left, the
// number on the right, on one row. The main card's layout (icon+
// label, then a big number below, then a caption) wastes most of a
// wide card's width on a short label and a small value; putting them
// side by side uses that space instead of leaving it empty, and lets
// the whole card sit shorter — asked for directly from a screenshot
// showing exactly that empty space.
function CompactSummaryCard({ label, value, text, bg, caption, icon, animated }) {
  return (
    <div
      className={`relative h-full overflow-hidden rounded-xl border border-rule bg-raised p-3 transition-all ${
        animated ? 'group-hover:-translate-y-0.5 group-hover:border-rule-str group-hover:shadow-md' : ''
      }`}
    >
      {icon && <div className={`absolute inset-x-0 top-0 h-[3px] ${bg}`} />}
      {icon && animated && <div className={`card-sweep ${text}`} />}
      <div className="relative flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-1.5 text-xs leading-tight text-muted">
          {icon && (
            <span
              className={`mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-band ${text} ${
                animated ? 'icon-spark transition-transform duration-300 group-hover:scale-110' : ''
              }`}
            >
              {icon}
            </span>
          )}
          <span>{label}</span>
        </div>
        <div className="shrink-0 text-right">
          <div className={`whitespace-nowrap font-mono text-base font-semibold tnum ${text}`}>{value}</div>
          {caption && <div className="mt-0.5 truncate text-[10px] text-faint">{caption}</div>}
        </div>
      </div>
    </div>
  );
}

// Vivid (Settings → Design): each card gets its own identity color
// (`accent`) for a solid icon tile, independent of which way its money
// points — `tone` still decides the number's color. Static class
// strings for the same reason as TONE above.
const VIVID_ACCENT = {
  green: { tile: 'bg-vivid-green', soft: 'bg-vivid-green/10' },
  red: { tile: 'bg-vivid-red', soft: 'bg-vivid-red/10' },
  amber: { tile: 'bg-vivid-amber', soft: 'bg-vivid-amber/10' },
  teal: { tile: 'bg-vivid-teal', soft: 'bg-vivid-teal/10' },
  blue: { tile: 'bg-vivid-blue', soft: 'bg-vivid-blue/10' },
  purple: { tile: 'bg-vivid-purple', soft: 'bg-vivid-purple/10' },
  pink: { tile: 'bg-vivid-pink', soft: 'bg-vivid-pink/10' },
};
const VIVID_TONE = { earn: 'text-vivid-green', spend: 'text-vivid-loss', ink: 'text-ink' };

function VividSummaryCard({ label, value, tone, caption, icon, accent, compact }) {
  const { tile, soft } = VIVID_ACCENT[accent] ?? VIVID_ACCENT.green;
  const numberText = VIVID_TONE[tone];

  if (compact) {
    return (
      <div className={`flex h-full items-center justify-between gap-3 rounded-xl p-3 transition-all group-hover:-translate-y-0.5 group-hover:shadow-md ${soft}`}>
        <div className="flex min-w-0 items-center gap-2.5 text-xs leading-tight text-ink/80">
          {icon && (
            <span className={`vivid-tile inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-white ${tile}`}>
              {icon}
            </span>
          )}
          <span>{label}</span>
        </div>
        <div className="shrink-0 text-right">
          <div className={`whitespace-nowrap font-mono text-base font-semibold tnum ${numberText}`}>{value}</div>
          {caption && <div className="mt-0.5 truncate text-[10px] text-muted">{caption}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full items-center gap-3.5 rounded-2xl border border-rule bg-raised p-4 transition-all group-hover:-translate-y-0.5 group-hover:border-rule-str group-hover:shadow-md">
      {icon && (
        <span className={`vivid-tile inline-flex size-11 shrink-0 items-center justify-center rounded-[13px] text-white [&>svg]:size-5 ${tile}`}>
          {icon}
        </span>
      )}
      {/* The number never wraps (a "−" is a line-break opportunity, so a
          long spend split into "−" / "$1,234.56"), and scales with the
          card's own width instead (cqi) so a long figure still fits. */}
      <div className="@container min-w-0 flex-1">
        <div className="text-sm text-muted">{label}</div>
        <div className={`whitespace-nowrap font-mono text-[clamp(1.125rem,11.5cqi,1.5rem)] font-semibold tracking-tight tnum ${numberText}`}>{value}</div>
        {caption && <div className="mt-0.5 truncate text-xs text-faint">{caption}</div>}
      </div>
    </div>
  );
}

const MotionLink = motion.create(Link);

// Hovering (or keyboard-focusing) anywhere on a card sets it to its
// "hover" variant; motion passes that label down to every child with
// matching `variants`, which is how the icons in CardIcons.jsx know to
// animate without SummaryCard knowing anything about them.
const cardHover = { initial: 'rest', animate: 'rest', whileHover: 'hover', whileFocus: 'hover' };

function SummaryCard({ label, value, tone = 'ink', caption, to, onClick, icon, animated = false, compact = false, accent }) {
  const { design } = useDesign();
  const { text, bg } = TONE[tone];
  const body = design === 'vivid' ? (
    <VividSummaryCard label={label} value={value} tone={tone} caption={caption} icon={icon} accent={accent} compact={compact} />
  ) : compact ? (
    <CompactSummaryCard label={label} value={value} text={text} bg={bg} caption={caption} icon={icon} animated={animated} />
  ) : (
    <div
      className={`relative h-full overflow-hidden rounded-2xl border border-rule bg-raised p-5 transition-all ${
        animated ? 'group-hover:-translate-y-0.5 group-hover:border-rule-str group-hover:shadow-md' : ''
      }`}
    >
      {icon && <div className={`absolute inset-x-0 top-0 h-[3px] ${bg}`} />}
      {icon && animated && <div className={`card-sweep ${text}`} />}
      <div className="relative">
        <div className="flex items-center gap-2 text-sm text-muted">
          {icon && (
            <span
              className={`inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-band ${text} ${
                animated ? 'icon-spark transition-transform duration-300 group-hover:scale-110' : ''
              }`}
            >
              {icon}
            </span>
          )}
          {label}
        </div>
        <div className={`mt-1.5 whitespace-nowrap font-mono text-2xl font-semibold tracking-tight tnum ${text}`}>
          {value}
        </div>
        {caption && <div className="mt-1.5 truncate text-xs text-faint">{caption}</div>}
      </div>
    </div>
  );

  if (to) {
    return (
      <MotionLink to={to} className="group block h-full" {...cardHover}>
        {body}
      </MotionLink>
    );
  }
  if (onClick) {
    return (
      <motion.button onClick={onClick} className="group block h-full w-full text-left" {...cardHover}>
        {body}
      </motion.button>
    );
  }
  return (
    <motion.div className="h-full" {...cardHover}>
      {body}
    </motion.div>
  );
}

/* ------------------------------------------------------------------
   The activity chart — a paired bar per bucket, spend and earn side
   by side. This is deliberately the plain chart the app had before
   the gradient-area rework: two bars are easier to read at a glance
   than a smoothed curve, and there's nothing here to misread as a
   trend line implying future months.
   ------------------------------------------------------------------ */

const bucketLabel = (iso, granularity) => {
  const d = new Date(`${iso}T00:00:00`);
  if (granularity === 'week') return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (granularity === 'month') return d.toLocaleDateString('en-US', { month: 'short' });
  return String(d.getFullYear());
};

const isSelectedBucket = (iso, granularity, month) => {
  if (granularity === 'month') return iso.slice(0, 7) === month;
  if (granularity === 'year') return iso.slice(0, 4) === month.slice(0, 4);
  return false;
};

function BarChart({ buckets, granularity, month, vivid = false }) {
  const [hovered, setHovered] = useState(null);

  const W = 720;
  const H = 200;
  const plotTop = 10;
  const plotBottom = H - 26;
  const plotHeight = plotBottom - plotTop;

  const hasData = buckets.some((b) => b.spend_cents !== 0 || b.income_cents !== 0);
  if (!hasData) {
    return (
      <p className="py-16 text-center text-sm text-muted">
        Nothing in this range yet — import a statement and it will draw itself.
      </p>
    );
  }

  const max = Math.max(...buckets.map((b) => Math.max(Math.abs(b.spend_cents), b.income_cents)), 1);
  const slot = W / buckets.length;
  const gap = slot * 0.14;
  const barWidth = (slot - gap * 3) / 2;
  const barHeight = (cents) => (Math.abs(cents) / max) * plotHeight;

  const hoveredBucket = hovered !== null ? buckets[hovered] : null;

  return (
    <div className="relative">
      {hoveredBucket && (
        <div
          className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 -translate-y-full
                     whitespace-nowrap rounded-lg border border-rule bg-raised px-3 py-2 text-xs shadow-md"
          style={{ left: `${((hovered * slot + slot / 2) / W) * 100}%` }}
        >
          <div className="font-medium text-ink">{bucketLabel(hoveredBucket.bucket_start, granularity)}</div>
          <div className="mt-1 flex items-center gap-3 tnum">
            <span className="flex items-center gap-1 text-spend">
              <span className="inline-block size-1.5 rounded-full bg-spend" /> {formatMoney(hoveredBucket.spend_cents)}
            </span>
            <span className="flex items-center gap-1 text-earn">
              <span className="inline-block size-1.5 rounded-full bg-earn" /> +{formatMoney(hoveredBucket.income_cents)}
            </span>
          </div>
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
           aria-label={`Money out and money in per ${granularity}`}>
        {buckets.map((bucket, i) => {
          const anySelected = buckets.some((b) => isSelectedBucket(b.bucket_start, granularity, month));
          const selected = isSelectedBucket(bucket.bucket_start, granularity, month);
          const dim = anySelected && !selected;
          const x0 = i * slot + gap;
          const spendH = barHeight(bucket.spend_cents);
          const earnH = barHeight(bucket.income_cents);
          return (
            <g
              key={bucket.bucket_start}
              opacity={dim ? 0.35 : 1}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered((h) => (h === i ? null : h))}
            >
              <rect x={i * slot} y={plotTop} width={slot} height={plotHeight} fill="transparent" />
              <rect x={x0} y={plotBottom - spendH} width={barWidth} height={spendH} rx="2" fill={vivid ? 'var(--color-vivid-red)' : 'var(--color-spend)'} />
              <rect x={x0 + barWidth + gap} y={plotBottom - earnH} width={barWidth} height={earnH} rx="2" fill={vivid ? 'var(--color-vivid-green)' : 'var(--color-earn)'} />
              <text
                x={i * slot + slot / 2} y={H - 8} textAnchor="middle" fontSize="11"
                fill={selected ? 'var(--color-ink)' : 'var(--color-faint)'}
                fontWeight={selected ? '500' : '400'}
                className="tnum pointer-events-none"
              >
                {bucketLabel(bucket.bucket_start, granularity)}
              </text>
            </g>
          );
        })}
        <line x1="0" y1={plotBottom} x2={W} y2={plotBottom} stroke="var(--color-rule-str)" strokeWidth="1" />
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------
   Vivid only: a two-row ledger under the month-by-month chart — what
   was saved each month and what share of income that was. "Saved" is
   the Savings card's own formula (D59: income − spend − loan
   payments), from the same summary rows, so each cell agrees with what
   the Savings card shows for that month. It deliberately does NOT
   agree with the bars above it: the chart counts every dollar in and
   out (routes/transactions.js trends), so a bar can show money in on
   a month the Savings card still calls a loss.

   Twelve columns, Jan–Dec, lined up under the chart's twelve slots —
   the chart is wrapped in the same left gutter as this ledger's row
   labels (see LEDGER_GUTTER) so both span the identical width.
   ------------------------------------------------------------------ */

const LEDGER_GUTTER = 'pl-14';
const LEDGER_GRID = 'grid grid-cols-[3.5rem_repeat(12,minmax(0,1fr))]';

function SavedLedger({ year, incomeByMonth, spendByMonth, ytdIncome, ytdSpend, ytdLoanPayments }) {
  // The year so far, same formula again, straight off the summary's own
  // year_to_date_* figures rather than re-adding the twelve cells.
  const ytdSaved = ytdIncome + ytdSpend + ytdLoanPayments;
  const ytdKept = ytdIncome > 0 ? Math.round((ytdSaved / ytdIncome) * 100) : null;
  const months = Array.from({ length: 12 }, (_, i) => {
    const key = `${year}-${String(i + 1).padStart(2, '0')}`;
    const income = incomeByMonth.find((m) => m.month === key);
    const spend = spendByMonth.find((m) => m.month === key);
    if (!income && !spend) return { key, saved: null, kept: null };
    const incomeCents = income?.income_cents ?? 0;
    const saved = incomeCents + (spend?.spend_cents ?? 0) + (spend?.loan_payment_cents ?? 0);
    return { key, saved, kept: incomeCents > 0 ? Math.round((saved / incomeCents) * 100) : null };
  });

  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-rule text-xs">
      {/* Phones: twelve months can't share ~300px, so the two month rows scroll
          sideways (≈3rem a month) with their labels pinned on the left. From
          `md` up there's no minimum and the columns line up under the chart. */}
      <div className="overflow-x-auto">
        <div className="min-w-[40rem] md:min-w-0">
          {/* Phones only: once these rows scroll, the chart's month labels above no longer line up. */}
          <div className={`${LEDGER_GRID} border-b border-rule bg-raised py-1.5 text-[10px] text-faint md:hidden`}>
            <span className="sticky left-0 z-[1] bg-raised" />
            {months.map((m) => (
              <span key={m.key} className="text-center">
                {new Date(`${m.key}-01T00:00:00`).toLocaleString('en-US', { month: 'short' })}
              </span>
            ))}
          </div>
          <div className={`${LEDGER_GRID} items-center bg-raised py-2 font-mono font-medium tnum`}>
            <span className="sticky left-0 z-[1] bg-raised pl-3 font-sans font-normal text-muted">Saved</span>
            {months.map((m) => (
              <span
                key={m.key}
                className={`text-center ${m.saved == null ? '' : m.saved < 0 ? 'text-vivid-loss' : 'text-vivid-green'}`}
              >
                {m.saved == null ? '' : formatMoney(m.saved, { showSign: true, compact: true })}
              </span>
            ))}
          </div>
          <div className={`${LEDGER_GRID} items-center bg-band py-2 font-mono font-medium tnum`}>
            <span className="sticky left-0 z-[1] bg-band pl-3 font-sans font-normal text-muted">Kept</span>
            {months.map((m) => (
              <span key={m.key} className={`text-center ${m.kept != null && m.kept < 0 ? 'text-vivid-loss' : 'text-ink'}`}>
                {m.saved == null ? '' : m.kept == null ? <span className="text-faint">—</span> : `${m.kept}%`}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-rule bg-raised px-3 py-2.5">
        <span className="text-muted">{year} so far</span>
        <span className="flex items-baseline gap-4">
          <span className="text-muted">
            Saved{' '}
            <span className={`font-mono text-sm font-semibold tnum ${ytdSaved < 0 ? 'text-vivid-loss' : 'text-vivid-green'}`}>
              {formatMoney(ytdSaved, { showSign: true })}
            </span>
          </span>
          {ytdKept != null && (
            <span className="text-muted">
              Kept <span className="font-mono text-sm font-semibold tnum text-ink">{ytdKept}%</span>
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------
   Vivid only (D146): the by-person line as cards with avatars and each
   person's share of the month, and "Largest this month" as a ranked
   list — medals for the top three, a bar against the biggest, and each
   category chip in the same color that category already has in Spend
   mix and "Where it's going" (both ranked biggest-first from the same
   by_category rows), so a category is one color across the page.
   ------------------------------------------------------------------ */

function VividByPerson({ byPerson, people }) {
  const spentOf = (p) => Math.max(-p.net_cents, 0);
  const total = byPerson.reduce((sum, p) => sum + spentOf(p), 0);
  return (
    <div className="mb-10 grid grid-cols-1 gap-3 sm:grid-cols-2">
      {byPerson.map((p) => {
        const person = people.find((x) => x.id === p.id) ?? p;
        const share = total > 0 ? spentOf(p) / total : 0;
        return (
          <div key={p.id} className="flex items-center gap-3 rounded-2xl border border-rule bg-raised p-4">
            <PersonAvatar person={person} size={40} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm text-ink">{maskName(p.name)}</span>
                <span className={`font-mono text-sm font-semibold tnum ${p.net_cents >= 0 ? 'text-earn' : 'text-spend'}`}>
                  {p.net_cents >= 0 ? '+' : ''}
                  {formatMoney(p.net_cents)}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 rounded-full bg-band">
                <div className="animate-bar-grow h-1.5 rounded-full bg-vivid-purple" style={{ width: `${share * 100}%` }} />
              </div>
              <div className="mt-1 text-[11px] text-muted">{Math.round(share * 100)}% of the household's spend this month</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const MEDALS = ['🥇', '🥈', '🥉'];

function VividLargest({ largest, byCategory }) {
  const max = Math.max(...largest.map((t) => Math.abs(t.amount_cents)), 1);
  const colorOf = (name) => {
    const rank = byCategory.findIndex((c) => c.name === (name ?? 'Uncategorized'));
    return VIVID_MIX_COLORS[rank] ?? 'bg-rule-str';
  };
  return (
    <ol className="flex flex-col gap-2.5">
      {largest.map((t, i) => (
        <li key={t.id} className="grid grid-cols-[2rem_auto_1fr_auto] items-center gap-3">
          <span className="text-center text-lg leading-none" aria-label={`#${i + 1}`}>
            {MEDALS[i] ?? <span className="font-mono text-sm text-faint">{i + 1}</span>}
          </span>
          <MerchantAvatar merchant={t.merchant} description={t.description} amountCents={t.amount_cents} categoryName={t.category_name} categoryIconKey={t.category_icon_key} size={32} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm text-ink" title={t.description}>{t.merchant ?? t.description}</span>
              <span className="flex shrink-0 items-center gap-1 rounded-full bg-band px-2 py-0.5 text-[11px] text-muted">
                <span className={`size-1.5 rounded-full ${colorOf(t.category_name)}`} />
                {t.category_name ?? 'Uncategorized'}
              </span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-band">
              <div
                className={`animate-bar-grow h-1.5 rounded-full ${colorOf(t.category_name)}`}
                style={{ width: `${(Math.abs(t.amount_cents) / max) * 100}%`, animationDelay: `${i * 60}ms` }}
              />
            </div>
          </div>
          <span className="font-mono text-sm font-semibold text-spend tnum whitespace-nowrap">{formatMoney(t.amount_cents, { showSign: true })}</span>
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------------
   The page
   ------------------------------------------------------------------ */

const GRANULARITIES = [
  { value: 'week', label: 'Weeks' },
  { value: 'month', label: 'Months' },
  { value: 'year', label: 'Years' },
];

// The eight summary cards' own Month/YTD toggle — separate from the
// Activity chart's Weeks/Months/Years control below, and deliberately
// scoped to just the cards for now: the category/person breakdowns
// and "largest this month" list further down are still one month at
// a time. Extending YTD to those too is a real next step, just a
// bigger one (each needs its own re-aggregated query) than flipping
// which already-fetched number eight cards display.
const VIEW_MODES = [
  { value: 'month', label: 'Month' },
  { value: 'ytd', label: 'YTD' },
];

export function Overview({ accounts = [], people = [], onChange }) {
  const [month, setMonth] = useState(currentMonth());
  const [viewMode, setViewMode] = useState('month');
  const [granularity, setGranularity] = useState('month');
  const [data, setData] = useState(null);
  const [trends, setTrends] = useState(null);
  const [zelleRows, setZelleRows] = useState(null);
  const [error, setError] = useState(null);
  const [dialog, setDialog] = useState(null); // 'salary' | 'spend' | null
  const { design } = useDesign();
  const vivid = design === 'vivid';
  // Which secondary cards to show (Settings → Overview cards) — null
  // while loading is fine, every card just renders on the first paint
  // and the (rare, no-op-after-first-load) preference fetch settles a
  // moment later; unset in the DB means "every card", same default
  // the toggle switches themselves start from.
  const [visibleCards, setVisibleCards] = useState(OVERVIEW_CARDS.map((c) => c.key));

  useEffect(() => {
    api.appSetting.get(OVERVIEW_CARDS_SETTING_KEY).then((r) => {
      if (r.value) setVisibleCards(r.value);
    }).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    try {
      const [summary, trend] = await Promise.all([
        api.summary(month),
        api.transactions.trends(granularity, month),
      ]);
      setData(summary);
      setTrends(trend);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, [month, granularity]);

  useEffect(() => { load(); }, [load]);

  // Independent of month/granularity - the Zelle card's own review
  // count and this-month figures are computed client-side from this,
  // not part of the server summary (see ZelleReview.jsx).
  const loadZelle = useCallback(() => {
    api.zelle.list().then(setZelleRows).catch(() => setZelleRows([]));
  }, []);
  useEffect(() => { loadZelle(); }, [loadZelle]);

  if (error) return <p className="text-sm text-spend">{error}</p>;
  if (!data || !trends) return <p className="text-sm text-muted">Loading…</p>;

  // Month/YTD picks which already-fetched number is the headline on
  // each card — every year_to_date_*_cents figure needed here was
  // already computed server-side for the detail dialogs, so this is
  // just which one eight cards point at, not a new data fetch.
  const isYtd = viewMode === 'ytd';
  const periodCaption = isYtd ? ytdLabel(month) : monthLabel(month);

  const spentCurrent = Math.abs(data.spend.current_spend_cents);
  const spentYtd = Math.abs(data.spend.year_to_date_spend_cents);
  const spent = isYtd ? spentYtd : spentCurrent;
  const prevSpent = Math.abs(data.spend.previous_spend_cents);
  const diff = spentCurrent - prevSpent;
  const maxCategory = Math.max(...data.by_category.map((c) => Math.abs(c.spend_cents)), 1);
  const incomeCurrent = data.spend.current_income_cents ?? 0;
  const incomeYtd = data.spend.year_to_date_income_cents ?? 0;
  const income = isYtd ? incomeYtd : incomeCurrent;
  const savings = data.savings ?? { current_savings_cents: 0, year_to_date_savings_cents: 0 };
  const savingsValue = isYtd ? savings.year_to_date_savings_cents : savings.current_savings_cents;
  const savingsNegative = savingsValue < 0;
  const loans = data.loans ?? { total_owed_cents: 0, nearest_deadline: null, loan_count: 0 };
  const loanTypes = loans.loan_types ?? [];
  // The card never hides — it shows what was actually owed AS OF the
  // selected month instead (no amortization/interest modeling, by
  // design — see CLAUDE.md's scope; this is the same statement-first,
  // formula-second, manual-fallback estimate routes/loans.js already
  // computes for "now", just asked about a different date). A month
  // before any loan's start_date has loan_count 0 — genuinely no loan
  // existed yet, not a $0 balance — so the card says so instead of
  // showing a number that isn't really "for" that period. A future
  // month is capped at today server-side rather than projected
  // forward, which would be forecasting.
  const hasLoansThisMonth = (loans.loan_count ?? 0) > 0;

  // Client-computed from GET /api/zelle - see loadZelle above. Needs
  // review is all-time (the whole backlog, not month-scoped); the net
  // figure once nothing's pending is this month's Sent minus Received.
  const zelleNeedsReview = (zelleRows ?? []).filter((r) => !r.zelle_type).length;
  const zelleThisMonth = (zelleRows ?? []).filter((r) => r.zelle_type && r.posted_date.startsWith(month));
  const zelleNetCents = zelleThisMonth.reduce((sum, r) => sum + (r.zelle_type === 'INTERNAL' ? 0 : r.amount_cents), 0);

  const EMPTY_SECONDARY = { current_cents: 0, previous_cents: 0, year_to_date_cents: 0 };
  const secondary = data.secondary ?? {
    cashback_interest: { ...EMPTY_SECONDARY, current_breakdown: {}, year_to_date_breakdown: {} },
    fee_interest: { ...EMPTY_SECONDARY, current_breakdown: {}, year_to_date_breakdown: {}, transactions: [] },
    investment: EMPTY_SECONDARY,
    india_transfer: EMPTY_SECONDARY,
  };
  const secondaryByMonth = data.secondary_by_month ?? [];
  const secondaryByAccount = data.secondary_by_account ?? [];
  const secondaryValue = (key) => (isYtd ? secondary[key].year_to_date_cents : secondary[key].current_cents);

  return (
    <div>
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <PageTitle className="text-2xl font-medium tracking-tight text-ink" emoji="🏠" tint="bg-vivid-green/15">Overview</PageTitle>
          <p className="mt-1 text-sm text-muted">Calendar months, not statement periods.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <MonthPicker value={month} onChange={setMonth} />
          <Segmented value={viewMode} onChange={setViewMode} options={VIEW_MODES} />
        </div>
      </header>

      {/* Four cards: Income, Spent, Loans, Savings. Equal weight on
          purpose — see the note at the top of this file about why the
          last version of this grid got reverted — but each now
          carries an icon and a top accent bar (style "B" from the
          owner's own four-way comparison), not the plain-text-only
          look from before. */}
      <section className="mb-10 grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          label="Income"
          accent="green"
          icon={<IncomeIcon />}
          tone="earn"
          animated
          value={formatMoney(income)}
          caption={periodCaption}
          onClick={() => setDialog('income')}
        />
        <SummaryCard
          label="Spent"
          accent="red"
          icon={<SpentIcon />}
          tone="spend"
          animated
          value={`−${formatMoney(spent)}`}
          caption={
            !isYtd && prevSpent > 0 && diff !== 0
              ? `${diff > 0 ? '↑' : '↓'} ${formatMoney(Math.abs(diff))} vs last month`
              : periodCaption
          }
          onClick={() => setDialog('spend')}
        />
        <SummaryCard
          label="Loans"
          accent="amber"
          icon={<LoansIcon />}
          tone="spend"
          animated
          value={hasLoansThisMonth ? formatMoney(loans.total_owed_cents) : 'No loans'}
          caption={
            hasLoansThisMonth && loanTypes.length > 0 ? (
              <span className="flex items-center gap-1.5">
                {loanTypes.slice(0, 3).map((t) => (
                  <span key={t} title={LOAN_TYPE_LABEL[t] ?? t}>{loanTypeIcon(t)}</span>
                ))}
                <span aria-hidden>+</span>
              </span>
            ) : !hasLoansThisMonth && month === currentMonth() ? (
              'Add your first loan'
            ) : null
          }
          onClick={() => setDialog('loans')}
        />
        <SummaryCard
          label="Savings"
          accent="purple"
          icon={<SavingsIcon />}
          tone={savingsNegative ? 'spend' : 'earn'}
          animated
          value={formatMoney(savingsValue)}
          caption={periodCaption}
          onClick={() => setDialog('savings')}
        />
      </section>

      {/* Smaller cards below the main row — real money the household
          already tracks by hand but that doesn't belong on the
          primary number. Half the visual weight (SummaryCard's
          `compact`), same icon + accent-bar language, no per-person
          split — see SecondaryDetail.jsx for why. Back to four and
          the plain grid: Interest Earned/Charged were each too small
          on their own (a few dollars either way) to earn a full
          card, so they folded into Cashback and Fees respectively —
          the household's own call once five stopped fitting cleanly
          and a scrolling strip (tried first) felt like the wrong fix
          for what was really just one card too many. */}
      <section className="mb-10 grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-4">
        {visibleCards.includes('cashback_interest') && (
          <SummaryCard
            compact
            animated
            label="Cashback & Interest"
            accent="green"
            icon={<CashbackIcon />}
            tone="earn"
            value={formatMoney(secondaryValue('cashback_interest'))}
            caption={periodCaption}
            onClick={() => setDialog('cashback_interest')}
          />
        )}
        {visibleCards.includes('fee_interest') && (
          <SummaryCard
            compact
            animated
            label="Fees & Interest"
            accent="red"
            icon={<FeeIcon />}
            tone="spend"
            value={secondaryValue('fee_interest') === 0 ? '—' : formatMoney(secondaryValue('fee_interest'))}
            caption={secondaryValue('fee_interest') === 0 ? (isYtd ? 'None this year' : 'None this month') : periodCaption}
            onClick={() => setDialog('fee_interest')}
          />
        )}
        {visibleCards.includes('investment') && (
          <SummaryCard
            compact
            animated
            label="Investment"
            accent="blue"
            icon={<InvestmentIcon />}
            tone="ink"
            value={secondaryValue('investment') === 0 ? '—' : formatMoney(secondaryValue('investment'))}
            caption={secondaryValue('investment') === 0 ? (isYtd ? 'None this year' : 'None this month') : periodCaption}
            onClick={() => setDialog('investment')}
          />
        )}
        {visibleCards.includes('india_transfer') && (
          <SummaryCard
            compact
            animated
            label="To India"
            accent="teal"
            icon={<TransferOutIcon />}
            tone="spend"
            value={secondaryValue('india_transfer') === 0 ? '—' : formatMoney(secondaryValue('india_transfer'))}
            caption={secondaryValue('india_transfer') === 0 ? (isYtd ? 'None this year' : 'None this month') : periodCaption}
            onClick={() => setDialog('india_transfer')}
          />
        )}
        {/* Zelle activity mixes transfers between the household's own
            accounts with real payments to other people — reviewed by
            hand, one row at a time, in the dialog this opens
            (ZelleReview.jsx). While anything's unreviewed the card
            surfaces the backlog instead of a number that would be
            wrong in an unpredictable direction. */}
        {visibleCards.includes('zelle') && (
          <SummaryCard
            compact
            label="Zelle Transfers"
            accent="pink"
            icon={<PersonTransferIcon />}
            tone="ink"
            value={zelleNeedsReview > 0 ? `${zelleNeedsReview} to review` : formatMoney(zelleNetCents)}
            caption={zelleNeedsReview > 0 ? 'Click to review' : periodCaption}
            onClick={() => setDialog('zelle')}
          />
        )}
      </section>

      {/* Activity chart (75%) and this month's category mix (25%) —
          the same "where it's going" question the bar list below
          already answers in exact dollars, here as a quick glanceable
          shape instead. */}
      <div className="mb-10 flex flex-col gap-5 lg:flex-row">
        <section className="rounded-2xl border border-rule bg-raised p-5 lg:w-3/4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-baseline gap-3">
              <h3 className="text-base font-medium text-ink">Activity</h3>
              <span className="text-sm text-faint">
                {granularity === 'week' && `${monthLabel(month)}, week by week`}
                {granularity === 'month' && `${month.slice(0, 4)}, month by month`}
                {granularity === 'year' && 'every year on record'}
              </span>
            </div>
            <div className="flex items-center gap-4">
              <span className="hidden items-center gap-3 text-xs text-muted sm:flex">
                <span className="flex items-center gap-1.5"><span className={`inline-block size-2 rounded-sm ${vivid ? 'bg-vivid-red' : 'bg-spend'}`} /> spent</span>
                <span className="flex items-center gap-1.5"><span className={`inline-block size-2 rounded-sm ${vivid ? 'bg-vivid-green' : 'bg-earn'}`} /> earned</span>
              </span>
              <Segmented value={granularity} onChange={setGranularity} options={GRANULARITIES} />
            </div>
          </div>
          {vivid && granularity === 'month' ? (
            <>
              <div className={LEDGER_GUTTER}>
                <BarChart buckets={trends.buckets} granularity={granularity} month={month} vivid />
              </div>
              <SavedLedger
                year={month.slice(0, 4)}
                incomeByMonth={data.income_by_month}
                spendByMonth={data.spend_by_month}
                ytdIncome={data.spend.year_to_date_income_cents}
                ytdSpend={data.spend.year_to_date_spend_cents}
                ytdLoanPayments={data.spend.year_to_date_loan_payment_cents}
              />
            </>
          ) : (
            <BarChart buckets={trends.buckets} granularity={granularity} month={month} vivid={vivid} />
          )}
        </section>

        <section className="rounded-2xl border border-rule bg-raised p-5 lg:w-1/4">
          <h3 className="mb-4 text-base font-medium text-ink">Spend mix</h3>
          {vivid ? (
            <SpendMixBars byCategory={data.by_category} total={spentCurrent} />
          ) : (
            <CategoryDonut byCategory={data.by_category} total={spentCurrent} />
          )}
        </section>
      </div>

      {/* Spend by category — where the money above is actually going. */}
      <section className="mb-10 rounded-2xl border border-rule bg-raised p-5">
        <div className="mb-4">
          <h3 className="text-base font-medium text-ink">Where it's going</h3>
        </div>
        {data.by_category.length === 0 ? (
          <p className="text-sm text-muted">Nothing spent this month.</p>
        ) : (
          <div className="space-y-2.5">
            {data.by_category.map((category, i) => {
              const amount = Math.abs(category.spend_cents);
              // Vivid: the top six share their Spend mix bar color (both
              // lists are biggest-first), the rest stay neutral like its "+N more".
              const barColor = vivid ? VIVID_MIX_COLORS[i] ?? 'bg-rule-str' : 'bg-spend';
              return (
                <div key={category.category_id ?? 'none'} className="flex items-center gap-3">
                  <div className="w-36 truncate text-sm text-ink">{category.name}</div>
                  <div className="flex-1">
                    <div
                      className={`h-2.5 ${vivid ? 'animate-bar-grow rounded-full' : 'rounded-r'} ${barColor}`}
                      style={{ width: `${Math.max((amount / maxCategory) * 100, 1)}%` }}
                    />
                  </div>
                  <div className="w-24 text-right font-mono text-sm text-ink tnum">
                    {formatMoney(amount)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Where it's going, by person — the same question, split two
          ways, as plain figures rather than a colored tile each.
          net_cents isn't clamped at 0 (see routes/summary.js), so a
          person who went net positive this month (a refund/credit
          bigger than what they spent) shows a signed "+" here rather
          than a flat, misleading $0.00. */}
      {vivid && data.by_person.length > 0 && (
        <VividByPerson byPerson={data.by_person} people={people} />
      )}
      {!vivid && data.by_person.length > 0 && (
        <div className="mb-10 flex flex-wrap gap-x-8 gap-y-1.5 text-sm text-muted">
          {data.by_person.map((person) => (
            <span key={person.id}>
              {maskName(person.name)}{' '}
              <span className={`font-mono tnum ${person.net_cents >= 0 ? 'text-earn' : 'text-ink'}`}>
                {person.net_cents >= 0 ? '+' : ''}{formatMoney(Math.abs(person.net_cents))}
              </span>
            </span>
          ))}
        </div>
      )}

      {/* Largest transactions */}
      <section className="mb-10 rounded-2xl border border-rule bg-raised p-5">
        <div className="mb-4">
          <h3 className="text-base font-medium text-ink">Largest this month</h3>
        </div>
        {data.largest.length === 0 ? (
          <p className="text-sm text-muted">No transactions yet this month.</p>
        ) : vivid ? (
          <VividLargest largest={data.largest} byCategory={data.by_category} />
        ) : (
          <table className="w-full border-collapse text-sm">
            <tbody>
              {data.largest.map((t) => (
                <tr key={t.id} className="border-b border-rule last:border-0">
                  <td className="py-2.5 pr-3">
                    <MerchantAvatar
                      merchant={t.merchant}
                      txnType={t.txn_type}
                      amountCents={t.amount_cents}
                      categoryName={t.category_name}
                      categoryIconKey={t.category_icon_key}
                      size={30}
                    />
                  </td>
                  <td className="max-w-md truncate py-2.5 pr-4 text-ink" title={t.description}>
                    {t.merchant ?? t.description}
                  </td>
                  <td className="py-2.5 pr-4">
                    <span className="rounded-full bg-band px-2 py-0.5 text-xs text-muted">
                      {t.category_name ?? 'Uncategorized'}
                    </span>
                  </td>
                  <td className="py-2.5 text-right font-mono text-spend tnum whitespace-nowrap">
                    {formatMoney(t.amount_cents, { showSign: true })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {dialog === 'income' && (
        <IncomeDetail
          month={monthLabel(month)}
          year={month.slice(0, 4)}
          total={income}
          yearToDate={data.spend.year_to_date_income_cents}
          incomeByMonth={data.income_by_month}
          byPerson={data.by_person}
          salaryLines={data.salary_lines}
          otherIncome={data.other_income}
          people={people}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'spend' && (
        <SpendDetail
          month={monthLabel(month)}
          year={month.slice(0, 4)}
          total={spent}
          yearToDate={data.spend.year_to_date_spend_cents}
          spendByMonth={data.spend_by_month}
          byPerson={data.by_person}
          byPersonCategory={data.spend_by_person_category}
          zelleSent={data.zelle_sent}
          people={people}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'savings' && (
        <SavingsDetail
          month={monthLabel(month)}
          year={month.slice(0, 4)}
          total={savings.current_savings_cents}
          yearToDate={savings.year_to_date_savings_cents}
          savingsByMonth={data.savings_by_month}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'loans' && (
        <LoansDetail accounts={accounts} month={month} onClose={() => setDialog(null)} onChanged={onChange} />
      )}
      {dialog === 'cashback_interest' && (
        <SecondaryDetail
          title="Cashback & Interest"
          emoji="🎁"
          tint="bg-vivid-green/10"
          month={monthLabel(month)}
          year={month.slice(0, 4)}
          total={secondary.cashback_interest.current_cents}
          yearToDate={secondary.cashback_interest.year_to_date_cents}
          byMonth={secondaryByMonth}
          byAccount={secondaryByAccount}
          valueKey="cashback_interest_cents"
          breakdown={[
            { label: 'Cashback', amount: secondary.cashback_interest.year_to_date_breakdown.cashback_cents ?? 0 },
            { label: 'Statement credits', amount: secondary.cashback_interest.year_to_date_breakdown.statement_credit_cents ?? 0 },
            { label: 'Interest earned', amount: secondary.cashback_interest.year_to_date_breakdown.interest_earned_cents ?? 0 },
          ]}
          description="Cashback is read straight off each statement, never calculated. Statement credits are hand-confirmed promos — a Disney+ or Food Lion offer — that post as an ordinary refund until recategorized once confirmed real. Interest earned is a savings or checking account's own real accrual, folded in here since it's rarely more than a few dollars on its own."
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'fee_interest' && (
        <SecondaryDetail
          title="Fees & Interest"
          emoji="🧾"
          tint="bg-vivid-red/10"
          month={monthLabel(month)}
          year={month.slice(0, 4)}
          total={secondary.fee_interest.current_cents}
          yearToDate={secondary.fee_interest.year_to_date_cents}
          byMonth={secondaryByMonth}
          byAccount={secondaryByAccount}
          valueKey="fee_interest_cents"
          breakdown={[
            { label: 'Fees', amount: secondary.fee_interest.year_to_date_breakdown.fee_cents ?? 0 },
            { label: 'Interest charged', amount: secondary.fee_interest.year_to_date_breakdown.interest_charged_cents ?? 0 },
          ]}
          transactions={secondary.fee_interest.transactions}
          description="Every real fee (a card's annual fee, a late fee, a balance-transfer fee) plus any real interest a card or loan charged — none of it spending on anything, just the cost of carrying the account. Interest charged folded in here since it's rarely more than a few dollars on its own."
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'investment' && (
        <SecondaryDetail
          title="Investment"
          emoji="📊"
          tint="bg-vivid-blue/10"
          month={monthLabel(month)}
          year={month.slice(0, 4)}
          total={secondary.investment.current_cents}
          yearToDate={secondary.investment.year_to_date_cents}
          byMonth={secondaryByMonth}
          byAccount={secondaryByAccount}
          valueKey="investment_cents"
          description="Money moved to Robinhood — a transfer, not spending. The Robinhood Gold Card's own subscription fee is tracked separately, under Fees & Interest, not here."
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'india_transfer' && (
        <SecondaryDetail
          title="Transfers to India"
          emoji="🌏"
          tint="bg-vivid-teal/10"
          month={monthLabel(month)}
          year={month.slice(0, 4)}
          total={secondary.india_transfer.current_cents}
          yearToDate={secondary.india_transfer.year_to_date_cents}
          byMonth={secondaryByMonth}
          byAccount={secondaryByAccount}
          valueKey="india_transfer_cents"
          description="Real remittances sent to India, hand-categorized off transactions from Frex, Tribe, and similar services — never guessed from an amount or a merchant name alone."
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'zelle' && (
        <ZelleReview
          onClose={() => setDialog(null)}
          onChanged={() => { loadZelle(); load(); }}
        />
      )}
    </div>
  );
}
