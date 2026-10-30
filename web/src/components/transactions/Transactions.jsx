import { useEffect, useRef, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { api, TXN_TYPE_LABELS } from '../../api';
import { useNotify } from '../../hooks/use-notify';
import { txnName } from '../../lib/transactions/txn-name';
import { editedToast } from '../../lib/app/toast-words';
import { Select, Button, PageTitle } from '../ui/Form';
import { Dropdown } from '../ui/Dropdown';
import { DateRangePicker } from '../ui/DatePicker';
import { CategoryGlyph } from '../../lib/categories/category-icons';
import { rangeLabel } from '../../lib/app/dates';
import { MerchantHistory } from './MerchantHistory';
import { DataTable } from '../ui/DataTable';
import { TransactionDetail } from './TransactionDetail';
import { transactionColumns } from './columns';
import { needsAttention } from '../../lib/transactions/payment-source';
import { useDesign } from '../../hooks/use-design';
import { GlassTransactions } from './GlassTransactions';
import { TXN_TYPE_CHOICES, accountChoices, blankChoice, categoryChoices, personChoices } from '../../lib/categories/dropdown-choices';
import { monthLong } from '../../lib/app/dates';
import { useApi } from '../../hooks/use-api';
import { placeLabel } from '../../lib/transactions/place-groups';
import { PlacePicker } from './PlacePicker';
import { ListSkeleton } from '../ui/Loading';
import { Pager } from '../ui/Pager';

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
const DEFAULT_PAGE_SIZE = 25;

const monthKey = (iso) => iso.slice(0, 7);
const monthLabel = monthLong;

const EMPTY_FILTERS = {
  // Each picker takes several at once: categories (D287), and accounts,
  // people and types too (D304).
  account_id: [],
  person_id: [],
  category_id: [],
  txn_type: [],
  // Where it happened (D352): place keys, "online" or "Town|ST".
  place: [],
  from: '',
  to: '',
  q: '',
};

// What each filter field shows before anything is picked (D230).
const PERSON_ICON = (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
    <circle cx="8" cy="5.5" r="2.6" /><path d="M3 13.5c.6-2.6 2.6-4 5-4s4.4 1.4 5 4" />
  </svg>
);
const PIN_ICON = (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M8 14.5s4.5-4.2 4.5-7.8a4.5 4.5 0 1 0-9 0c0 3.6 4.5 7.8 4.5 7.8Z" /><circle cx="8" cy="6.6" r="1.6" />
  </svg>
);

const FIELD_ICON = {
  account: <CategoryGlyph iconKey="card" size={14} />,
  person: PERSON_ICON,
  category: <CategoryGlyph iconKey="tag" size={14} />,
  type: <CategoryGlyph iconKey="swap" size={14} />,
  place: PIN_ICON,
};

const XMark = ({ size = 10 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

export function Transactions({ accounts, people, categories }) {
  const notify = useNotify();
  const { design } = useDesign();
  const glass = design === 'glass';
  const vivid = design === 'vivid';
  // ?account=<id> (D297) or ?q=<text> (D300): opened from an account or a
  // merchant in Settings, filtered to it.
  const [filters, setFilters] = useState(() => {
    const url = new URLSearchParams(window.location.search);
    const account = url.get('account');
    const q = url.get('q')?.trim().slice(0, 100) ?? '';
    return { ...EMPTY_FILTERS, ...(/^\d+$/.test(account ?? '') ? { account_id: [account] } : {}), ...(q ? { q } : {}) };
  });
  const placesReq = useApi('transaction-places', () => api.transactions.places(), { tags: ['transactions'] });
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [error, setError] = useState(null);
  // The list (useApi, D389): kept, so coming back shows it at once. Only
  // typing in the search box waits 250ms (no request per keystroke; below
  // "feels laggy"); opening the page, a picker or another page asks at
  // once. It used to wait 250ms for everything, opening the page too.
  const [q, setQ] = useState(filters.q);
  useEffect(() => {
    const timer = setTimeout(() => setQ(filters.q), 250);
    return () => clearTimeout(timer);
  }, [filters.q]);
  const query = { ...filters, q };
  const list = useApi(
    `transactions:${JSON.stringify(query)}:${page}:${pageSize}`,
    () => api.transactions.list({ ...query, limit: pageSize, offset: page * pageSize }),
    { tags: ['transactions'] },
  );
  const data = list.data ?? null;
  const setData = list.setData;
  const load = list.reload;
  const [historyMerchant, setHistoryMerchant] = useState(null);
  // Review is its own page now (D212); an old ?review=<tab> link goes there.
  // Its button left this page in D230: the sidebar badge already counts it.
  const [params] = useSearchParams();
  const reviewTab = params.get('review');

  // ?txn=<id> (D284): land on one transaction, from the cashback detail. The
  // list is filtered to its account and month, and its row opens and scrolls into view.
  const txnParam = Number(params.get('txn')) || null;
  const [focus, setFocus] = useState(null);
  useEffect(() => {
    if (!txnParam) return undefined;
    let stale = false;
    api.transactions.get(txnParam).then((t) => {
      if (stale) return;
      const month = t.posted_date.slice(0, 7);
      const [y, m] = month.split('-').map(Number);
      const lastDay = String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0');
      setFilters({ ...EMPTY_FILTERS, account_id: [String(t.account_id)], from: `${month}-01`, to: `${month}-${lastDay}` });
      setPage(0);
      setFocus(t.id);
    }).catch(() => { /* gone since the link was made: the plain list is shown */ });
    return () => { stale = true; };
  }, [txnParam]);
  useEffect(() => {
    if (!focus || !data?.rows?.some((r) => r.id === focus)) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    document.querySelector(`[data-row-key="${focus}"]`)?.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
  }, [focus, data]);
  const searchRef = useRef(null);

  // "/" jumps to search from anywhere on the page, unless you're typing.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);


  const setFilter = (key) => (event) => {
    setFilters({ ...filters, [key]: event.target.value });
    setPage(0); // a new filter invalidates the old page position
  };
  const clearFilter = (key) => setFilter(key)({ target: { value: '' } });
  const setValue = (key) => (value) => setFilter(key)({ target: { value } });
  const setRange = (from, to) => { setFilters({ ...filters, from, to }); setPage(0); };

  /**
   * Recategorize / rename in place. Both are presentation-layer
   * truth, so they stay editable forever; amounts and dates came off
   * a statement and don't.
   */
  const recategorize = async (transaction, value, undoing = false) => {
    const categoryId = value === '' ? null : Number(value);
    try {
      await api.transactions.update(transaction.id, { category_id: categoryId });
      if (!undoing) {
        const name = categories.find((c) => c.id === categoryId)?.name ?? null;
        const { message, options } = editedToast(txnName(transaction) ?? transaction.description, 'category', name,
          () => recategorize({ ...transaction, category_id: categoryId }, transaction.category_id == null ? '' : String(transaction.category_id), true));
        notify(message, options);
      }
      setData((data) => ({
        ...data,
        rows: data.rows.map((r) =>
          r.id === transaction.id
            ? {
                ...r,
                category_id: categoryId,
                category_name: categories.find((c) => c.id === categoryId)?.name ?? null,
              }
            : r
        ),
      }));
    } catch (err) {
      setError(err.message);
    }
  };

  const rename = async (transaction, merchant, undoing = false) => {
    try {
      await api.transactions.update(transaction.id, { merchant });
      if (!undoing) {
        const { message, options } = editedToast(transaction.description, 'merchant', merchant || 'none',
          () => rename({ ...transaction, merchant }, transaction.merchant ?? '', true));
        notify(message, options);
      }
      setData((data) => ({
        ...data,
        rows: data.rows.map((r) => (r.id === transaction.id ? { ...r, merchant } : r)),
      }));
    } catch (err) {
      setError(err.message);
    }
  };

  // Extraction gets the type right almost always, but statement
  // quirks (an internal "adjustment" line that isn't really a refund)
  // mean it sometimes needs a manual correction.
  const retype = async (transaction, txn_type, undoing = false) => {
    try {
      await api.transactions.update(transaction.id, { txn_type });
      if (!undoing) {
        const { message, options } = editedToast(txnName(transaction) ?? transaction.description, 'txn_type', TXN_TYPE_LABELS[txn_type] ?? txn_type,
          () => retype({ ...transaction, txn_type }, transaction.txn_type, true));
        notify(message, options);
      }
      setData((data) => ({
        ...data,
        rows: data.rows.map((r) => (r.id === transaction.id ? { ...r, txn_type } : r)),
      }));
    } catch (err) {
      setError(err.message);
    }
  };

  const withAll = (options, label = 'All') => [blankChoice(label), ...options];
  const accountOptions = withAll(accountChoices(accounts));
  const personOptions = withAll(personChoices(people, { short: true }), 'Everyone');
  // Three across with a count under each, like Where (D372).
  const counts = new Map(categories.map((c) => [String(c.id), c.transaction_count]));
  const categoryOptions = withAll(categoryChoices(categories).map((o) => ({ ...o, hint: counts.get(o.value) ? `${Number(counts.get(o.value)).toLocaleString()} transactions` : 'None yet' })));
  const typeOptions = withAll(TXN_TYPE_CHOICES);
  // Every place the purchases happened (D352); the picker shows them by state (D370).
  const places = placesReq.data ?? [];

  // One removable pill per filter that's set, for the line under the pickers.
  const labelOf = (options, value) => options.find((o) => o.value === value)?.label ?? value;
  const pills = (field, key, options) => filters[field].map((v) => ({
    key: `${key}-${v}`, label: labelOf(options, v), clear: () => setValue(field)(filters[field].filter((x) => x !== v)),
  }));
  const activeFilters = [
    filters.q && { key: 'q', label: `“${filters.q}”`, clear: () => clearFilter('q') },
    (filters.from || filters.to) && { key: 'date', label: rangeLabel(filters.from, filters.to), clear: () => setRange('', '') },
    // One pill per picked value, each removable on its own.
    ...pills('account_id', 'account', accountOptions),
    ...pills('person_id', 'person', personOptions),
    ...pills('category_id', 'category', categoryOptions),
    ...pills('txn_type', 'type', typeOptions),
    ...pills('place', 'place', filters.place.map((v) => ({ value: v, label: placeLabel(places, v) }))),
  ].filter(Boolean);

  const total = data?.total ?? 0;
  const firstRow = total === 0 ? 0 : page * pageSize + 1;
  const lastRow = Math.min((page + 1) * pageSize, total);

  const changePageSize = (event) => {
    setPageSize(Number(event.target.value));
    setPage(0); // a new page size invalidates the old page position
  };

  // DataTable (D145) owns the rows, month headers, zebra and each row's
  // ＋ detail; the cells come from the column set Cards shares (D146).
  const columns = transactionColumns({
    categories,
    onRename: rename,
    onRecategorize: recategorize,
    onRetype: retype,
    onOpenMerchant: setHistoryMerchant,
  });

  // The filter fields (D230), the same in every design: search and dates on
  // the first line (75/25), the four pickers evenly on the second.
  const filterFields = (
    <>
      <div className="mb-3 grid grid-cols-1 gap-2.5 md:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
        <label className="field-box group flex h-[3.375rem] min-w-0 items-center gap-3 rounded-xl border border-rule bg-raised pl-4 pr-3 transition-colors focus-within:border-info focus-within:ring-4 focus-within:ring-info/15 hover:border-rule-str">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0 text-faint">
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.4" />
            <path d="M10.8 10.8L14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-[0.6875rem] leading-tight text-muted">Search</span>
            <input
              ref={searchRef}
              type="text"
              value={filters.q}
              onChange={setFilter('q')}
              placeholder="Merchant, description or amount"
              className="min-w-0 bg-transparent leading-snug text-ink placeholder:text-faint focus:outline-none"
            />
          </span>
          {filters.q ? (
            <button
              type="button"
              onClick={() => { clearFilter('q'); searchRef.current?.focus(); }}
              aria-label="Clear search"
              className="flex size-6 shrink-0 items-center justify-center rounded-full text-faint transition-colors hover:bg-band hover:text-ink"
            >
              <XMark size={12} />
            </button>
          ) : (
            <kbd className="hidden shrink-0 rounded border border-b-2 border-rule-str px-1.5 font-mono text-[0.6875rem] text-faint sm:inline" title="Press / to search">/</kbd>
          )}
        </label>
        <DateRangePicker from={filters.from} to={filters.to} onChange={setRange} />
      </div>
      <div className="mb-3 grid grid-cols-2 gap-2.5 lg:grid-cols-5">
        <Dropdown multiple label="Account" fieldIcon={FIELD_ICON.account} value={filters.account_id} onChange={setValue('account_id')} options={accountOptions} recentKey="account" placeholder="All" />
        <Dropdown multiple label="Person" fieldIcon={FIELD_ICON.person} value={filters.person_id} onChange={setValue('person_id')} options={personOptions} placeholder="Everyone" />
        <Dropdown multiple columns={3} label="Category" fieldIcon={FIELD_ICON.category} value={filters.category_id} onChange={setValue('category_id')} options={categoryOptions} recentKey="category" placeholder="All" />
        <Dropdown multiple label="Type" fieldIcon={FIELD_ICON.type} value={filters.txn_type} onChange={setValue('txn_type')} options={typeOptions} placeholder="All" />
        {/* The fifth picker (D352, the owner's pick): where it happened. Full width on a phone's two columns. */}
        <div className="col-span-2 lg:col-span-1">
          <PlacePicker value={filters.place} onChange={setValue('place')} places={places} fieldIcon={FIELD_ICON.place} />
        </div>
      </div>

    </>
  );

  if (reviewTab) return <Navigate to={`/review?tab=${encodeURIComponent(reviewTab)}`} replace />;

  // Glass (D251): the same state and edits, laid out the Apple way.
  if (glass) {
    return (
      <>
        <GlassTransactions
          key={focus ?? 'list'}
          initialOpen={focus ? [focus] : undefined}
          data={data}
          error={error ?? list.error}
          clearAll={() => { setFilters(EMPTY_FILTERS); setPage(0); }}
          activeFilters={activeFilters}
          filterFields={filterFields}
          page={page}
          setPage={setPage}
          pageSize={pageSize}
          setPageSize={(n) => { setPageSize(n); setPage(0); }}
          categories={categories}
          lookup={{ categories, accounts, people }}
          handlers={{ onRename: rename, onRetype: retype, onRecategorize: recategorize, onOpenMerchant: setHistoryMerchant, onChanged: load }}
        />
        {historyMerchant && <MerchantHistory merchant={historyMerchant} onClose={() => setHistoryMerchant(null)} />}
      </>
    );
  }

  return (
    <div>
      <header className="mb-6">
        <PageTitle className="text-2xl font-medium tracking-tight text-ink" emoji="🧾" tint="bg-vivid-teal/15">Transactions</PageTitle>
        <p className="mt-1 text-sm text-muted">The permanent record — every approved row.</p>
      </header>

      {filterFields}

      {/* What's showing: the count, each filter with its own ×, and a way back to everything. */}
      <div className="mb-4 flex min-h-6 flex-wrap items-center gap-x-2.5 gap-y-1.5 text-sm text-muted">
        {data && <span><span className="font-mono font-medium tnum text-ink">{total.toLocaleString()}</span> transaction{total === 1 ? '' : 's'}</span>}
        {activeFilters.map((f) => (
          <span key={f.key} className="inline-flex items-center gap-1 rounded-full bg-earn/10 py-0.5 pl-2.5 pr-1 text-ink">
            {f.label}
            <button type="button" onClick={f.clear} aria-label={`Remove ${f.label}`} className="flex size-4 items-center justify-center rounded-full text-muted transition-colors hover:bg-rule hover:text-ink">
              <XMark />
            </button>
          </span>
        ))}
        {activeFilters.length > 0 && (
          <button type="button" onClick={() => { setFilters(EMPTY_FILTERS); setPage(0); }} className="text-earn underline-offset-4 hover:underline">
            Clear filters
          </button>
        )}
      </div>

      {(error ?? list.error) && <p className="mb-4 text-sm text-spend">{error ?? list.error}</p>}

      {!data && !(error ?? list.error) && <ListSkeleton rows={10} />}
      {data && total > 0 && (
        <DataTable
          key={focus ?? 'list'}
          initialOpen={focus ? [focus] : undefined}
          fixed
          roomy
          stickyHeader
          rows={data.rows}
          rowKey={(t) => t.id}
          groupOf={(t) => monthKey(t.posted_date)}
          groupLabel={monthLabel}
          attention={needsAttention}
          renderDetail={(t) => <TransactionDetail transaction={t} lookup={{ categories, accounts, people }} onChanged={load} edit={{ categories, onRetype: retype, onRecategorize: recategorize }} />}
          columns={columns}
        />
      )}

      {data && total === 0 && (
        <p className="py-10 text-center text-sm text-muted">
          No transactions match. Import a statement, or loosen the filters.
        </p>
      )}

      {/* Vivid's pager (D397); Classic keeps Newer and Older. */}
      {total > 0 && vivid && (
        <div className="mt-6">
          <Pager page={page} total={total} pageSize={pageSize} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(0); }} />
        </div>
      )}
      {total > 0 && !vivid && (
        <div className="mt-6 flex flex-col items-center gap-3 border-t border-rule pt-5 text-sm">
          <div className="flex items-center gap-3">
            <Button variant="quiet" onClick={() => setPage(page - 1)} disabled={page === 0}>
              Newer
            </Button>
            <span className="text-faint tnum">
              {firstRow}–{lastRow} of {total}
            </span>
            <Button variant="quiet" onClick={() => setPage(page + 1)} disabled={lastRow >= total}>
              Older
            </Button>
          </div>
          <label className="flex items-center gap-2 whitespace-nowrap text-xs text-muted">
            Rows per page
            <Select
              value={String(pageSize)}
              onChange={changePageSize}
              options={PAGE_SIZE_OPTIONS.map((n) => ({ value: String(n), label: String(n) }))}
            />
          </label>
        </div>
      )}

      {historyMerchant && (
        <MerchantHistory merchant={historyMerchant} onClose={() => setHistoryMerchant(null)} />
      )}

    </div>
  );
}
