import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { api, formatMoney, formatShortDate, formatTimestamp, maskName, shortPersonName, TXN_TYPE_LABELS } from '../../api';
import { txnName } from '../../txn-name';
import { describeAction, describeDetail } from '../../activity-format';
import { activityGlyph } from '../../activity-glyphs';
import { ACTIVITY_GLYPHS } from '../../glass-activity-glyphs';
import { paymentExplanation, linkedDisplay } from '../../payment-source';
import { TXN_TYPE_CHOICES, blankChoice, categoryChoices } from '../../dropdown-choices';
import { Dropdown } from '../ui/Dropdown';
import { MerchantAvatar } from '../MerchantAvatar';
import { PaymentMark } from '../PaymentMark';
import { Tile, Chevron } from '../settings/glass-ui';
import { useWide } from '../../use-wide';
import { PaymentSourcePicker } from './TransactionDetail';

/**
 * Glass Transactions (D251). The same data, filters and edits as
 * Transactions.jsx, laid out the Apple way:
 *   - the same filter fields as every design (D230), owned by Transactions.jsx;
 *   - what's listed adds up: "Out · In" for every match, and each month's
 *     own totals in its heading;
 *   - Category with the type under it only when it says something the
 *     category doesn't ("Card payment / Card Payment" was two columns);
 *   - money out in plain ink, money in green, zero neutral: red is for
 *     what went wrong, not for every coffee;
 *   - the whole row opens it, a chevron says so; the detail edits the
 *     name, type and category with visible controls;
 *   - columns drop away as the window narrows, Merchant never does.
 */

const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthKey = (iso) => iso.slice(0, 7);
const monthLabel = (key) => { const [y, m] = key.split('-').map(Number); return `${MONTH_FULL[m - 1]} ${y}`; };
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z]/g, '');

/** The amount as Wallet sets it: out in ink, in green with a plus, zero plain. */
export function GlassAmount({ cents, className = '' }) {
  if (!cents) return <span className={`text-muted tnum ${className}`}>{formatMoney(0)}</span>;
  return <span className={`tnum ${cents > 0 ? 'text-earn' : 'text-ink'} ${className}`}>{formatMoney(cents, { showSign: cents > 0 })}</span>;
}

/** The type, under the category, only when it adds something. */
const typeNote = (t) => {
  const type = TXN_TYPE_LABELS[t.txn_type] ?? t.txn_type;
  if (!type) return 'No type';
  return norm(type) === norm(t.category_name) ? null : type;
};

/* -------------------------------- detail -------------------------------- */

/** "Wed, Sep 17", with the year when it isn't this year. */
const longDate = (iso) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...(y !== new Date().getFullYear() && { year: 'numeric' }) });
};

