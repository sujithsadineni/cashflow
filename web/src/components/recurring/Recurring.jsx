import { PageTitle } from '../ui/Form';
import { MonthPicker } from '../ui/MonthPicker';
import { RecheckButton } from '../ui/RecheckButton';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { api, formatMoney, formatShortDate } from '../../api';
import { useApi, invalidate } from '../../hooks/use-api';
import { useDesign } from '../../hooks/use-design';
import { useWide } from '../../hooks/use-wide';
import { useNotify } from '../../hooks/use-notify';
import { currentMonth, MONTHS_LONG, todayISO } from '../../lib/app/dates';
import { billTabs } from '../../lib/recurring/calendar';
import { statusLine, monthTotals, priceNote } from '../../lib/recurring/bill-view';
import { ListRow, ListSection } from '../settings/apple/SplitList';
import { moveSelection } from '../settings/apple/list-keys';
import { GroupBlock, GroupRow } from '../settings/apple/grouped';
import { RecurringIcon } from './RecurringIcon';
import { BillDetail } from './BillDetail';
import { RecurringCalendar } from './RecurringCalendar';
import { CONFIDENCE, evidence, kindLine, ignoredLabel } from '../../lib/recurring/suggestion-view';
import { ListSkeleton } from '../ui/Loading';

/**
 * Recurring (D316, the calendar D321): one page for every design. On top,
 * the month in one line and one bar (paid, still due, missed). Then the
 * month as a calendar (RecurringCalendar): what was spent each day and each
 * charge on its day, the chosen day's rows beside it. Under it four tabs of
 * equal width: Due this month, Paid, Not charged yet, Paused and ended; a
 * tab's bills are a list, and a row opens its detail beside the list (under
 * it on a phone), where it's edited, paused or ended. New bills found in the
 * statements are one row above the list, opening to Add or Ignore each.
 * The bill is in the URL (?bill=12, ?bill=new), the tab too (?tab=late).
 */

const monthName = (ym) => MONTHS_LONG[Number(ym.slice(5, 7)) - 1];

/** The month at a glance: what's paid, what's still due, what was missed, as one bar. */
function MonthBar({ totals, month, still }) {
  const total = totals.paid_cents + totals.due_cents || 1;
  const grow = (share) => (still ? { style: { width: `${share * 100}%` } } : { initial: { width: 0 }, animate: { width: `${share * 100}%` }, transition: { type: 'spring', bounce: 0, duration: 0.7 } });
  return (
    <div>
      <p className="text-[15px] text-muted">
        <span className="text-[28px] font-semibold tracking-[-0.02em] text-ink tnum">{formatMoney(totals.monthly_cents)}</span> a month · {totals.count} {totals.count === 1 ? 'bill' : 'bills'}
      </p>
      <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-band" aria-hidden="true">
        <motion.span className="h-full bg-info" {...grow(totals.paid_cents / total)} />
      </div>
      <p className="mt-2 text-[13px] text-muted tnum">
        {monthName(month)}: <span className="text-ink">{formatMoney(totals.paid_cents)}</span> paid
        {totals.due_cents > 0 && <> · <span className="text-ink">{formatMoney(totals.due_cents)}</span> still due</>}
        {totals.missed > 0 && <> · <span className="text-spend">{totals.missed} missed</span></>}
      </p>
    </div>
  );
}

