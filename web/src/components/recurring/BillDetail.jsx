import { useState } from 'react';
import { api, formatMoney, formatShortDate, dollarsToCents } from '../../api';
import { useApi } from '../../hooks/use-api';
import { useNotify } from '../../hooks/use-notify';
import { useConfirm } from '../../hooks/use-confirm';
import { CADENCES, HAS_DAY, cadenceLine, statusLine, priceNote } from '../../lib/recurring/bill-view';
import { monthShort, todayISO } from '../../lib/app/dates';
import { Dropdown } from '../ui/Dropdown';
import { GroupBlock, GroupRow, GroupButton } from '../settings/apple/grouped';
import { RecurringIcon } from './RecurringIcon';
import { Spinner } from '../ui/Loading';

/**
 * One recurring bill (D316), the right side of the Recurring split view:
 * where it stands, what it costs (a year, the last twelve months, a price
 * change), every charge linked to it, and Pause, Resume and End. Edit turns
 * the name (in the title), amount, rhythm and day into fields where they sit.
 * Pause is undoable; End asks first and is undoable too.
 */

const FIELD = 'w-full min-w-0 bg-transparent text-right text-ink outline-none placeholder:text-faint tnum';
const pill = 'rounded-full px-3.5 py-1 text-[15px] transition-[background-color,filter] duration-150';