/** The history card (the 30%): every edit with its Activity glyph, or a calm "never edited". */
function HistoryCard({ t, lookup }) {
  const [history, setHistory] = useState(null);
  useEffect(() => {
    let cancelled = false;
    api.activity(50, { entity: `transaction:${t.id}` })
      .then((rows) => !cancelled && setHistory(rows))
      .catch(() => !cancelled && setHistory([]));
    return () => { cancelled = true; };
  }, [t.id]);

  return (
    <div className="flex min-h-full flex-col overflow-hidden rounded-[18px] border border-[var(--g-hairline)] bg-[var(--g-solid)] shadow-[0_1px_2px_rgb(0_0_0/0.05),0_18px_40px_-24px_rgb(0_0_0/0.35)]">
      <div className="flex items-baseline justify-between px-5 pt-4 pb-2">
        <h4 className="text-[15px] font-semibold text-ink">History</h4>
        {history?.length > 0 && <span className="text-[12px] text-muted tnum">{history.length} {history.length === 1 ? 'change' : 'changes'}</span>}
      </div>
      {history === null ? (
        <p className="px-5 pb-5 text-[13px] text-muted">Loading…</p>
      ) : history.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-5 pt-2 pb-6 text-center">
          <Tile color="#34C759" size={40}><svg width="24" height="24" viewBox="0 0 512 512">{ACTIVITY_GLYPHS['checkmark-done']}</svg></Tile>
          <p className="text-[15px] font-medium text-ink">Never edited</p>
          <p className="text-[13px] text-muted">Exactly as the statement printed it.</p>
        </div>
      ) : (
        <ol className="px-2 pb-3" style={{ '--gs-inset': '46px' }}>
          {history.map((entry) => {
            const { label } = describeAction(entry.action);
            const { icon, color } = activityGlyph(entry.action);
            const { changes, legacyFields } = describeDetail(entry.detail, lookup);
            return (
              <li key={entry.id} className="gs-row flex gap-3 px-3 py-2.5">
                <Tile color={color} size={26}><svg width="15" height="15" viewBox="0 0 512 512">{ACTIVITY_GLYPHS[icon]}</svg></Tile>
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] leading-snug text-ink">{label}</div>
                  <div className="text-[12px] text-muted tnum">{formatTimestamp(entry.created_at)}</div>
                  {changes.map((c) => (
                    <div key={c.label} className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px]">
                      <span className="text-muted">{c.label}</span>
                      <span className="rounded-full bg-spend/10 px-2 py-px text-spend line-through decoration-spend/40">{c.from}</span>
                      <span className="text-faint" aria-hidden="true">→</span>
                      <span className="rounded-full bg-earn/10 px-2 py-px font-medium text-earn">{c.to}</span>
                    </div>
                  ))}
                  {legacyFields && <div className="mt-1 text-[12px] text-muted">Changed {legacyFields.join(', ').toLowerCase()}</div>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/** One label … value line of the receipt. */
function Line({ label, children }) {
  return (
    <div className="gs-row flex min-h-11 items-center justify-between gap-4 py-2">
      <span className="shrink-0 text-[13px] text-muted">{label}</span>
      <span className="flex min-w-0 justify-end text-right text-[14px] text-ink">{children}</span>
    </div>
  );
}

function NameField({ t, onRename }) {
  const [draft, setDraft] = useState(txnName(t) ?? '');
  const save = () => { const v = draft.trim(); if (v && v !== txnName(t)) onRename(t, v); };
  return (
    <label className="flex min-w-0 items-center justify-end gap-1.5">
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setDraft(txnName(t) ?? ''); e.currentTarget.blur(); } }}
        placeholder={t.description}
        aria-label="Merchant name"
        className="w-full min-w-0 max-w-[22rem] rounded-[8px] border border-transparent bg-transparent px-2 py-1 text-right text-[14px] text-ink transition-colors hover:border-[var(--g-hairline)] focus:border-info focus:bg-[var(--g-solid)] focus:text-left focus:outline-none"
      />
      <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0 text-faint"><path d="M11 2.5l2.5 2.5L6 12.5H3.5V10z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>
    </label>
  );
}

// Editable rows read as blue text with a chevron, like a tappable row in Settings.
const PICK = '!inline-flex !w-auto !min-w-0 !max-w-[16rem] !border-transparent !bg-transparent !px-1 !py-0.5 !text-info !shadow-none hover:!bg-[var(--g-hover)] text-[14px]';

/**
 * The opened row (D252): a receipt card, as Wallet shows one (the 70%),
 * and its history beside it (the 30%). The receipt is one list: what the
 * statement says and what you can change, together; editable rows are
 * blue with a chevron, the name has a pencil.
 */
function GlassDetail({ t, categories, lookup, onRename, onRetype, onRecategorize, onChanged }) {
  const paid = paymentExplanation(t.payment_source, t.posted_date, t.payment_target);
  const linked = linkedDisplay(t);
  const title = linked ? linked.name : txnName(t) ?? t.description;
  const typeOptions = [blankChoice('None'), ...TXN_TYPE_CHOICES];
  const categoryOptions = [blankChoice('None'), ...categoryChoices(categories)];

  return (
    <div className="grid grid-cols-1 gap-4 px-4 pt-2 pb-5 md:grid-cols-[minmax(0,7fr)_minmax(0,3fr)] md:pl-[4.75rem]">
      <div className="overflow-hidden rounded-[18px] border border-[var(--g-hairline)] bg-[var(--g-solid)] shadow-[0_1px_2px_rgb(0_0_0/0.05),0_18px_40px_-24px_rgb(0_0_0/0.35)]">
        <div className="flex items-center gap-3.5 px-5 pt-4 pb-3">
          {linked ? (
            <MerchantAvatar merchant={linked.logo} description={linked.zelle ? 'Zelle' : t.description} txnType="payment" amountCents={t.amount_cents} clickable={false} size={48} />
          ) : (
            <MerchantAvatar merchant={t.merchant} description={t.description} txnType={t.txn_type} amountCents={t.amount_cents}
              categoryName={t.category_name} categoryIconKey={t.category_icon_key} size={48} clickable={false} />
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-[19px] leading-tight font-bold tracking-[-0.02em] text-ink">{title}</div>
            <div className="mt-0.5 truncate text-[13px] text-muted">{longDate(t.posted_date)}{t.place ? ` · ${t.place.label}` : ''}</div>
          </div>
          <div className="shrink-0 text-right">
            <GlassAmount cents={t.amount_cents} className="block text-[26px] leading-tight font-bold tracking-[-0.02em]" />
            <div className="text-[12px] text-muted">{t.account_name}{t.account_mask && <span className="tnum"> ··{t.account_mask}</span>}</div>
          </div>
        </div>
        <div className="mx-5 rounded-[10px] bg-band px-3 py-2 font-mono text-[12px] break-words text-ink" title="As the statement printed it">{t.description}</div>
        <div className="px-5 pt-2 pb-3" style={{ '--gs-inset': '0px' }}>
          <Line label="Name"><NameField t={t} onRename={onRename} /></Line>
          <Line label="Category">
            <Dropdown value={t.category_id ?? ''} onChange={(v) => onRecategorize(t, v)} options={categoryOptions} recentKey="category" aria-label="Category" className={PICK} />
          </Line>
          <Line label="Type">
            <Dropdown value={t.txn_type ?? ''} onChange={(v) => onRetype(t, v)} options={typeOptions} aria-label="Type" className={PICK} />
          </Line>
          <Line label="Account">{t.account_name}{t.account_mask && <span className="text-muted tnum">&nbsp;··{t.account_mask}</span>}</Line>
          {t.place && t.place.title !== t.place.label && <Line label="Where">{t.place.title}</Line>}
          <Line label="Person">{maskName(t.person_name)}</Line>
          {t.notes && <Line label="Notes">{t.notes}</Line>}
        </div>
        {paid && (
          <div className="border-t border-rule px-5 py-3.5">
            <div className={`flex items-center gap-1.5 text-[14px] font-medium ${paid.verified || paid.named ? 'text-earn' : 'text-spend'}`}>
              <PaymentMark source={t.payment_source ?? t.payment_target} />
              {paid.title}
            </div>
            {paid.lines.map((line) => (
              <p key={line} className={`mt-1 text-[13px] ${line.startsWith('On that statement:') ? 'break-words font-mono text-[12px] text-faint' : 'text-muted'}`}>{line}</p>
            ))}
            {t.payment_source && <PaymentSourcePicker transaction={t} onChanged={onChanged} />}
          </div>
        )}
      </div>
      <HistoryCard t={t} lookup={lookup} />
    </div>
  );
}

/* --------------------------------- rows --------------------------------- */

function MerchantCell({ t, onOpenMerchant, showDate }) {
  const linked = linkedDisplay(t);
  const name = linked ? linked.name : txnName(t) ?? t.description;
  const sub = linked ? null : t.place ? t.place.label : t.merchant && txnName(t) === t.merchant ? t.description : null;
  return (
    <div className="flex min-w-0 items-center gap-3">
      {linked ? (
        <MerchantAvatar merchant={linked.logo} description={linked.zelle ? 'Zelle' : t.description} txnType="payment" amountCents={t.amount_cents} clickable={false} size={30} />
      ) : (
        <span onClick={(e) => { if (t.merchant) { e.stopPropagation(); onOpenMerchant(t.merchant); } }}>
          <MerchantAvatar merchant={t.merchant} description={t.description} txnType={t.txn_type} amountCents={t.amount_cents}
            categoryName={t.category_name} categoryIconKey={t.category_icon_key} size={30} clickable={Boolean(t.merchant)} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5 text-[15px] text-ink">
          <span className="truncate">{name}</span>
          {(linked?.link || t.payment_source) && <PaymentMark source={linked ? linked.link : t.payment_source} />}
        </span>
        {sub && <span className="block truncate text-[12px] text-muted" title={t.description}>{sub}</span>}
        {/* Narrow windows hide Date, Category and Account; they ride under the name, as in Wallet. */}
        <span className="block truncate text-[12px] text-muted md:hidden">
          {[showDate && formatShortDate(t.posted_date), t.category_name ?? 'No category', t.account_name].filter(Boolean).join(' · ')}
        </span>
      </div>
    </div>
  );
}

function Row({ t, cols, open, onToggle, categories, lookup, handlers, zebra }) {
  const reduceMotion = useReducedMotion();
  const note = typeNote(t);
  const categoryOptions = [blankChoice('None'), ...categoryChoices(categories)];
  const stop = (e) => e.stopPropagation();
  return (
    <>
      <tr
        tabIndex={0}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); onToggle(); } }}
        className={`gt-row cursor-pointer border-b border-rule transition-colors ${open ? 'bg-[var(--g-selected)]' : zebra ? 'bg-band/40 hover:bg-[var(--g-hover)]' : 'hover:bg-[var(--g-hover)]'}`}
      >
        {cols.sm && <td className="py-3 pr-3 pl-4 align-middle text-[14px] text-ink tnum whitespace-nowrap">{formatShortDate(t.posted_date)}</td>}
        <td className={`py-3 pr-4 align-middle ${cols.sm ? '' : 'pl-4'}`}><MerchantCell t={t} showDate={!cols.sm} onOpenMerchant={handlers.onOpenMerchant} /></td>
        {cols.md && <td className="py-3 pr-3 align-middle" onClick={stop}>
          <Dropdown quiet value={t.category_id ?? ''} onChange={(v) => handlers.onRecategorize(t, v)} options={categoryOptions}
            recentKey="category" aria-label="Category" className="max-w-full text-[14px] text-ink" />
          {note && <span className="block truncate px-1 text-[12px] text-muted">{note}</span>}
        </td>}
        {cols.xl && <td className="truncate py-3 pr-3 align-middle text-[14px] text-muted" title={t.account_name}>
          {t.account_name}{t.account_mask && <span className="tnum"> ··{t.account_mask}</span>}
        </td>}
        {cols.xxl && <td className="truncate py-3 pr-3 align-middle text-[14px] text-muted" title={maskName(t.person_name)}>
          {shortPersonName(t.person_name, t.person_nickname)}
        </td>}
        <td className="py-3 pr-2 text-right align-middle text-[15px] whitespace-nowrap"><GlassAmount cents={t.amount_cents} /></td>
        <td className="py-3 pr-3 align-middle"><Chevron open={open} /></td>
      </tr>
      <tr className={open ? 'border-b border-rule' : ''}>
        <td colSpan={cols.count} className="p-0">
          <AnimatePresence initial={false}>
            {open && (
              <motion.div
                initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                transition={reduceMotion ? { duration: 0 } : { type: 'spring', bounce: 0, duration: 0.35 }}
                className="overflow-hidden bg-band/30"
              >
                <GlassDetail t={t} categories={categories} lookup={lookup} {...handlers} />
              </motion.div>
            )}
          </AnimatePresence>
        </td>
      </tr>
    </>
  );
}

/* --------------------------------- page --------------------------------- */

/**
 * How many columns show at this width, so a heading or detail row spans
 * exactly them. A colSpan wider than the real columns makes the browser
 * invent empty ones (a blank strip on the right, a squeezed Merchant).
 */
function useColumns() {
  const sm = useWide('(min-width: 640px)');
  const md = useWide('(min-width: 768px)');
  const xl = useWide('(min-width: 1280px)');
  const xxl = useWide('(min-width: 1536px)');
  return { sm, md, xl, xxl, count: 3 + sm + md + xl + xxl };
}

/** Fixed widths shared by the header and every month's table, so their columns line up. */
function MonthCols({ cols }) {
  return (
    <colgroup>
      {cols.sm && <col className="w-[4.75rem]" />}
      <col />
      {cols.md && <col className="w-44" />}
      {cols.xl && <col className="w-48" />}
      {cols.xxl && <col className="w-24" />}
      <col className="w-[6.5rem] sm:w-28" />
      <col className="w-8" />
    </colgroup>
  );
}

/** The page's rows (newest first) as consecutive month runs. */
function byMonth(rows) {
  const out = [];
  for (const t of rows) {
    const key = monthKey(t.posted_date);
    if (out.at(-1)?.key !== key) out.push({ key, list: [] });
    out.at(-1).list.push(t);
  }
  return out;
}

export function GlassTransactions({
  data, error, clearAll, activeFilters, filterFields,
  page, setPage, pageSize, setPageSize, categories, lookup, handlers,
}) {
  const [open, setOpen] = useState(() => new Set());
  const toggle = useCallback((id) => setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }), []);
  const total = data?.total ?? 0;
  const firstRow = total === 0 ? 0 : page * pageSize + 1;
  const lastRow = Math.min((page + 1) * pageSize, total);
  const rows = data?.rows ?? [];
  const cols = useColumns();

  return (
    <div>
      <header className="mb-5">
        <h2 className="page-title">Transactions</h2>
        <p className="mt-1 text-[13px] text-muted">The permanent record: every approved row. Open one to edit it or see its history.</p>
      </header>

      {/* Your filter fields (D230), as in every design. */}
      {filterFields}

      {/* What's listed, what it adds up to, and each filter as a removable token. */}
      <div className="mb-4 flex min-h-7 flex-wrap items-center gap-x-3 gap-y-2 px-1 text-[13px] text-muted">
        {data && (
          <span>
            <span className="font-semibold text-ink tnum">{total.toLocaleString()}</span> {total === 1 ? 'transaction' : 'transactions'}
            {total > 0 && <> · Out <GlassAmount cents={data.out_cents ?? 0} className="font-semibold" /> · In <GlassAmount cents={data.in_cents ?? 0} className="font-semibold" /></>}
          </span>
        )}
        {activeFilters.map((f) => (
          <span key={f.key} className="inline-flex items-center gap-1 rounded-full bg-info/10 py-0.5 pr-1 pl-2.5 text-info">
            {f.label}
            <button type="button" onClick={f.clear} aria-label={`Remove ${f.label}`} className="flex size-4 items-center justify-center rounded-full hover:bg-info/20">
              <svg width="8" height="8" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
            </button>
          </span>
        ))}
        {activeFilters.length > 1 && <button type="button" onClick={clearAll} className="font-medium text-info">Clear all</button>}
      </div>

      {error && <p className="mb-4 px-1 text-[13px] text-spend">{error}</p>}

      {/* One group per month with space between, so months read apart
          without a colour each (owner's request). The column header is
          its own pinned bar over all of them, and each month's heading
          pins under it while that month scrolls by. Every table shares
          MonthCols, so the columns line up across groups. */}
      {data && total > 0 && (
        <div>
          <div className="gs-group sticky top-[61px] z-[2] md:top-0">
            <table className="w-full table-fixed border-collapse">
              <MonthCols cols={cols} />
              <thead>
                <tr className="table-head text-left">
                  {cols.sm && <th className="py-2.5 pl-4">Date</th>}
                  <th className={`py-2.5 pr-4 ${cols.sm ? '' : 'pl-4'}`}>Merchant</th>
                  {cols.md && <th className="py-2.5 pr-3">Category</th>}
                  {cols.xl && <th className="py-2.5 pr-3">Account</th>}
                  {cols.xxl && <th className="py-2.5 pr-3">Person</th>}
                  <th className="py-2.5 pr-2 text-right">Amount</th>
                  <th className="py-2.5 pr-3"><span className="sr-only">Open</span></th>
                </tr>
              </thead>
            </table>
          </div>
          {byMonth(rows).map(({ key, list }) => {
            const sums = data.months?.[key];
            return (
              <section key={key} aria-label={monthLabel(key)} className="mt-5">
                <h3 className="gt-month sticky top-[108px] z-[1] mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 rounded-[12px] border border-transparent px-4 py-2 md:top-[47px]">
                  <span className="text-[15px] font-semibold text-ink">{monthLabel(key)}</span>
                  {sums && (
                    <span className="text-[12px] font-normal text-muted">
                      <span className="tnum">{sums.count}</span> · Out <GlassAmount cents={sums.out_cents} /> · In <GlassAmount cents={sums.in_cents} />
                    </span>
                  )}
                </h3>
                <div className="gs-group">
                  <table className="w-full table-fixed border-collapse">
                    <MonthCols cols={cols} />
                    <tbody>
                      {list.map((t, i) => (
                        <Row key={t.id} t={t} cols={cols} open={open.has(t.id)} onToggle={() => toggle(t.id)} categories={categories} lookup={lookup} handlers={handlers} zebra={i % 2 === 1} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
      )}

      {data && total === 0 && (
        <div className="gs-group px-6 py-12 text-center">
          <p className="text-[17px] font-semibold text-ink">No transactions match</p>
          <p className="mt-1 text-[14px] text-muted">Loosen the filters, or import a statement.</p>
          {activeFilters.length > 0 && <button type="button" onClick={clearAll} className="mt-4 text-[15px] font-medium text-info">Clear filters</button>}
        </div>
      )}

      {total > 0 && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-3 text-[13px]">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setPage(page - 1)} disabled={page === 0} className="btn btn-quiet rounded-full border px-4 py-1.5 text-[14px] disabled:opacity-40">Newer</button>
            <span className="text-muted tnum">{firstRow.toLocaleString()}–{lastRow.toLocaleString()} of {total.toLocaleString()}</span>
            <button type="button" onClick={() => setPage(page + 1)} disabled={lastRow >= total} className="btn btn-quiet rounded-full border px-4 py-1.5 text-[14px] disabled:opacity-40">Older</button>
          </div>
          <div className="flex items-center gap-2 text-muted">
            Show
            <div className="segmented inline-flex rounded-lg border border-rule bg-band p-0.5">
              {[25, 50, 100].map((n) => (
                <button key={n} type="button" aria-pressed={pageSize === n} onClick={() => setPageSize(n)}
                  className="rounded-md border border-transparent px-2.5 py-0.5 text-[13px] text-muted tnum">{n}</button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