/** One found bill: how sure, why, its recent charges, and Add or Not a bill (D364). */
function FoundBill({ s, busy, onAdd, onIgnore }) {
  const [all, setAll] = useState(false);
  const conf = CONFIDENCE[s.confidence] ?? CONFIDENCE.low;
  const charges = [...s.charges].reverse();
  const shown = all ? charges : charges.slice(0, 6);
  return (
    <li className="rounded-2xl border border-rule bg-raised p-4">
      <div className="flex items-start gap-3">
        <RecurringIcon name={s.merchant} glyph="" size={36} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-[17px] font-semibold text-ink">{s.name}</span>
            <span className={`rounded-full px-2 py-0.5 text-[12px] font-medium ${conf.tone}`}>{conf.label}</span>
          </p>
          <p className="text-[13px] text-muted">{kindLine(s)}</p>
        </div>
        <p className="shrink-0 text-right">
          <span className="block text-[17px] font-semibold text-ink tnum">{s.kind === 'variable' ? '~' : ''}{formatMoney(Math.abs(s.expected_amount_cents))}</span>
          <span className="block text-[12px] text-muted">{s.kind === 'variable' ? 'usually' : 'now'}</span>
        </p>
      </div>
      <ul className="mt-3 space-y-1 text-[13px] text-ink">
        {evidence(s).map((line) => <li key={line} className="flex gap-2"><span className="text-faint" aria-hidden="true">·</span>{line}</li>)}
      </ul>
      <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Charges found">
        {shown.map((c) => (
          <span key={c.id} className="rounded-md bg-band px-2 py-0.5 text-[12px] text-muted tnum">{formatShortDate(c.posted_date)} · {formatMoney(Math.abs(c.amount_cents))}</span>
        ))}
        {charges.length > 6 && (
          <button type="button" onClick={() => setAll(!all)} className="rounded-md px-2 py-0.5 text-[12px] font-medium text-info hover:bg-info/10">
            {all ? 'Fewer' : `All ${charges.length}`}
          </button>
        )}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" disabled={busy} onClick={onIgnore} className="rounded-full px-3.5 py-1.5 text-[14px] font-medium text-info hover:bg-info/10 disabled:opacity-50">Not a bill</button>
        <button type="button" disabled={busy} onClick={onAdd} className="rounded-full bg-info px-3.5 py-1.5 text-[14px] font-semibold text-white hover:brightness-110 disabled:opacity-50">Add bill</button>
      </div>
    </li>
  );
}

/**
 * New bills found in the statements (D364): each with how sure the app is and
 * why, to Add or mark Not a bill. Nothing is added until a person says so. Not
 * a bill ignores that one bill (never the whole merchant); the ignored ones are
 * listed under it, each can be suggested again.
 */
function NewBills({ items, onChanged }) {
  const notify = useNotify();
  const [busy, setBusy] = useState(null);
  const [showIgnored, setShowIgnored] = useState(false);
  const ignoredReq = useApi('recurring:ignored', () => api.recurring.ignored(), { tags: ['recurring'] });
  const ignored = ignoredReq.data ?? [];
  const act = async (key, name, fn, done, toast) => {
    setBusy(key);
    try {
      await fn();
      onChanged();
      ignoredReq.reload();
      notify(done, { name: toast });
    } catch (err) {
      notify(`${name}: ${err.message}`, { name: 'error.update' });
    } finally {
      setBusy(null);
    }
  };
  const add = (s) => act(s.key, s.name, () => api.recurring.create({
    name: s.name, merchant: s.merchant, cadence: s.cadence, day: s.day,
    expected_amount_cents: s.expected_amount_cents, amount_varies: s.amount_varies,
    match_amount_min_cents: s.match_amount_min_cents, match_amount_max_cents: s.match_amount_max_cents,
    charge_ids: s.charges.map((c) => c.id),
  }), `${s.name} · edit it any time`, 'bill.added');

  return (
    <div>
      <header className="mb-5">
        <h3 className="text-[24px] font-semibold tracking-[-0.02em] text-ink">New bills found</h3>
        <p className="mt-0.5 text-[15px] text-muted">Charges that repeat in your statements, with why each looks like a bill. Nothing is added until you add it.</p>
      </header>
      {items?.length ? (
        <ul className="space-y-3">
          {items.map((s) => (
            <FoundBill key={s.key} s={s} busy={busy === s.key} onAdd={() => add(s)}
              onIgnore={() => act(s.key, s.name, () => api.recurring.ignore(s.key), `${s.name} won't be suggested again`, 'bill.hidden')} />
          ))}
        </ul>
      ) : (
        <p className="py-12 text-center text-[15px] text-muted">Nothing new found in your statements.</p>
      )}
      {ignored.length > 0 && (
        <div className="mt-6">
          <button type="button" onClick={() => setShowIgnored(!showIgnored)} aria-expanded={showIgnored} className="px-1 text-[13px] font-medium text-info">
            {showIgnored ? 'Hide' : 'Show'} not bills ({ignored.length})
          </button>
          {showIgnored && (
            <GroupBlock className="mt-2">
              {ignored.map((r) => (
                <GroupRow key={r.key} label={<span className="text-[15px] text-ink">{ignoredLabel(r.key)}</span>}>
                  <button type="button" disabled={busy === r.key} onClick={() => act(r.key, ignoredLabel(r.key), () => api.recurring.restore(r.key), 'If it still looks like a bill', 'bill.restored')}
                    className="rounded-full px-3 py-1 text-[13px] text-info hover:bg-info/10">Suggest again</button>
                </GroupRow>
              ))}
            </GroupBlock>
          )}
        </div>
      )}
    </div>
  );
}