export function BillDetail({ bill, month, onChanged }) {
  const notify = useNotify();
  const confirm = useConfirm();
  const [form, setForm] = useState(null); // null while reading
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const charges = useApi(`recurring-charges:${bill.id}`, () => api.recurring.charges(bill.id), { tags: ['transactions'] });
  const status = statusLine(bill, month);
  const price = priceNote(bill, todayISO());
  const editing = form !== null;

  const startEdit = () => setForm({
    name: bill.name,
    amount: (Math.abs(bill.expected_amount_cents) / 100).toFixed(2),
    cadence: bill.cadence,
    day: String(bill.match_days_of_month?.[0] ?? ''),
  });

  const run = async (fn, done, undo) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
      if (done) notify(done, { name: 'bill.updated', ...(undo ? { action: { label: 'Undo', onClick: async () => { await undo(); onChanged(); } } } : {}) });
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const save = async (e) => {
    e.preventDefault();
    const cents = dollarsToCents(form.amount);
    if (!form.name.trim()) return setError('Give it a name');
    if (Number.isNaN(cents) || cents <= 0) return setError('The amount, like 25.05');
    const ok = await run(() => api.recurring.update(bill.id, {
      name: form.name.trim(),
      expected_amount_cents: -cents,
      cadence: form.cadence,
      day: HAS_DAY.has(form.cadence) && form.day ? Number(form.day) : null,
    }), `${form.name.trim()} saved`);
    if (ok) setForm(null);
    return undefined;
  };

  const setStatus = async (next) => {
    const before = bill.status;
    if (next === 'ENDED' && !(await confirm({ title: `End ${bill.name}?`, message: 'It stops being expected. Its charges stay where they are.', confirm: 'End', destructive: true }))) return;
    const word = { PAUSED: 'paused', ACTIVE: 'resumed', ENDED: 'ended' }[next];
    run(() => api.recurring.update(bill.id, { status: next }), `${bill.name} ${word}`, () => api.recurring.update(bill.id, { status: before }));
  };

  const unlink = (c) => run(async () => { await api.recurring.unlink(bill.id, c.id); charges.reload(); }, 'Charge taken off this bill');
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e?.target ? e.target.value : e }));

  return (
    <form onSubmit={save} onKeyDown={(e) => editing && e.key === 'Escape' && setForm(null)} noValidate>
      <header className="mb-7 flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="order-first flex w-full justify-end gap-1.5 sm:order-2 sm:w-auto sm:self-start">
          {editing ? (
            <>
              <button type="button" onClick={() => setForm(null)} disabled={busy} className={`${pill} text-info hover:bg-info/10`}>Cancel</button>
              <button type="submit" disabled={busy} className={`${pill} bg-info font-semibold text-white hover:brightness-110 disabled:opacity-40`}>{busy ? 'Saving…' : 'Done'}</button>
            </>
          ) : (
            <button type="button" onClick={startEdit} className={`${pill} text-info hover:bg-info/10`}>Edit</button>
          )}
        </div>
        <RecurringIcon name={bill.match_name_contains} glyph={bill.glyph} size={56} />
        <div className="min-w-0 flex-1">
          {editing ? (
            <input value={form.name} onChange={set('name')} aria-label="Name" autoFocus autoComplete="off"
              className="-mx-2 w-[calc(100%+1rem)] rounded-lg bg-band px-2 py-0.5 text-[24px] font-semibold tracking-[-0.02em] text-ink outline-none" />
          ) : (
            <h3 className="text-[24px] leading-tight font-semibold tracking-[-0.02em] text-ink">{bill.name}</h3>
          )}
          <p className="mt-0.5 text-[15px] text-muted tnum">
            {formatMoney(Math.abs(bill.expected_amount_cents))}{bill.amount_varies ? ' on average' : ''} · {cadenceLine(bill)}
          </p>
          <p className={`mt-0.5 text-[13px] ${status.tone === 'spend' ? 'text-spend' : 'text-muted'}`}>{status.text}</p>
        </div>
        {error && <p role="alert" className="order-last w-full text-[13px] text-spend">{error}</p>}
      </header>

      <div className="space-y-7">
        <GroupBlock header="The Bill">
          <GroupRow label={bill.amount_varies && !editing ? 'Expected (average)' : 'Amount'} as={editing ? 'label' : 'div'} htmlFor="bill-amount" className={editing ? 'focus-within:bg-band' : ''}>
            {editing
              ? <input id="bill-amount" value={form.amount} onChange={set('amount')} inputMode="decimal" className={FIELD} />
              : <span className="text-ink tnum">{formatMoney(Math.abs(bill.expected_amount_cents))}</span>}
          </GroupRow>
          <GroupRow label="How often">
            {editing
              ? <Dropdown inRow value={form.cadence} onChange={set('cadence')} options={CADENCES} aria-label="How often" />
              : <span className="text-ink">{CADENCES.find((c) => c.value === bill.cadence)?.label ?? bill.cadence}</span>}
          </GroupRow>
          {(editing ? HAS_DAY.has(form.cadence) : HAS_DAY.has(bill.cadence)) && (
            <GroupRow label="Day of the month" as={editing ? 'label' : 'div'} htmlFor="bill-day" className={editing ? 'focus-within:bg-band' : ''}>
              {editing
                ? <input id="bill-day" value={form.day} onChange={(e) => setForm((f) => ({ ...f, day: e.target.value.replace(/\D/g, '').slice(0, 2) }))} inputMode="numeric" placeholder="Any" className={FIELD} />
                : <span className="text-ink tnum">{bill.match_days_of_month?.[0] ?? 'Any'}</span>}
            </GroupRow>
          )}
          {!editing && <GroupRow label={bill.state === 'late' || bill.state === 'stopped' ? 'Expected' : 'Next'}><span className="tnum">{bill.next_date ? formatShortDate(bill.next_date) : '—'}</span></GroupRow>}
          {!editing && <GroupRow label="Last charged"><span className="tnum">{bill.last_date ? formatShortDate(bill.last_date) : '—'}</span></GroupRow>}
        </GroupBlock>

        <div className={`space-y-7 transition-opacity duration-200 ${editing ? 'pointer-events-none opacity-40' : ''}`} inert={editing}>
          {/* Averaged since the bill was first seen, not over a fixed twelve months (D365). */}
          <GroupBlock header="What It Costs" footer={bill.since ? `Read off its own charges since ${monthShort(bill.since.slice(0, 7))}.` : 'Read off its own charges.'}>
            {bill.avg_monthly_cents != null && <GroupRow label="Average a month"><span className="text-ink tnum">{formatMoney(bill.avg_monthly_cents)}</span></GroupRow>}
            {bill.since && <GroupRow label={`Since ${monthShort(bill.since.slice(0, 7))}`}><span className="tnum">{formatMoney(bill.total_cents ?? 0)}</span></GroupRow>}
            {!bill.amount_varies && <GroupRow label="A year at this price"><span className="tnum">{formatMoney(bill.monthly_cents * 12)}</span></GroupRow>}
            {price && <GroupRow label="Price"><span className={`tnum ${price.up ? 'text-spend' : 'text-ink'}`}>{price.text}</span></GroupRow>}
          </GroupBlock>

          <GroupBlock header={`Charges${charges.data ? ` · ${charges.data.length}` : ''}`} footer="Take off a charge that isn't this bill; it stays in Transactions.">
            {!charges.data && <GroupRow label={<Spinner size={14} className="text-muted" />} />}
            {charges.data?.length === 0 && <GroupRow label={<span className="text-muted">None linked yet</span>} />}
            {charges.data?.slice(0, 12).map((c) => (
              <GroupRow key={c.id} label={<span className="tnum">{formatShortDate(c.posted_date)}{c.posted_date.slice(0, 4) !== todayISO().slice(0, 4) ? `, ${c.posted_date.slice(0, 4)}` : ''}</span>}>
                <span className="min-w-0 truncate text-[13px]">{c.account_name}</span>
                <span className="text-ink tnum">{formatMoney(Math.abs(c.amount_cents))}</span>
                <button type="button" disabled={busy} onClick={() => unlink(c)} className="shrink-0 text-[13px] text-info hover:underline">Not this</button>
              </GroupRow>
            ))}
            {charges.data?.length > 12 && <GroupRow label={<span className="text-muted">and {charges.data.length - 12} earlier</span>} />}
          </GroupBlock>

          <GroupBlock>
            {bill.status === 'ACTIVE' && <GroupButton disabled={busy} onClick={() => setStatus('PAUSED')}>Pause Bill</GroupButton>}
            {bill.status !== 'ACTIVE' && <GroupButton disabled={busy} onClick={() => setStatus('ACTIVE')}>Resume Bill</GroupButton>}
            {bill.status !== 'ENDED' && <GroupButton tone="spend" disabled={busy} onClick={() => setStatus('ENDED')}>End Bill</GroupButton>}
          </GroupBlock>
        </div>
      </div>
    </form>
  );
}
