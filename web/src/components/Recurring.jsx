import { useCallback, useEffect, useState } from 'react';
import { api, formatMoney, formatShortDate, dollarsToCents } from '../api';
import { Button, PageTitle, Select, TextInput, Field } from './Form';
import { RecurringIcon } from './RecurringIcon';
import { cadenceChoices } from '../dropdown-choices';
import { useNotify } from '../use-notify';

/**
 * Recurring bills, rebuilt from scratch (D185): one ledger. All the rules
 * live in api/src/bills.js; this page only shows them.
 *
 *   - a single line on top: what the bills cost a month, how many, how many late
 *   - suggestions, folded into one line until opened: Add or Ignore each
 *   - the bills, in quiet sections by state, one row each:
 *     bill · how often · next · the last six cycles · amount
 *   - a row opens in place: its charges ("not this bill" on any of them),
 *     and its name, price, rhythm and day to edit; pause, resume, end
 */

const CADENCE_OPTIONS = [
  { value: 'WEEKLY', label: 'Weekly' },
  { value: 'BIWEEKLY', label: 'Every 2 weeks' },
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'QUARTERLY', label: 'Quarterly' },
  { value: 'ANNUAL', label: 'Yearly' },
];
const CADENCE_LABEL = Object.fromEntries(CADENCE_OPTIONS.map((o) => [o.value, o.label]));
const HAS_DAY = new Set(['MONTHLY', 'QUARTERLY', 'ANNUAL']);

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = (m) => MONTH_NAMES[Number(m.slice(5, 7)) - 1];
const thisMonth = () => new Date().toLocaleDateString('en-CA').slice(0, 7);
const shiftMonth = (m, n) => {
  const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};

/** Which group a bill sits in for the month on screen (D186). */
function groupOf(bill, month) {
  if (bill.state === 'ended') return 'ended';
  if (bill.state === 'paused') return 'paused';
  if (month === thisMonth() && (bill.state === 'late' || bill.state === 'stopped')) return 'late';
  return bill.month?.status ?? 'none';
}

const sectionsFor = (month) => [
  { key: 'late', label: 'Late', hint: 'Past their date with no charge seen. Often a statement not uploaded yet; if it was cancelled, end it.' },
  { key: 'due', label: `Due in ${monthName(month)}` },
  { key: 'missed', label: `Missed in ${monthName(month)}`, hint: 'No charge seen for these dates.' },
  { key: 'paid', label: `Paid in ${monthName(month)}` },
  { key: 'none', label: `Not due in ${monthName(month)}` },
  { key: 'paused', label: 'Paused' },
  { key: 'ended', label: 'Ended' },
];

// "Oct 17", or "Sep 1, 2027" once it's not this year.
const dateLabel = (iso) => (iso && iso.slice(0, 4) !== String(new Date().getFullYear()) ? `${formatShortDate(iso)}, ${iso.slice(0, 4)}` : formatShortDate(iso));

