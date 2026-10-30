import { useState } from 'react';
import { formatMoney } from '../../api';
import { Segmented } from '../ui/Form';
import { useDesign } from '../../hooks/use-design';
import { monthLong } from '../../lib/app/dates';

/** Overview's Activity section (D373, D375): spent and earned per week, month or year, and Vivid's and Glass's ledger under the months. */

const monthLabel = monthLong;

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
              <rect className="chart-bar" x={x0} y={plotBottom - spendH} width={barWidth} height={spendH} rx="2" fill={vivid ? 'var(--color-vivid-red)' : 'var(--chart-spend, var(--color-spend))'} />
              <rect className="chart-bar" x={x0 + barWidth + gap} y={plotBottom - earnH} width={barWidth} height={earnH} rx="2" fill={vivid ? 'var(--color-vivid-green)' : 'var(--chart-earn, var(--color-earn))'} />
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
                className={`text-center ${m.saved == null ? '' : m.saved < 0 ? 'text-spend' : 'text-earn'}`}
              >
                {m.saved == null ? '' : formatMoney(m.saved, { showSign: true, compact: true })}
              </span>
            ))}
          </div>
          <div className={`${LEDGER_GRID} items-center bg-band py-2 font-mono font-medium tnum`}>
            <span className="sticky left-0 z-[1] bg-band pl-3 font-sans font-normal text-muted">Kept</span>
            {months.map((m) => (
              <span key={m.key} className={`text-center ${m.kept != null && m.kept < 0 ? 'text-spend' : 'text-ink'}`}>
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
            <span className={`font-mono text-sm font-semibold tnum ${ytdSaved < 0 ? 'text-spend' : 'text-earn'}`}>
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

const GRANULARITIES = [
  { value: 'week', label: 'Weeks' },
  { value: 'month', label: 'Months' },
  { value: 'year', label: 'Years' },
];

export function ActivitySection({ data, trends, month, granularity, onGranularity }) {
  const { design } = useDesign();
  const vivid = design === 'vivid';
  return (
    <section className="rounded-2xl border border-rule bg-raised p-5">
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
          <Segmented value={granularity} onChange={onGranularity} options={GRANULARITIES} />
        </div>
      </div>
      {/* The Saved / Kept ledger under the months: Vivid's, and Glass's (D235). */}
      {(vivid || design === 'glass') && granularity === 'month' ? (
        <>
          <div className={LEDGER_GUTTER}>
            <BarChart buckets={trends.buckets} granularity={granularity} month={month} vivid={vivid} />
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
  );
}
