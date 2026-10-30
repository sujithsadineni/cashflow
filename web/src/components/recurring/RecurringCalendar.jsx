import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { api, formatMoney } from '../../api';
import { useApi } from '../../hooks/use-api';
import { TxnName } from '../transactions/TxnName';
import { monthGrid, billMarks } from '../../lib/recurring/calendar';
import { monthLong } from '../../lib/app/dates';
import { MerchantAvatar } from '../ui/MerchantAvatar';
import { RecurringIcon } from './RecurringIcon';
import { Loading } from '../ui/Loading';

/**
 * The Recurring calendar (D321): the month on the left (four fifths), the
 * chosen day on the right. Calm by default, motion only for attention (D366):
 * each day is three rows — the date, its bills' logos side by side (all of
 * them, overlapping, the most urgent in front), what was spent — tinted grey by
 * how much was spent, so red only ever means "needs you". The day's edge is its
 * most urgent bill: charged has none (a small tick on the logo), to come a
 * dashed blue edge, missed a faded red one, and not charged yet a red edge with
 * a slow soft glow, the only thing that moves. Days lift a little on hover; the
 * selection glides, months slide. Reduce Motion, Classic, or a bill picked
 * below keep it still.
 */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** The edge a day takes from its most urgent bill; charged needs no edge. */
const EDGE = {
  paid: '',
  upcoming: 'outline-[1.5px] outline-dashed -outline-offset-2 outline-info/70',
  waiting: 'ring-[1.5px] ring-inset ring-spend',
  missed: 'ring-[1.5px] ring-inset ring-spend/40',
};
const DOT = { paid: 'bg-info', upcoming: 'bg-info/50', waiting: 'bg-spend', missed: 'bg-spend/50' };
const STATE_WORD = { paid: 'Charged', upcoming: 'Due', waiting: 'Not charged yet', missed: 'Missed' };
const URGENCY = { waiting: 0, missed: 1, upcoming: 2, paid: 3 };
const byUrgency = (a, b) => URGENCY[a.state] - URGENCY[b.state];
/** The glow's slow breath, for the one state that needs you. */
export const GLOW_S = 3;

/** How much a day spent: four steps of grey against the month's biggest day (red is kept for "needs you"). */
const heat = (cents, max) => (!cents || !max ? 0 : Math.min(4, Math.ceil((cents / max) * 4)));
const HEAT = ['', 'bg-ink/[0.03]', 'bg-ink/[0.06]', 'bg-ink/[0.09]', 'bg-ink/[0.13]'];

/** One bill's logo in the same rounded tile as every other, so the grid reads even; charged gets a tick, missed goes grey. */
function LogoTile({ mark, className = '' }) {
  return (
    <span className={`relative flex size-8 shrink-0 items-center justify-center rounded-lg bg-raised ring-1 ring-rule ${className}`}>
      <span className={`flex size-[26px] items-center justify-center overflow-hidden rounded-md ${mark.state === 'missed' ? 'opacity-50 grayscale' : ''}`}>
        <RecurringIcon name={mark.merchant} glyph={mark.glyph} size={26} />
      </span>
      {mark.state === 'paid' && (
        <span className="absolute -bottom-1 -right-1 flex size-3.5 items-center justify-center rounded-full bg-info ring-2 ring-raised" aria-hidden="true">
          <svg width="7" height="7" viewBox="0 0 8 8"><path d="M1.5 4.2 3.2 5.8 6.5 2.3" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
      )}
    </span>
  );
}

/** Not charged yet: a red edge that never goes, and over it a soft glow that slowly breathes. */
function Glow({ calm }) {
  if (calm) return null;
  return (
    <motion.span className="pointer-events-none absolute inset-0 rounded-xl bg-spend/[0.08] shadow-[0_0_14px_0_var(--color-spend)]" aria-hidden="true"
      initial={{ opacity: 0.2 }} animate={{ opacity: [0.2, 0.7, 0.2] }} transition={{ duration: GLOW_S, repeat: Infinity, ease: 'easeInOut' }} />
  );
}

/**
 * One day: three rows that never overlap — the date, its bills' logos (all of
 * them, overlapping, the most urgent in front; a phone has room for the most
 * urgent one, the day's list has the rest), what was spent.
 */