const ordinal = (n) => `${n}${[11, 12, 13].includes(n % 100) ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;

function relative(bill) {
  if (bill.until == null || bill.state === 'paused' || bill.state === 'ended') return null;
  if (bill.until === 0) return 'today';
  if (bill.until === 1) return 'tomorrow';
  if (bill.until > 0) return `in ${bill.until} days`;
  return bill.until === -1 ? '1 day late' : `${-bill.until} days late`;
}

/** The last six cycles: a filled dot paid, an open one missed, a faint one before the bill began. */
function History({ cycles }) {
  return (
    <span className="inline-flex gap-1" aria-label={`Last six cycles: ${cycles.filter((c) => c.paid).length} paid`}>
      {cycles.map((c) => (
        <span
          key={c.date}
          title={`${formatShortDate(c.date)}: ${c.paid === null ? 'before this bill' : c.paid ? 'paid' : 'no charge'}`}
          className={`size-2 rounded-full ${c.paid === null ? 'bg-rule' : c.paid ? 'bg-earn' : 'border border-spend'}`}
        />
      ))}
    </span>
  );
}

function BillDetail({ bill, onChanged }) {
  const [charges, setCharges] = useState(null);
  const [form, setForm] = useState({
    name: bill.name,
    amount: (Math.abs(bill.expected_amount_cents) / 100).toFixed(2),
    cadence: bill.cadence,
    day: bill.match_days_of_month?.[0] ?? '',
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const loadCharges = useCallback(() => api.recurring.charges(bill.id).then(setCharges).catch((e) => setError(e.message)), [bill.id]);
  useEffect(() => { loadCharges(); }, [loadCharges]);

  const notify = useNotify();
  const run = async (fn, done) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
      if (done) notify(done, { type: 'success' });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    const cents = dollarsToCents(form.amount);
    if (Number.isNaN(cents) || cents <= 0) return setError('Enter the amount, like 25.05');
    return run(() =>
      api.recurring.update(bill.id, {
        name: form.name.trim(),
        expected_amount_cents: -cents,
        cadence: form.cadence,
        day: HAS_DAY.has(form.cadence) && form.day ? Number(form.day) : null,
      }), `${form.name.trim()} saved`
    );
  };

  return (
    <div className="grid gap-6 border-b border-rule bg-band/40 px-3 py-4 md:grid-cols-2">
      <div>
        <div className="mb-2 text-xs text-muted">Charges</div>
        {!charges && <p className="text-sm text-muted">Loading…</p>}
        {charges?.length === 0 && <p className="text-sm text-muted">None linked yet.</p>}
        <ul className="divide-y divide-rule text-sm">
          {charges?.slice(0, 8).map((c) => (
            <li key={c.id} className="flex items-baseline gap-3 py-1.5">
              <span className="w-14 font-mono tnum text-muted">{formatShortDate(c.posted_date)}</span>
              <span className="min-w-0 flex-1 truncate text-muted">{c.account_name}</span>
              <span className="font-mono tnum text-spend">{formatMoney(c.amount_cents)}</span>
              <button
                onClick={() => run(async () => { await api.recurring.unlink(bill.id, c.id); await loadCharges(); }, 'Charge taken off this bill')}
                disabled={busy}
                className="text-xs text-faint underline-offset-4 hover:text-ink hover:underline"
              >
                Not this bill
              </button>
            </li>
          ))}
        </ul>
        {charges?.length > 8 && <p className="mt-1 text-xs text-faint">and {charges.length - 8} earlier</p>}
      </div>

      <div>
        <div className="mb-2 text-xs text-muted">Details</div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <Field label="Name" className="col-span-2">
            <TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Amount">
            <TextInput value={form.amount} inputMode="decimal" className="tnum" onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </Field>
          <Field label="How often">
            <Select value={form.cadence} options={cadenceChoices(CADENCE_OPTIONS)} onChange={(e) => setForm({ ...form, cadence: e.target.value })} />
          </Field>
          {HAS_DAY.has(form.cadence) && (
            <Field label="Day of the month">
              <TextInput value={form.day} inputMode="numeric" className="tnum" onChange={(e) => setForm({ ...form, day: e.target.value.replace(/\D/g, '').slice(0, 2) })} />
            </Field>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={save} disabled={busy}>Save</Button>
          {bill.status === 'ACTIVE' && <Button size="sm" variant="quiet" disabled={busy} onClick={() => run(() => api.recurring.update(bill.id, { status: 'PAUSED' }), `${bill.name} paused`)}>Pause</Button>}
          {bill.status !== 'ACTIVE' && <Button size="sm" variant="quiet" disabled={busy} onClick={() => run(() => api.recurring.update(bill.id, { status: 'ACTIVE' }), `${bill.name} resumed`)}>Resume</Button>}
          {bill.status !== 'ENDED' && (
            <button
              onClick={() => run(() => api.recurring.update(bill.id, { status: 'ENDED' }), `${bill.name} ended`)}
              disabled={busy}
              className="ml-auto text-sm text-muted underline-offset-4 hover:text-spend hover:underline"
            >
              End this bill
            </button>
          )}
        </div>
        {error && <p className="mt-2 text-sm text-spend">{error}</p>}
      </div>
    </div>
  );
}

const iconProps = { width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true };
const stroke = { stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' };
const PauseIcon = () => <svg {...iconProps}><path d="M5.5 4v8M10.5 4v8" {...stroke} /></svg>;
const ResumeIcon = () => <svg {...iconProps}><path d="M5 3.5l7 4.5-7 4.5v-9z" {...stroke} /></svg>;
const EndIcon = () => <svg {...iconProps}><rect x="4.5" y="4.5" width="7" height="7" rx="1" {...stroke} /></svg>;

/** A small labelled button on a card. Stops the click from also opening the card. */
function CardAction({ label, icon, onClick, disabled, danger }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      disabled={disabled}
      className={`flex items-center gap-1.5 rounded-md border border-rule px-2 py-1 text-xs transition-colors disabled:opacity-50 ${
        danger ? 'text-muted hover:border-spend/40 hover:text-spend' : 'text-muted hover:bg-band hover:text-ink'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

/** One bill: what, how often, how much, when next, the last six cycles, and pause/end right there. */
/** What happened to this bill in the month on screen: "Paid Sep 17 · −$25.05", "Due Oct 17", "Missed Sep 9", "3 of 4 paid". */
function MonthLine({ bill, month }) {
  const occ = bill.month?.occurrences ?? [];
  if (occ.length === 0) return <div className="text-muted">Not due in {monthName(month)}</div>;
  if (occ.length > 1) {
    const paid = occ.filter((o) => o.state === 'paid').length;
    const missed = occ.some((o) => o.state === 'missed');
    return <div className={missed ? 'text-spend' : 'text-ink'}><span className="tnum">{paid}</span> of <span className="tnum">{occ.length}</span> paid</div>;
  }
  const [o] = occ;
  if (o.state === 'paid') {
    return (
      <div className="text-earn">
        Paid <span className="font-mono tnum">{formatShortDate(o.charge.date)}</span>
        {o.charge.amount_cents !== bill.expected_amount_cents && <span className="text-faint"> · <span className="font-mono tnum">{formatMoney(o.charge.amount_cents)}</span></span>}
      </div>
    );
  }
  return (
    <div className={o.state === 'missed' ? 'text-spend' : 'text-ink'}>
      {o.state === 'missed' ? 'Missed' : 'Due'} <span className="font-mono tnum">{formatShortDate(o.date)}</span>
    </div>
  );
}

function BillCard({ bill, month, onOpen, onChanged }) {
  const [busy, setBusy] = useState(false);
  const when = relative(bill);
  const notify = useNotify();
  const setStatus = async (status) => {
    setBusy(true);
    try {
      await api.recurring.update(bill.id, { status });
      onChanged();
      notify(`${bill.name} ${{ PAUSED: 'paused', ACTIVE: 'resumed', ENDED: 'ended' }[status] ?? 'updated'}`, { type: 'success' });
    } catch (err) {
      notify(err.message, { type: 'error', title: `Couldn't update ${bill.name}` });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      className={`flex cursor-pointer flex-col rounded-lg border bg-raised p-4 transition-colors hover:border-rule-str ${
        bill.state === 'late' ? 'border-spend/40' : 'border-rule'
      }`}
    >
      <div className="flex items-start gap-3">
        <RecurringIcon name={bill.match_name_contains} glyph={bill.glyph} size={32} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-ink">{bill.name}</div>
          <div className="text-xs text-muted">
            {CADENCE_LABEL[bill.cadence]}{bill.match_days_of_month?.[0] && HAS_DAY.has(bill.cadence) ? ` on the ${ordinal(bill.match_days_of_month[0])}` : ''}
          </div>
        </div>
        <div className="text-right font-mono tnum text-spend">
          {formatMoney(bill.expected_amount_cents)}
          {bill.amount_varies && <div className="text-xs text-faint">average</div>}
        </div>
      </div>

      <div className="mt-4 flex items-end justify-between gap-3">
        <div className="min-w-0 text-sm">
          <MonthLine bill={bill} month={month} />
          <div className="mt-0.5 text-xs text-faint">
            {bill.state === 'late' || bill.state === 'stopped' ? (
              // Late: the next date is in the past, so say when it was last charged instead.
              <>Last charged <span className="font-mono tnum">{bill.last_date ? dateLabel(bill.last_date) : '—'}</span>{when && <span className="text-spend"> · {when}</span>}</>
            ) : (
              <>Next <span className="font-mono tnum">{bill.next_date ? dateLabel(bill.next_date) : '—'}</span>{when && <> · {when}</>}</>
            )}
          </div>
        </div>
        {bill.history?.length > 0 && <History cycles={bill.history} />}
      </div>

      <div className="mt-4 flex items-center gap-2 border-t border-rule pt-3">
        {bill.status === 'ACTIVE' && <CardAction label="Pause" icon={<PauseIcon />} disabled={busy} onClick={() => setStatus('PAUSED')} />}
        {bill.status !== 'ACTIVE' && <CardAction label="Resume" icon={<ResumeIcon />} disabled={busy} onClick={() => setStatus('ACTIVE')} />}
        {bill.status !== 'ENDED' && <CardAction label="End" icon={<EndIcon />} danger disabled={busy} onClick={() => setStatus('ENDED')} />}
        <span className="ml-auto text-xs text-faint">Details</span>
      </div>
    </div>
  );
}

/** A plain centered pop-up, same shape as the app's other dialogs. */
function Modal({ title, onClose, children, width = 'max-w-3xl' }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-scrim fixed inset-0 z-20 flex items-center justify-center bg-ink/30 p-4" onClick={onClose}>
      <div className={`max-h-[88vh] w-full ${width} overflow-y-auto rounded-lg border border-rule bg-raised shadow-lg`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-rule px-4 py-3">
          <h3 className="text-base font-medium text-ink">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="text-muted hover:text-ink">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** The suggestions, in the Review pop-up. Nothing is added without a click. */
function Suggestions({ items, onChanged }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  if (!items || items.length === 0) return <p className="px-4 py-8 text-center text-sm text-muted">Nothing new to review.</p>;

  const act = async (s, fn) => {
    setBusy(s.key);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };
  const add = (s) =>
    act(s, () =>
      api.recurring.create({
        name: s.name,
        merchant: s.merchant,
        cadence: s.cadence,
        day: s.day,
        expected_amount_cents: s.expected_amount_cents,
        amount_varies: s.amount_varies,
        match_amount_min_cents: s.match_amount_min_cents,
        match_amount_max_cents: s.match_amount_max_cents,
        charge_ids: s.charges.map((c) => c.id),
      })
    );

  return (
    <>
      <p className="px-4 pt-3 text-xs text-muted">Charges that repeat in your statements. Add the real bills; ignore the rest and they won't come back.</p>
      <ul className="divide-y divide-rule">
        {items.map((s) => (
          <li key={s.key} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
            <RecurringIcon name={s.merchant} glyph="" size={28} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-ink">{s.name}</div>
              <div className="text-xs text-muted">
                {CADENCE_LABEL[s.cadence]}{s.day ? ` on the ${ordinal(s.day)}` : ''} · seen {s.count}× since {formatShortDate(s.first_date)}
              </div>
            </div>
            <span className="font-mono tnum text-spend">
              {formatMoney(s.expected_amount_cents)}
              {s.amount_varies && <span className="ml-1 text-xs text-faint">avg</span>}
            </span>
            <div className="flex gap-2">
              <Button size="sm" disabled={busy === s.key} onClick={() => add(s)}>Add</Button>
              <Button size="sm" variant="quiet" disabled={busy === s.key} onClick={() => act(s, () => api.recurring.ignore(s.key))}>Ignore</Button>
            </div>
          </li>
        ))}
      </ul>
      {error && <p className="px-4 pb-3 text-sm text-spend">{error}</p>}
    </>
  );
}

const CalendarIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
    <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);

/** Top right: ‹ October 2026 ›. The name jumps back to this month. Up to a year ahead. */
function MonthNav({ month, onChange }) {
  const current = thisMonth();
  const step = 'flex size-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-band hover:text-ink disabled:opacity-30';
  return (
    <div className="flex items-center gap-1 rounded-lg border border-rule bg-raised px-1 py-0.5">
      <span className="px-1.5 text-muted"><CalendarIcon /></span>
      <button className={step} aria-label="Previous month" onClick={() => onChange(shiftMonth(month, -1))}>‹</button>
      <button
        onClick={() => onChange(current)}
        title={month === current ? 'This month' : 'Back to this month'}
        className="min-w-[8.5rem] text-center text-sm text-ink"
      >
        {monthName(month)} <span className="tnum">{month.slice(0, 4)}</span>
      </button>
      <button className={step} aria-label="Next month" disabled={month >= shiftMonth(current, 12)} onClick={() => onChange(shiftMonth(month, 1))}>›</button>
    </div>
  );
}

/** Top right: glows with a count while new bills wait; grey when there's nothing. */
function ReviewButton({ count, onClick }) {
  const waiting = count > 0;
  return (
    <button
      onClick={onClick}
      disabled={!waiting}
      title={waiting ? `${count} new ${count === 1 ? 'bill' : 'bills'} to review` : 'Nothing new to review'}
      className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors ${
        waiting ? 'animate-glow border-earn/50 bg-earn/5 text-ink hover:bg-earn/10' : 'cursor-default border-rule text-faint'
      }`}
    >
      Review
      <span className={`flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 font-mono text-xs tnum ${waiting ? 'bg-earn text-white' : 'bg-band text-faint'}`}>
        {count}
      </span>
    </button>
  );
}

export function Recurring() {
  const [bills, setBills] = useState(null);
  const [suggestions, setSuggestions] = useState(null);
  const [showEnded, setShowEnded] = useState(false);
  const [openBill, setOpenBill] = useState(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [month, setMonth] = useState(thisMonth);
  const [error, setError] = useState(null);

  const loadBills = useCallback(() => {
    api.recurring.list(showEnded, month).then(setBills).catch((e) => setError(e.message));
  }, [showEnded, month]);
  const load = useCallback(() => {
    loadBills();
    api.recurring.suggestions().then(setSuggestions).catch(() => setSuggestions([]));
  }, [loadBills]);
  useEffect(() => { loadBills(); }, [loadBills]);
  useEffect(() => { api.recurring.suggestions().then(setSuggestions).catch(() => setSuggestions([])); }, []);

  const live = (bills ?? []).filter((b) => b.state !== 'paused' && b.state !== 'ended');
  const monthly = live.reduce((sum, b) => sum + b.monthly_cents, 0);
  const paidCents = live.reduce((sum, b) => sum + (b.month?.paid_cents ?? 0), 0);
  const dueCents = live.reduce((sum, b) => sum + (b.month?.due_cents ?? 0), 0);
  const missed = live.filter((b) => b.month?.status === 'missed').length;
  const byNext = (a, b) => (a.next_date ?? '').localeCompare(b.next_date ?? '');
  const open = openBill && bills?.find((b) => b.id === openBill);

  return (
    <section>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-rule pb-2">
        <PageTitle className="text-base font-medium text-ink" emoji="🔁" tint="bg-vivid-purple/15">Recurring</PageTitle>
        <div className="flex flex-wrap items-center gap-2">
          <MonthNav month={month} onChange={setMonth} />
          <ReviewButton count={suggestions?.length ?? 0} onClick={() => setReviewOpen(true)} />
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-spend">{error}</p>}

      {bills && bills.length > 0 && (
        <div className="mb-6 flex flex-wrap items-baseline gap-x-8 gap-y-2">
          <span><span className="font-mono text-2xl tnum text-ink">{formatMoney(monthly)}</span> <span className="text-sm text-muted">a month · {live.length} {live.length === 1 ? 'bill' : 'bills'}</span></span>
          <span className="text-sm text-muted">
            In {monthName(month)}: <span className="font-mono tnum text-earn">{formatMoney(Math.abs(paidCents))}</span> paid
            {dueCents !== 0 && <> · <span className="font-mono tnum text-ink">{formatMoney(Math.abs(dueCents))}</span> still due</>}
            {missed > 0 && <> · <span className="tnum text-spend">{missed}</span> missed</>}
          </span>
        </div>
      )}

      {bills?.length === 0 && (
        <p className="py-10 text-center text-sm text-muted">
          No recurring bills yet.{' '}
          {(suggestions?.length ?? 0) > 0
            ? <button onClick={() => setReviewOpen(true)} className="text-ink underline underline-offset-4">Review the {suggestions.length} found in your statements</button>
            : "They're suggested here as charges repeat in your statements."}
        </p>
      )}

      {bills && sectionsFor(month).map(({ key, label, hint }) => {
        const list = bills.filter((b) => groupOf(b, month) === key).sort(byNext);
        if (list.length === 0) return null;
        return (
          <div key={key} className="mb-8">
            <h3 className={`mb-1 text-sm ${key === 'late' || key === 'missed' ? 'text-spend' : 'text-muted'}`}>
              {label} <span className="tnum text-faint">{list.length}</span>
            </h3>
            {hint && <p className="mb-2 text-xs text-faint">{hint}</p>}
            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {list.map((b) => <BillCard key={b.id} bill={b} month={month} onOpen={() => setOpenBill(b.id)} onChanged={load} />)}
            </div>
          </div>
        );
      })}

      {bills && (
        <button onClick={() => setShowEnded(!showEnded)} className="text-sm text-muted underline-offset-4 hover:text-ink hover:underline">
          {showEnded ? 'Hide ended bills' : 'Show ended bills'}
        </button>
      )}

      {open && (
        <Modal title={open.name} onClose={() => setOpenBill(null)}>
          <BillDetail bill={open} onChanged={load} />
        </Modal>
      )}
      {reviewOpen && (
        <Modal title="New bills found" onClose={() => setReviewOpen(false)}>
          <Suggestions items={suggestions} onChanged={load} />
        </Modal>
      )}
    </section>
  );
}
