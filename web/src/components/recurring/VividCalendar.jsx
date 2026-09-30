import { AnimatePresence, motion } from 'motion/react';
import { formatMoney, formatShortDate } from '../../api';
import { RecurringIcon } from '../RecurringIcon';
import { MerchantAvatar } from '../MerchantAvatar';

/**
 * The Vivid recurring calendar (D143). RecurringCalendar still owns the
 * data, the month, the selection and the keyboard — this only draws.
 * The old grid hid nearly everything the API sends (a faint tint per
 * day, grey icons); this puts it on the surface:
 *
 *   - a month strip: spent, recurring and its share, paid/upcoming/missed
 *   - day cards with that day's spend written out and a spend bar
 *   - recurring chips ringed in their status color, so a missed bill
 *     is red at a glance instead of a hover away
 *   - the month slides in the direction you moved; the side panel
 *     animates between a day and a series
 */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const STATUS = {
  PAID: { label: 'Paid', emoji: '✅', ring: 'ring-vivid-green', dot: 'bg-vivid-green', pill: 'bg-vivid-green/10 text-vivid-green' },
  UPCOMING: { label: 'Upcoming', emoji: '⏳', ring: 'ring-vivid-amber', dot: 'bg-vivid-amber', pill: 'bg-vivid-amber/15 text-ink' },
  MISSED: { label: 'Missed', emoji: '⚠️', ring: 'ring-vivid-red', dot: 'bg-vivid-red', pill: 'bg-vivid-red/10 text-vivid-loss' },
};

const longDate = (iso) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