function Day({ date, today, selected, spent, marks: all, max, onPick, still, focus }) {
  if (!date) return <div aria-hidden="true" />;
  // A bill picked below: only its days, held still (D365).
  const marks = (focus != null ? all.filter((m) => m.bill_id === focus) : all).slice().sort(byUrgency);
  const calm = still || focus != null;
  const isToday = date === today;
  const future = date > today;
  const lead = marks[0];
  return (
    <button
      type="button" onClick={() => onPick(date)} aria-pressed={selected}
      aria-label={`${date}${spent ? `, ${formatMoney(spent)} spent` : ''}${marks.length ? `, ${marks.map((m) => `${m.name} ${STATE_WORD[m.state].toLowerCase()}`).join(', ')}` : ''}`}
      title={marks.map((m) => `${m.name} · ${STATE_WORD[m.state]} · ${formatMoney(m.cents)}`).join('\n') || undefined}
      className={`relative grid min-h-[4.75rem] grid-rows-[auto_1fr_auto] rounded-xl p-1.5 text-left transition-[background-color,transform] duration-200 ease-out sm:min-h-[6rem] sm:p-2 ${HEAT[heat(spent, max)]} hover:bg-band ${still ? '' : 'hover:-translate-y-0.5'}`}
    >
      {lead?.state === 'waiting' && <Glow calm={calm} />}
      {lead && <span className={`pointer-events-none absolute inset-0 rounded-xl ${EDGE[lead.state]}`} aria-hidden="true" />}
      {selected && (
        <motion.span layoutId="rc-selected" transition={still ? { duration: 0 } : { type: 'spring', bounce: 0.15, duration: 0.45 }}
          className="absolute inset-0 rounded-xl ring-2 ring-inset ring-info" aria-hidden="true" />
      )}
      {/* Bold, and a future day softer but never faint. */}
      <span className={`relative flex size-6 items-center justify-center rounded-full text-[14px] font-semibold tnum ${isToday ? 'bg-info text-white' : future ? 'text-ink/60' : 'text-ink'}`}>
        {Number(date.slice(8, 10))}
      </span>
      <span className="relative flex min-h-0 items-center justify-center">
        {marks.length > 0 && (
          <span className="flex scale-[0.75] items-center sm:scale-100">
            {marks.slice(0, 3).map((m, i) => (
              <LogoTile key={m.bill_id} mark={m} className={`${['z-30', 'z-20', 'z-10'][i]} ${i > 0 ? '-ml-2.5 hidden sm:flex' : ''}`} />
            ))}
                        {marks.length > 3 && <span className="ml-1 hidden text-[11px] font-medium text-muted tnum sm:inline">+{marks.length - 3}</span>}
          </span>
        )}
      </span>
      <span className="relative hidden h-4 truncate text-[11px] text-muted tnum sm:block">{spent > 0 ? formatMoney(spent) : ''}</span>
    </button>
  );
}

