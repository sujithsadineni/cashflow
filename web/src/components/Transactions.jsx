import { useCallback, useEffect, useState } from 'react';
import { api, maskName, TXN_TYPE_OPTIONS } from '../api';
import { Select, Button, PageTitle } from './Form';
import { MerchantHistory } from './MerchantHistory';
import { MerchantReview } from './MerchantReview';
import { DataTable } from './ui/DataTable';
import { TransactionDetail } from './transactions/TransactionDetail';
import { transactionColumns } from './transactions/columns';

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
const DEFAULT_PAGE_SIZE = 25;

const MONTH_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const monthKey = (iso) => iso.slice(0, 7);
const monthLabel = (key) => {
  const [y, m] = key.split('-').map(Number);
  return `${MONTH_FULL[m - 1]} ${y}`;
};

const EMPTY_FILTERS = {
  account_id: '',
  person_id: '',
  category_id: '',
  txn_type: '',
  from: '',
  to: '',
  q: '',
};

const inputClasses =
  'border border-rule bg-raised px-2.5 py-1.5 text-sm text-ink ' +
  'placeholder:text-faint focus:border-earn focus:outline-none';

export function Transactions({ accounts, people, categories }) {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [historyMerchant, setHistoryMerchant] = useState(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewCount, setReviewCount] = useState(0);

  const loadReviewCount = useCallback(() => {
    api.merchantReview.count().then((r) => setReviewCount(r.count)).catch(() => {});
  }, []);
  useEffect(loadReviewCount, [loadReviewCount]);

  // Debounce the fetch: typing in the search box shouldn't fire a
  // request per keystroke. 250ms is below "feels laggy".
  const load = useCallback(() => {
    const timer = setTimeout(async () => {
      try {
        setData(
          await api.transactions.list({
            ...filters,
            limit: pageSize,
            offset: page * pageSize,
          })
        );
        setError(null);
      } catch (err) {
        setError(err.message);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [filters, page, pageSize]);

  useEffect(load, [load]);

  const setFilter = (key) => (event) => {
    setFilters({ ...filters, [key]: event.target.value });
    setPage(0); // a new filter invalidates the old page position
  };
  const clearFilter = (key) => setFilter(key)({ target: { value: '' } });

  /**
   * Recategorize / rename in place. Both are presentation-layer
   * truth, so they stay editable forever; amounts and dates came off
   * a statement and don't.
   */
  const recategorize = async (transaction, value) => {
    const categoryId = value === '' ? null : Number(value);
    try {
      await api.transactions.update(transaction.id, { category_id: categoryId });
      setData({
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
      });
    } catch (err) {
      setError(err.message);
    }
  };

  const rename = async (transaction, merchant) => {
    try {
      await api.transactions.update(transaction.id, { merchant });
      setData({
        ...data,
        rows: data.rows.map((r) => (r.id === transaction.id ? { ...r, merchant } : r)),
      });
    } catch (err) {
      setError(err.message);
    }
  };

  // Extraction gets the type right almost always, but statement
  // quirks (an internal "adjustment" line that isn't really a refund)
  // mean it sometimes needs a manual correction.
  const retype = async (transaction, txn_type) => {
    try {
      await api.transactions.update(transaction.id, { txn_type });
      setData({
        ...data,
        rows: data.rows.map((r) => (r.id === transaction.id ? { ...r, txn_type } : r)),
      });
    } catch (err) {
      setError(err.message);
    }
  };

  const withAll = (options) => [{ value: '', label: 'All' }, ...options];

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

  return (
    <div>
      <header className="mb-6">
        <PageTitle className="text-2xl font-medium tracking-tight text-ink" emoji="🧾" tint="bg-vivid-teal/15">Transactions</PageTitle>
        <p className="mt-1 text-sm text-muted">The permanent record — every approved row.</p>
      </header>

      {/* Search: the primary way in — its own prominent field, not one
          of six identical-looking controls in a row. */}
      <div className="mb-4 flex max-w-lg items-center gap-2">
        <div className="relative flex-1">
          <svg
            width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
          >
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.4" />
            <path d="M10.8 10.8L14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            value={filters.q}
            onChange={setFilter('q')}
            placeholder="Search merchant or description…"
            className="w-full rounded-lg border border-rule bg-raised py-2.5 pl-9 pr-9 text-sm text-ink
                       placeholder:text-faint focus:border-earn focus:outline-none focus:ring-2 focus:ring-earn/15"
          />
          {filters.q && (
            <button
              onClick={() => clearFilter('q')}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center
                         rounded-full text-faint transition-colors hover:bg-band hover:text-ink"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
        <button
          onClick={() => setReviewOpen(true)}
          className="relative flex shrink-0 items-center gap-1.5 rounded-lg border border-rule bg-raised
                     px-3 py-2.5 text-sm text-ink transition-colors hover:bg-band"
        >
          Review
          {reviewCount > 0 && (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-spend px-1
                              font-mono text-[10px] tnum text-white">
              {reviewCount}
            </span>
          )}
        </button>
      </div>

      {/* Filters: a quiet row above the table, always visible. */}
      <div className="mb-4 flex flex-wrap items-end gap-3 text-sm">
        <label className="block">
          <span className="mb-1 block text-xs text-faint">Account</span>
          <Select
            value={filters.account_id}
            onChange={setFilter('account_id')}
            options={withAll(accounts.map((a) => ({ value: String(a.id), label: a.name })))}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-faint">Person</span>
          <Select
            value={filters.person_id}
            onChange={setFilter('person_id')}
            options={withAll(people.map((p) => ({ value: String(p.id), label: maskName(p.name) })))}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-faint">Category</span>
          <Select
            value={filters.category_id}
            onChange={setFilter('category_id')}
            options={withAll(categories.map((c) => ({ value: String(c.id), label: c.name })))}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-faint">Type</span>
          <Select
            value={filters.txn_type}
            onChange={setFilter('txn_type')}
            options={withAll(TXN_TYPE_OPTIONS)}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-faint">From</span>
          <input type="date" value={filters.from} onChange={setFilter('from')} className={inputClasses} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-faint">To</span>
          <input type="date" value={filters.to} onChange={setFilter('to')} className={inputClasses} />
        </label>
        {Object.values(filters).some((v) => v !== '') && (
          <button
            onClick={() => { setFilters(EMPTY_FILTERS); setPage(0); }}
            className="pb-2 text-xs text-muted underline-offset-4 hover:text-ink hover:underline"
          >
            Clear
          </button>
        )}
      </div>

      {error && <p className="mb-4 text-sm text-spend">{error}</p>}

      {data && total > 0 && (
        <DataTable
          fixed
          stickyHeader
          rows={data.rows}
          rowKey={(t) => t.id}
          groupOf={(t) => monthKey(t.posted_date)}
          groupLabel={monthLabel}
          renderDetail={(t) => <TransactionDetail transaction={t} lookup={{ categories, accounts, people }} />}
          columns={columns}
        />
      )}

      {data && total === 0 && (
        <p className="py-10 text-center text-sm text-muted">
          No transactions match. Import a statement, or loosen the filters.
        </p>
      )}

      {total > 0 && (
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

      {reviewOpen && (
        <MerchantReview
          onClose={() => { setReviewOpen(false); loadReviewCount(); }}
          onResolved={() => { loadReviewCount(); load(); }}
        />
      )}
    </div>
  );
}