const TABS = [
  { key: 'due', label: 'Due this month' },
  { key: 'paid', label: 'Paid' },
  { key: 'late', label: 'Not charged yet' },
  { key: 'off', label: 'Paused & ended' },
];
const tabCents = (bills) => bills.reduce((n, b) => n + Math.abs(b.month?.occurrences?.find((o) => o.charge)?.charge?.amount_cents ?? b.expected_amount_cents ?? 0), 0);

/** Four tabs of equal width, each with its count and total; the choice glides between them. */
function BillTabs({ tabs, active, onPick, still }) {
  return (
    <div role="tablist" aria-label="Bills" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {TABS.map((t) => {
        const on = active === t.key;
        const bills = tabs[t.key];
        const count = bills.length + (t.key === 'due' ? tabs.later.length : 0);
        return (
          <button key={t.key} type="button" role="tab" aria-selected={on} onClick={() => onPick(t.key)}
            className={`relative rounded-2xl border px-4 py-3 text-left transition-colors ${on ? 'border-transparent' : 'border-rule hover:bg-band'}`}>
            {on && <motion.span layoutId="rec-tab" transition={still ? { duration: 0 } : { type: 'spring', bounce: 0.1, duration: 0.35 }} className="absolute inset-0 rounded-2xl bg-info/10 ring-2 ring-info" aria-hidden="true" />}
            <span className={`relative block text-[13px] font-semibold ${on ? 'text-info' : t.key === 'late' && bills.length ? 'text-spend' : 'text-muted'}`}>{t.label}</span>
            <span className="relative mt-0.5 flex items-baseline gap-2">
              <span className="text-[22px] font-semibold tracking-[-0.01em] text-ink tnum">{count}</span>
              {t.key !== 'off' && bills.length > 0 && <span className="text-[13px] text-muted tnum">{formatMoney(tabCents(bills))}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

const EMPTY = { due: 'Nothing left to pay this month.', paid: 'Nothing charged yet this month.', late: 'Every charge came on time.', off: 'No paused or ended bills.' };

export function Recurring() {
  const [params, setParams] = useSearchParams();
  const { design } = useDesign();
  const reduceMotion = useReducedMotion();
  const still = design === 'classic' || Boolean(reduceMotion);
  const wide = useWide('(min-width: 1024px)');
  const [month, setMonth] = useState(currentMonth);
  const today = todayISO();

  const billsReq = useApi(`recurring:${month}`, () => api.recurring.list(true, month), { tags: ['transactions', 'recurring'] });
  const suggestReq = useApi('recurring:suggestions', () => api.recurring.suggestions(), { tags: ['recurring'] });
  const bills = billsReq.data ?? [];
  const found = suggestReq.data ?? [];
  const reload = () => { invalidate('recurring'); billsReq.reload(); };

  const tabs = billTabs(bills, month, currentMonth());
  const tab = TABS.some((t) => t.key === params.get('tab')) ? params.get('tab') : tabs.late.length ? 'late' : 'due';
  const groups = [
    { key: tab, label: TABS.find((t) => t.key === tab).label, bills: tabs[tab] },
    ...(tab === 'due' ? [{ key: 'later', label: 'Not due this month', bills: tabs.later }] : []),
  ].filter((g) => g.bills.length);
  const ordered = groups.flatMap((g) => g.bills);
  const picked = params.get('bill');
  const chosen = picked === 'new' ? 'new' : bills.find((b) => String(b.id) === picked) ?? null;
  // Wide screens show something before a choice, as Settings does; not written to the URL.
  const selected = chosen ?? (wide ? ordered[0] ?? null : null);
  const select = (id) => setParams({ tab, bill: String(id) });
  const pickTab = (key) => setParams({ tab: key });
  const detailOpen = Boolean(chosen);

  // Re-check (D363 step 2): link saved charges a bill missed, and open new bills found to add.
  const notify = useNotify();
  const [runs, setRuns] = useState(0);
  const recheck = async () => {
    setRuns((n) => n + 1);
    try {
      const r = await api.recurring.recheck();
      reload();
      suggestReq.reload();
      const linked = r.linked ? `${r.linked} ${r.linked === 1 ? 'charge' : 'charges'} matched to ${r.bills.join(', ')}` : 'Every charge is on its bill';
      notify(`${linked} · ${r.found ? `${r.found} new ${r.found === 1 ? 'bill' : 'bills'} to add` : 'no new bills'}`, { name: 'bills.checked' });
      if (r.found) setParams({ tab, bill: 'new' });
    } catch (err) {
      notify(err.message, { name: 'error.check' });
    }
  };

  return (
    <div className="apple-pane">
      {/* Laid out like Overview's header: the month is picked here, a year ahead for bills to come (D312). */}
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <PageTitle className="text-2xl font-medium tracking-tight text-ink" emoji="🔁" tint="bg-vivid-purple/15">Recurring</PageTitle>
          <p className="mt-1 text-sm text-muted">Bills that repeat, month by month.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <MonthPicker value={month} onChange={setMonth} ahead={12} />
          <RecheckButton onClick={recheck} runs={runs} />
        </div>
      </header>
      {bills.length > 0 && <div className="mb-6"><MonthBar totals={monthTotals(bills)} month={month} still={still} /></div>}

      {billsReq.error && <p className="mb-4 text-[13px] text-spend">{billsReq.error}</p>}

      <RecurringCalendar month={month} onMonth={setMonth} bills={bills} today={today} still={still} focus={chosen && chosen !== 'new' ? chosen.id : null} />

      <div className="mt-8">
        <BillTabs tabs={tabs} active={tab} onPick={pickTab} still={still} />
      </div>

      <div className="mt-6 lg:grid lg:grid-cols-[22rem_minmax(0,1fr)] lg:items-start lg:gap-10">
        <nav aria-label="Bills" className={`space-y-5 ${detailOpen ? 'hidden lg:block' : ''}`} onKeyDown={(e) => moveSelection(e, select)}>
          {found.length > 0 && (
            <ul>
              <ListRow id="new" selected={selected === 'new'} onSelect={() => setParams({ tab, bill: 'new' })}
                leading={<span className="flex size-8 items-center justify-center rounded-lg bg-info text-[15px] font-semibold text-white tnum">{found.length}</span>}
                title={`New ${found.length === 1 ? 'bill' : 'bills'} found`} subtitle="In your statements · Review each one" />
            </ul>
          )}
          {billsReq.loading && bills.length === 0 && <ListSkeleton rows={6} />}
          {!billsReq.loading && bills.length === 0 && <p className="px-3 py-10 text-center text-[15px] text-muted">No recurring bills yet. They're found as charges repeat in your statements.</p>}
          {!billsReq.loading && bills.length > 0 && groups.length === 0 && <p className="px-3 py-10 text-center text-[15px] text-muted">{EMPTY[tab]}</p>}
          {groups.map((g) => (
            <ListSection key={g.key} label={<span className={g.key === 'late' ? 'text-spend' : ''}>{g.label} <span className="tnum">· {g.bills.length}</span></span>}>
              <ul>
                {g.bills.map((b, i) => {
                  const line = statusLine(b, month);
                  const price = priceNote(b, today);
                  return (
                    <ListRow key={b.id} id={b.id} selected={selected?.id === b.id} afterSelected={selected?.id === g.bills[i - 1]?.id}
                      onSelect={select} dimmed={tab === 'off'}
                      leading={<RecurringIcon name={b.match_name_contains} glyph={b.glyph} size={32} />}
                      title={b.name}
                      subtitle={<span className={line.tone === 'spend' && selected?.id !== b.id ? 'text-spend' : ''}>{line.text}{price ? ` · ${price.text}` : ''}</span>}
                      trailing={(sel) => <span className={`shrink-0 text-[15px] tnum ${sel ? 'text-white' : 'text-ink'}`}>{formatMoney(Math.abs(b.expected_amount_cents))}</span>} />
                  );
                })}
              </ul>
            </ListSection>
          ))}
        </nav>

        <section aria-label={selected === 'new' ? 'New bills found' : selected?.name ?? 'Bill'} className={`split-detail ${detailOpen ? '' : 'hidden lg:block'}`}>
          <button type="button" onClick={() => setParams({ tab })} className="mb-4 flex items-center gap-1 text-[15px] text-info lg:hidden">
            <svg width="9" height="15" viewBox="0 0 8 13" aria-hidden="true"><path d="M6.5 1.5 1.5 6.5l5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            Recurring
          </button>
          <motion.div key={selected === 'new' ? 'new' : selected?.id ?? 'none'} initial={still ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', bounce: 0, duration: 0.3 }}>
            {selected === 'new' && <NewBills items={found} onChanged={() => { suggestReq.reload(); reload(); }} />}
            {selected && selected !== 'new' && <BillDetail key={selected.id} bill={selected} month={month} onChanged={reload} />}
          </motion.div>
        </section>
      </div>
    </div>
  );
}