/** The chosen day: what was spent, the charges, and every transaction. */
function DayPanel({ date, today, marks, still }) {
  const req = useApi(`day:${date}`, () => api.transactions.list({ from: date, to: date, limit: 200 }), { tags: ['transactions'] });
  const rows = req.data?.rows ?? [];
  const spent = rows.filter((t) => t.amount_cents < 0 && !['payment', 'transfer', 'savings'].includes(t.txn_type)).reduce((n, t) => n - t.amount_cents, 0);
  const label = new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={date} initial={still ? false : { opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={still ? { opacity: 0 } : { opacity: 0, x: -8 }}
        transition={{ type: 'spring', bounce: 0, duration: 0.3 }} className="flex h-full flex-col">
        <p className="text-[13px] text-muted">{date === today ? 'Today' : label.split(',')[0]}</p>
        <p className="text-[17px] font-semibold text-ink">{label.split(', ').slice(1).join(', ')}</p>
        <p className="mt-2 text-[24px] font-semibold tracking-[-0.02em] text-ink tnum">{formatMoney(spent)}</p>
        <p className="text-[12px] text-muted">spent{rows.length ? ` · ${rows.length} ${rows.length === 1 ? 'row' : 'rows'}` : ''}</p>

        {marks.length > 0 && (
          <ul className="mt-4 space-y-2 border-t border-rule pt-3">
            {marks.map((m) => (
              <li key={m.bill_id} className="flex items-center gap-2 text-[13px]">
                <span className="relative shrink-0"><RecurringIcon name={m.merchant} glyph={m.glyph} size={20} /><span className={`absolute -bottom-0.5 -right-0.5 size-2 rounded-full ring-2 ring-raised ${DOT[m.state]}`} aria-hidden="true" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ink">{m.name}</span>
                  <span className={`block ${m.state === 'waiting' || m.state === 'missed' ? 'text-spend' : 'text-muted'}`}>{STATE_WORD[m.state]}</span>
                </span>
                <span className="text-ink tnum">{formatMoney(m.cents)}</span>
              </li>
            ))}
          </ul>
        )}

        <ul className="mt-4 flex-1 space-y-2 overflow-y-auto border-t border-rule pt-3 lg:max-h-[19rem]">
          {req.loading && rows.length === 0 && <li><Loading /></li>}
          {!req.loading && rows.length === 0 && <li className="text-[13px] text-muted">Nothing on this day.</li>}
          {rows.map((t) => (
            <li key={t.id} className="flex items-center gap-2 text-[13px]">
              <MerchantAvatar merchant={t.merchant} description={t.description} txnType={t.txn_type} amountCents={t.amount_cents} size={22} />
              <span className="min-w-0 flex-1 truncate text-ink"><TxnName t={t} fallback={t.description} /></span>
              <span className={`tnum ${t.amount_cents > 0 ? 'text-earn' : 'text-ink'}`}>{formatMoney(Math.abs(t.amount_cents))}</span>
            </li>
          ))}
        </ul>
      </motion.div>
    </AnimatePresence>
  );
}

export function RecurringCalendar({ month, onMonth, bills, today, still, focus = null }) {
  const [day, setDay] = useState(today);
  const [direction, setDirection] = useState(0);
  const daily = useApi(`daily:${month}`, () => api.transactions.daily(month), { tags: ['transactions'] });
  const spentBy = new Map((daily.data ?? []).map((d) => [d.date, d.spent_cents]));
  const max = Math.max(0, ...spentBy.values());
  const monthSpent = [...spentBy.values()].reduce((n, c) => n + c, 0);
  const marks = billMarks(bills, today);
  const waiting = [...marks.values()].flat().filter((m) => m.state === 'waiting').length;
  const cells = monthGrid(month);
  const chosen = day.startsWith(month) ? day : (month === today.slice(0, 7) ? today : `${month}-01`);

  // The month is picked in the page header; the grid slides the way the pick went.
  const [shown, setShown] = useState(month);
  if (shown !== month) { setDirection(month > shown ? 1 : -1); setShown(month); }
  const slide = still ? {} : {
    initial: { opacity: 0, x: direction * 40 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: direction * -40 },
    transition: { type: 'spring', bounce: 0, duration: 0.35 },
  };

  return (
    <section className="grid gap-4 rounded-[20px] border border-rule bg-raised p-4 lg:grid-cols-[4fr_1fr] lg:gap-6 lg:p-5">
      <div className="min-w-0">
        <div className="mb-3 flex items-center gap-2">
          <h3 className="text-[17px] font-semibold text-ink">{monthLong(month)}</h3>
          {month !== today.slice(0, 7) && (
            <button type="button" onClick={() => { onMonth(today.slice(0, 7)); setDay(today); }} className="rounded-full px-3 py-1 text-[13px] font-medium text-info hover:bg-info/10">Today</button>
          )}
          <span className="ml-auto hidden text-[13px] text-muted tnum sm:block">
            {formatMoney(monthSpent)} spent{waiting > 0 && <> · <span className="text-spend">{waiting} waiting on a charge</span></>}
          </span>
        </div>
        <div className="grid grid-cols-7 gap-1 pb-1 text-center text-[11px] text-muted">{WEEKDAYS.map((w) => <span key={w}>{w}</span>)}</div>
        <div className="overflow-hidden">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={month} {...slide} className="grid grid-cols-7 gap-1">
              {cells.map((d, i) => (
                <Day key={d ?? `x${i}`} date={d} today={today} selected={d === chosen} spent={d ? spentBy.get(d) ?? 0 : 0}
                  marks={d ? marks.get(d) ?? [] : []} max={max} onPick={setDay} still={still} focus={focus} />
              ))}
            </motion.div>
          </AnimatePresence>
        </div>
        <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
          {/* The same edges the days take (D366). */}
          <span className="flex items-center gap-1.5"><span className="relative flex size-3.5 items-center justify-center rounded bg-raised ring-1 ring-rule"><span className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full bg-info" /></span>Charged</span>
          <span className="flex items-center gap-1.5"><span className={`h-3 w-5 rounded ${EDGE.upcoming}`} />To come</span>
          <span className="flex items-center gap-1.5"><span className={`h-3 w-5 rounded bg-spend/[0.08] ${EDGE.waiting}`} />Not charged yet</span>
          <span className="flex items-center gap-1.5"><span className={`h-3 w-5 rounded ${EDGE.missed}`} />Missed</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-5 rounded bg-ink/[0.09]" />More spent</span>
        </p>
      </div>
      <aside className="min-w-0 border-t border-rule pt-4 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-5">
        <DayPanel date={chosen} today={today} marks={marks.get(chosen) ?? []} still={still} />
      </aside>
    </section>
  );
}