function MonthStrip({ data }) {
  const counts = { PAID: 0, UPCOMING: 0, MISSED: 0 };
  for (const day of data.days) if (day.in_month) for (const r of day.recurring) counts[r.status] += 1;
  const spent = Math.abs(data.totals.spend_cents);
  const recurring = Math.abs(data.totals.recurring_spend_cents);
  const share = spent > 0 ? Math.round((recurring / spent) * 100) : 0;

  return (
    <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <div className="rounded-2xl bg-vivid-red/10 p-3.5">
        <div className="text-xs text-muted">💸 Spent this month</div>
        <div className="font-mono text-lg font-semibold tnum text-vivid-loss">{formatMoney(spent)}</div>
      </div>
      <div className="rounded-2xl bg-vivid-purple/10 p-3.5">
        <div className="text-xs text-muted">🔁 On recurring</div>
        <div className="font-mono text-lg font-semibold tnum text-ink">{formatMoney(recurring)}</div>
        <div className="mt-1.5 h-1.5 rounded-full bg-raised">
          <motion.div
            className="h-1.5 rounded-full bg-vivid-purple"
            initial={{ width: 0 }}
            animate={{ width: `${share}%` }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          />
        </div>
        <div className="mt-1 text-[11px] text-muted">{share}% of the month</div>
      </div>
      <div className="col-span-2 flex items-center justify-around rounded-2xl bg-band/60 p-3.5">
        {Object.entries(STATUS).map(([key, s]) => (
          <div key={key} className="text-center">
            <div className="text-xl leading-none" aria-hidden="true">{s.emoji}</div>
            <div className="mt-1 font-mono text-lg font-semibold tnum text-ink">{counts[key]}</div>
            <div className="text-[11px] text-muted">{s.label.toLowerCase()}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Chip({ chip, onSelect }) {
  const s = STATUS[chip.status];
  return (
    <motion.button
      onClick={(e) => {
        e.stopPropagation();
        onSelect(chip);
      }}
      title={`${chip.name} · ${s.label.toLowerCase()} · ${formatMoney(chip.amount_cents)}`}
      whileHover={{ scale: 1.18, rotate: -6 }}
      whileTap={{ scale: 0.95 }}
      className={`relative flex size-7 shrink-0 items-center justify-center rounded-lg bg-raised ring-2 ${s.ring} ${
        chip.status === 'UPCOMING' ? 'opacity-80' : ''
      }`}
    >
      <RecurringIcon name={chip.name} glyph={chip.glyph} size={17} />
      <span className={`absolute -right-1 -top-1 size-2.5 rounded-full border-2 border-raised ${s.dot}`} />
    </motion.button>
  );
}

function DayCard({ day, isToday, isSelected, isWeekend, maxSpendCents, onSelectDay, onSelectChip }) {
  const spend = Math.abs(day.total_spend_cents);
  const ratio = maxSpendCents ? Math.min(spend / maxSpendCents, 1) : 0;
  const shown = day.recurring.slice(0, 3);
  const extra = day.recurring.length - shown.length;
  const dayNumber = Number(day.date.slice(8, 10));

  return (
    <motion.div
      role="button"
      tabIndex={0}
      onClick={() => onSelectDay(day)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelectDay(day);
        }
      }}
      whileHover={day.in_month ? { y: -3 } : undefined}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      className={`relative flex min-h-[96px] cursor-pointer flex-col gap-1.5 rounded-xl border p-2 pb-3.5 transition-shadow hover:shadow-md ${
        isSelected ? 'border-transparent ring-2 ring-vivid-green' : 'border-rule'
      } ${!day.in_month ? 'opacity-35' : isToday ? 'bg-vivid-green/5' : isWeekend ? 'bg-band/40' : 'bg-raised'}`}
    >
      <div className="flex items-center justify-between gap-1">
        {isToday ? (
          <span className="flex size-6 items-center justify-center rounded-full bg-vivid-green text-xs font-semibold tnum text-white">
            {dayNumber}
          </span>
        ) : (
          <span className={`text-sm font-medium tnum ${day.in_month ? 'text-ink' : 'text-faint'}`}>{dayNumber}</span>
        )}
        {spend > 0 && day.in_month && (
          <span className="font-mono text-[10px] font-medium tnum text-vivid-loss">{formatMoney(-spend, { compact: true })}</span>
        )}
      </div>

      {shown.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {shown.map((chip, i) => (
            <Chip key={`${chip.series_id}-${i}`} chip={chip} onSelect={onSelectChip} />
          ))}
          {extra > 0 && <span className="flex size-7 items-center justify-center text-xs text-muted">+{extra}</span>}
        </div>
      )}

      {ratio > 0 && day.in_month && (
        <div className="absolute inset-x-2 bottom-1.5 h-1 rounded-full bg-band">
          <div className="h-1 rounded-full bg-vivid-red/70" style={{ width: `${Math.max(ratio * 100, 6)}%` }} />
        </div>
      )}
    </motion.div>
  );
}

function DayPanel({ day }) {
  const spend = Math.abs(day.total_spend_cents);
  return (
    <div>
      <h3 className="text-base font-medium text-ink">{longDate(day.date)}</h3>
      <p className="mb-4 text-sm text-muted">
        {spend > 0 ? (
          <>
            <span className="font-mono font-semibold text-vivid-loss">{formatMoney(spend)}</span> spent across{' '}
            {day.transactions.length} transaction{day.transactions.length === 1 ? '' : 's'}
          </>
        ) : (
          'A no-spend day 🌿'
        )}
      </p>

      {day.recurring.length > 0 && (
        <ul className="mb-4 flex flex-col gap-2">
          {day.recurring.map((r, i) => {
            const s = STATUS[r.status];
            return (
              <li key={i} className="flex items-center gap-2.5 rounded-xl bg-band/50 p-2">
                <RecurringIcon name={r.name} glyph={r.glyph} size={24} />
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{r.name}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${s.pill}`}>
                  {s.emoji} {s.label}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {day.transactions.length > 0 && (
        <ul className="flex flex-col gap-2">
          {day.transactions.map((t) => (
            <li key={t.id} className="flex items-center gap-2.5 text-sm">
              <MerchantAvatar merchant={t.merchant} description={t.description} size={26} clickable={false} />
              <span className="min-w-0 flex-1 truncate text-ink">{t.merchant || t.description}</span>
              <span className="shrink-0 font-mono text-xs tnum text-vivid-loss">{formatMoney(t.amount_cents)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const CADENCE = { WEEKLY: 'Weekly', MONTHLY: 'Monthly', QUARTERLY: 'Quarterly', YEARLY: 'Yearly', ANNUAL: 'Yearly' };

function SeriesPanel({ series, transactions }) {
  if (!series) return <p className="text-sm text-muted">Loading…</p>;
  const max = Math.max(1, ...(transactions ?? []).map((t) => Math.abs(t.amount_cents)));
  const facts = [
    ['💰', formatMoney(series.expected_amount_cents), series.amount_varies ? 'usually' : 'each time'],
    ['🗓️', CADENCE[series.cadence] ?? series.cadence?.toLowerCase(), 'cadence'],
    ['🔢', `${series.occurrence_count}×`, 'seen so far'],
    series.next_expected_date && ['⏭️', formatShortDate(series.next_expected_date), 'next expected'],
  ].filter(Boolean);

  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-band">
          <RecurringIcon name={series.name} glyph={series.glyph} size={30} />
        </span>
        <div className="min-w-0">
          <h3 className="truncate text-base font-medium text-ink">{series.name}</h3>
          <p className="truncate text-xs text-muted">
            {[series.category_name, series.account_name].filter(Boolean).join(' · ') || 'Recurring charge'}
          </p>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2">
        {facts.map(([emoji, value, label]) => (
          <div key={label} className="rounded-xl bg-band/50 p-2">
            <div className="font-mono text-sm font-semibold tnum text-ink">
              <span aria-hidden="true">{emoji}</span> {value}
            </div>
            <div className="text-[11px] text-muted">{label}</div>
          </div>
        ))}
      </div>

      <h4 className="mb-2 text-xs font-medium text-muted">Payment history</h4>
      {transactions === null ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : transactions.length === 0 ? (
        <p className="text-sm text-muted">No payments matched yet.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {transactions.map((t, i) => (
            <li key={t.id} className="grid grid-cols-[3.5rem_1fr_auto] items-center gap-2 text-xs">
              <span className="tnum text-muted">{formatShortDate(t.posted_date)}</span>
              <span className="h-1.5 rounded-full bg-band">
                <motion.span
                  className="block h-1.5 rounded-full bg-vivid-purple"
                  initial={{ width: 0 }}
                  animate={{ width: `${(Math.abs(t.amount_cents) / max) * 100}%` }}
                  transition={{ delay: i * 0.04, duration: 0.5, ease: 'easeOut' }}
                />
              </span>
              <span className="font-mono tnum text-vivid-loss">{formatMoney(t.amount_cents)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function VividCalendar({
  header, data, month, direction, today, maxSpendCents, selection, selectedSeries, seriesTransactions,
  onSelectDay, onSelectChip,
}) {
  const panelKey = selection === null ? 'none' : selection.type === 'day' ? `day-${selection.day.date}` : `series-${selection.seriesId}`;

  return (
    <section>
      {header}
      <MonthStrip data={data} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_280px]">
        <div className="overflow-hidden">
          <div className="mb-1.5 grid grid-cols-7 gap-1.5 text-center text-xs font-medium">
            {WEEKDAYS.map((w, i) => (
              <div key={w} className={i === 0 || i === 6 ? 'text-vivid-purple' : 'text-muted'}>
                {w}
              </div>
            ))}
          </div>
          <AnimatePresence mode="popLayout" initial={false} custom={direction}>
            <motion.div
              key={month}
              custom={direction}
              initial={{ x: direction * 40, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: direction * -40, opacity: 0 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="grid grid-cols-7 gap-1.5"
            >
              {data.days.map((day, i) => (
                <DayCard
                  key={day.date}
                  day={day}
                  isToday={day.date === today}
                  isSelected={selection?.type === 'day' && selection.day.date === day.date}
                  isWeekend={i % 7 === 0 || i % 7 === 6}
                  maxSpendCents={maxSpendCents}
                  onSelectDay={onSelectDay}
                  onSelectChip={onSelectChip}
                />
              ))}
            </motion.div>
          </AnimatePresence>
          <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-muted">
            {Object.values(STATUS).map((s) => (
              <span key={s.label} className="flex items-center gap-1.5">
                <span className={`size-2.5 rounded-full ${s.dot}`} /> {s.label}
              </span>
            ))}
            <span className="flex items-center gap-1.5">
              <span className="h-1 w-5 rounded-full bg-vivid-red/70" /> spend that day
            </span>
          </div>
        </div>

        <div className="self-start rounded-2xl border border-rule bg-raised p-4 shadow-sm lg:sticky lg:top-6">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={panelKey}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              {selection === null && (
                <div className="py-6 text-center">
                  <div className="text-3xl" aria-hidden="true">👆</div>
                  <p className="mt-2 text-sm text-muted">Pick a day or a recurring icon to see its story.</p>
                </div>
              )}
              {selection?.type === 'day' && <DayPanel day={selection.day} />}
              {selection?.type === 'series' && <SeriesPanel series={selectedSeries} transactions={seriesTransactions} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
