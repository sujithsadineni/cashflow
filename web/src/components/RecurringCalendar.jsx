import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, formatMoney, formatShortDate } from '../api';
import { RecurringIcon } from './RecurringIcon';
import { VividCalendar } from './recurring/VividCalendar';
import { useDesign } from '../design-context';

/**
 * The full-page calendar: a month grid of daily spend plus recurring
 * due dates, predicted vs. actual kept visually distinct. Predictions
 * come from GET /api/calendar, computed live from `recurring_series`
 * on every request — nothing here is ever written to `transaction`.
 *
 * No per-category color-coding (14 categories on a grid is confetti).
 * A recurring series' glyph is the only visual key; daily spend
 * intensity is a tint ramp mixed from the `band` token alone, so the
 * grid introduces no new hues — `spend` keeps its one job (MISSED,
 * the only saturated color that appears here) and so does `earn`
 * (unused on this grid, since every chip here is money going out).
 */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const thisMonth = () => new Date().toISOString().slice(0, 7);

function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * The month/year label opens this instead of only stepping one month
 * at a time — a year at once, then a direct click to any of its
 * months, for jumping further than a couple of clicks of ‹ › would
 * comfortably reach.
 */
function MonthPicker({ month, onSelect, onClose }) {
  const [y] = month.split('-').map(Number);
  const [pickerYear, setPickerYear] = useState(y);
  const thisY = new Date().getFullYear();
  const thisM = new Date().getMonth() + 1;
  const [selectedY, selectedM] = month.split('-').map(Number);

  return (
    <>
      <button
        aria-label="Close month picker"
        onClick={onClose}
        className="fixed inset-0 z-10 cursor-default"
      />
      <div className="absolute top-full left-0 z-20 mt-2 w-64 rounded-xl border border-rule bg-raised p-3 shadow-none">
        <div className="mb-2 flex items-center justify-between">
          <button
            onClick={() => setPickerYear((v) => v - 1)}
            aria-label="Previous year"
            className="rounded-md px-2 py-1 text-muted hover:bg-band hover:text-ink"
          >
            ‹
          </button>
          <span className="text-sm font-medium text-ink tnum">{pickerYear}</span>
          <button
            onClick={() => setPickerYear((v) => v + 1)}
            aria-label="Next year"
            className="rounded-md px-2 py-1 text-muted hover:bg-band hover:text-ink"
          >
            ›
          </button>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {MONTH_NAMES.map((name, i) => {
            const m = i + 1;
            const isSelected = pickerYear === selectedY && m === selectedM;
            const isCurrent = pickerYear === thisY && m === thisM;
            return (
              <button
                key={name}
                onClick={() => onSelect(`${pickerYear}-${String(m).padStart(2, '0')}`)}
                className={`relative rounded-md py-1.5 text-sm transition-colors ${
                  isSelected ? 'bg-ink text-paper' : 'text-ink hover:bg-band'
                }`}
              >
                {name.slice(0, 3)}
                {isCurrent && !isSelected && (
                  <span className="absolute right-1.5 top-1.5 size-1 rounded-full bg-earn" />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

// Mixed from --color-band alone (toward the page background at low
// intensity, toward band's full tint at high) — a heatmap with no new
// hues, per the design system's "spend/earn are the only saturated
// colors" rule.
// A continuous ramp, not stepped buckets — a stepped scale meant
// almost any nonzero spend day (even a $4 one) cleared the first
// bucket and read as "just as shaded" as the month's biggest day.
// Below 3% of the month's max, a day stays untinted rather than
// registering as visual noise.
function tintStyle(spendCents, maxSpendCents) {
  if (!spendCents || !maxSpendCents) return undefined;
  const ratio = Math.min(Math.abs(spendCents) / Math.abs(maxSpendCents), 1);
  if (ratio < 0.03) return undefined;
  const pct = Math.round(10 + ratio * 55); // 10%..65%
  return { backgroundColor: `color-mix(in srgb, var(--color-band) ${pct}%, var(--color-paper))` };
}

const CHIP_STYLES = {
  PAID: 'border-rule-str bg-raised text-ink',
  UPCOMING: 'border-dashed border-rule-str text-muted',
  MISSED: 'border-spend text-spend',
};

// Icon-only — the glyph alone is the visual key (per the design:
// "10-15 symbols I recognise, not a colour legend to learn"). Name and
// amount live in the tooltip and in the detail panel on click; a tiny
// grid cell has no room to spell either out without truncating into
// unreadable fragments.
function RecurringChip({ chip, onSelect }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onSelect(chip); }}
      title={`${chip.name} · ${chip.status.toLowerCase()} · ${formatMoney(chip.amount_cents)}`}
      className={`flex size-6 shrink-0 items-center justify-center rounded-md border p-0.5 text-sm ${CHIP_STYLES[chip.status]}`}
    >
      <RecurringIcon name={chip.name} glyph={chip.glyph} size={16} />
    </button>
  );
}

function DayCell({ day, isToday, maxSpendCents, onSelectDay, onSelectChip }) {
  const shown = day.recurring.slice(0, 4);
  const extra = day.recurring.length - shown.length;

  return (
    // A day cell holds recurring chips that are themselves buttons —
    // nesting a <button> inside a <button> is invalid HTML (and reads
    // as a hydration error), so this is a div acting as one instead.
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelectDay(day)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectDay(day); } }}
      style={tintStyle(day.total_spend_cents, maxSpendCents)}
      className={`flex min-h-[64px] cursor-pointer flex-col gap-1.5 rounded-lg border p-1.5 text-left transition-colors hover:border-rule-str ${
        isToday ? 'border-earn/50' : 'border-rule'
      } ${day.in_month ? '' : 'opacity-50'}`}
    >
      {isToday ? (
        <span className="flex size-5 items-center justify-center rounded-full bg-earn text-xs font-semibold tnum text-paper">
          {Number(day.date.slice(8, 10))}
        </span>
      ) : (
        <span className={`tnum text-sm ${day.in_month ? 'text-ink' : 'text-faint'}`}>
          {Number(day.date.slice(8, 10))}
        </span>
      )}

      {shown.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {shown.map((chip, i) => (
            <RecurringChip key={`${chip.series_id}-${i}`} chip={chip} onSelect={onSelectChip} />
          ))}
          {extra > 0 && <span className="flex size-6 items-center justify-center text-xs text-faint">+{extra}</span>}
        </div>
      )}
    </div>
  );
}

function DayPanel({ day }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-medium text-ink">{day.date}</h3>
      {day.transactions.length === 0 ? (
        <p className="text-sm text-muted">No transactions this day.</p>
      ) : (
        <ul className="space-y-1.5">
          {day.transactions.map((t) => (
            <li key={t.id} className="flex justify-between gap-2 text-sm">
              <span className="min-w-0 truncate text-muted">{t.merchant || t.description}</span>
              <span className="shrink-0 font-mono tnum text-spend">{formatMoney(t.amount_cents)}</span>
            </li>
          ))}
        </ul>
      )}
      {day.recurring.length > 0 && (
        <>
          <h4 className="mt-4 mb-1.5 text-sm font-medium text-muted">Recurring</h4>
          <ul className="space-y-1.5">
            {day.recurring.map((r, i) => (
              <li key={i} className="flex items-center justify-between gap-2 text-sm">
                <span className="flex min-w-0 items-center gap-1.5 truncate text-muted">
                  <RecurringIcon name={r.name} glyph={r.glyph} size={16} />
                  {r.name} · {r.status.toLowerCase()}
                </span>
                <span className="shrink-0 font-mono tnum text-spend">{formatMoney(r.amount_cents)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function SeriesPanel({ series, transactions }) {
  if (!series) return <p className="text-sm text-muted">Loading…</p>;
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <RecurringIcon name={series.name} glyph={series.glyph} size={28} />
        <h3 className="text-sm font-medium text-ink">{series.name}</h3>
      </div>
      <p className="mb-4 text-sm text-muted">
        {formatMoney(series.expected_amount_cents)} · seen {series.occurrence_count}× · {series.status.toLowerCase()}
      </p>
      {transactions === null ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        <ul className="space-y-1.5">
          {transactions.map((t) => (
            <li key={t.id} className="flex justify-between gap-2 text-sm">
              <span className="text-muted tnum">{formatShortDate(t.posted_date)}</span>
              <span className="font-mono tnum text-spend">{formatMoney(t.amount_cents)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AgendaList({ days, onSelectDay, onSelectChip }) {
  const withContent = days.filter((d) => d.in_month && (d.transactions.length > 0 || d.recurring.length > 0));

  if (withContent.length === 0) return <p className="text-sm text-muted">Nothing this month.</p>;

  return (
    <ul className="divide-y divide-rule">
      {withContent.map((day) => (
        <li key={day.date} className="py-2.5">
          <button onClick={() => onSelectDay(day)} className="mb-1 flex w-full items-baseline justify-between text-left">
            <span className="tnum text-sm text-ink">{day.date}</span>
            {day.total_spend_cents !== 0 && <span className="tnum text-sm text-muted">{formatMoney(day.total_spend_cents)}</span>}
          </button>
          <div className="flex flex-wrap gap-1">
            {day.recurring.map((chip, i) => (
              <RecurringChip key={i} chip={chip} onSelect={onSelectChip} />
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function RecurringCalendar({ series }) {
  const [params, setParams] = useSearchParams();
  const month = /^\d{4}-\d{2}$/.test(params.get('month') ?? '') ? params.get('month') : thisMonth();

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [selection, setSelection] = useState(null); // { type: 'day', day } | { type: 'series', seriesId }
  const [seriesTransactions, setSeriesTransactions] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [direction, setDirection] = useState(1); // which way the Vivid grid slides
  const { design } = useDesign();

  const goToMonth = (m) => {
    setDirection(m > month ? 1 : -1);
    setParams((prev) => { const next = new URLSearchParams(prev); next.set('month', m); return next; }, { replace: true });
  };

  // The month on screen stays up until the next one arrives, rather than
  // blanking to "Loading…" on every click — which is what lets Vivid
  // slide one month out as the next slides in (D143).
  useEffect(() => {
    let cancelled = false;
    api.calendar(month)
      .then((d) => { if (!cancelled) { setData(d); setError(null); } })
      .catch((err) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [month]);

  useEffect(() => {
    function onKeyDown(e) {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'ArrowLeft') goToMonth(shiftMonth(month, -1));
      if (e.key === 'ArrowRight') goToMonth(shiftMonth(month, 1));
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [month]);

  function selectChip(chip) {
    setSelection({ type: 'series', seriesId: chip.series_id });
    setSeriesTransactions(null);
    api.recurring.transactions(chip.series_id).then(setSeriesTransactions).catch(() => setSeriesTransactions([]));
  }

  if (error) return <p className="text-sm text-spend">{error}</p>;
  if (data === null) return <p className="text-sm text-muted">Loading calendar…</p>;

  const [y, m] = month.split('-').map(Number);
  const maxSpendCents = Math.max(1, ...data.days.filter((d) => d.in_month).map((d) => Math.abs(d.total_spend_cents)));
  const today = thisMonth() === month ? new Date().toISOString().slice(0, 10) : null;
  const selectedSeries = selection?.type === 'series' ? series.find((s) => s.id === selection.seriesId) : null;

  const header = (
      <div className="mb-4 flex items-center gap-3">
        <button onClick={() => goToMonth(shiftMonth(month, -1))} aria-label="Previous month" className="rounded-md border border-rule px-2 py-1 text-muted hover:bg-band">‹</button>
        <div className="relative">
          <button
            onClick={() => setPickerOpen((v) => !v)}
            className="min-w-[11ch] rounded-md px-1.5 py-0.5 text-base font-medium text-ink transition-colors hover:bg-band"
          >
            {MONTH_NAMES[m - 1]} {y}
          </button>
          {pickerOpen && (
            <MonthPicker
              month={month}
              onSelect={(m2) => { goToMonth(m2); setPickerOpen(false); }}
              onClose={() => setPickerOpen(false)}
            />
          )}
        </div>
        <button onClick={() => goToMonth(shiftMonth(month, 1))} aria-label="Next month" className="rounded-md border border-rule px-2 py-1 text-muted hover:bg-band">›</button>
        {month !== thisMonth() && (
          <button onClick={() => goToMonth(thisMonth())} className="text-sm text-muted underline-offset-4 hover:text-ink hover:underline">Today</button>
        )}
      </div>
  );

  const selectDay = (d) => setSelection({ type: 'day', day: d });

  if (design === 'vivid') {
    return (
      <VividCalendar
        header={header}
        data={data}
        month={data.month}
        direction={direction}
        today={today}
        maxSpendCents={maxSpendCents}
        selection={selection}
        selectedSeries={selectedSeries}
        seriesTransactions={seriesTransactions}
        onSelectDay={selectDay}
        onSelectChip={selectChip}
      />
    );
  }

  return (
    <section>
      {header}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_260px]">
        <div>
          <div className="hidden lg:block">
            <div className="mb-1 grid grid-cols-7 rounded-md bg-band/50 py-1 text-center text-xs font-medium text-muted">
              {WEEKDAYS.map((w) => <div key={w}>{w}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {data.days.map((day) => (
                <DayCell
                  key={day.date}
                  day={day}
                  isToday={day.date === today}
                  maxSpendCents={maxSpendCents}
                  onSelectDay={(d) => setSelection({ type: 'day', day: d })}
                  onSelectChip={selectChip}
                />
              ))}
            </div>
          </div>

          <div className="lg:hidden">
            <AgendaList days={data.days} onSelectDay={(d) => setSelection({ type: 'day', day: d })} onSelectChip={selectChip} />
          </div>
        </div>

        <div className="rounded-2xl border border-rule bg-raised p-4">
          {selection === null && <p className="text-sm text-muted">Click a day or a recurring icon for detail.</p>}
          {selection?.type === 'day' && <DayPanel day={selection.day} />}
          {selection?.type === 'series' && <SeriesPanel series={selectedSeries} transactions={seriesTransactions} />}
        </div>
      </div>
    </section>
  );
}
