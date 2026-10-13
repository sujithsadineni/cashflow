import { useState } from 'react';
import { useApi } from '../use-api';
import { api } from '../api';
import { CardCarousel } from './CardCarousel';
import { StatementCalendar } from './StatementCalendar';
import { PageTitle } from './Form';
import { MerchantHistory } from './MerchantHistory';
import { DataTable } from './ui/DataTable';
import { TransactionDetail } from './transactions/TransactionDetail';
import { transactionColumns } from './transactions/columns';
import { needsAttention } from '../payment-source';
import { AccountFilterBar } from './AccountFilters';
import { useAccountFilters } from '../account-filters';
import { CardCategoryBar } from './CardCategoryBar';

const PAGE_SIZE = 25;

// A statement's real period can cross a calendar-month boundary, but
// there's no per-batch period data on this page (only the plain
// "has a statement" month list `StatementCalendar` already fetches) —
// so "that month's transactions" means the calendar month here, the
// same simple boundary the click itself is keyed by.
function monthBounds(key) {
  const [y, m] = key.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${key}-01`, to: `${key}-${String(lastDay).padStart(2, '0')}` };
}

function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Card-wise transactions: pick a card from the wallet row, see just
 * its activity below. The full filterable ledger already exists at
 * /transactions — this page is the quick, visual "what's been on
 * this card" view, not a second copy of every filter there.
 *
 * Same account-type/person filters as the Statements page, narrowing
 * which cards `CardCarousel` shows — the carousel's own look is
 * untouched, this only changes which accounts it's handed. Smaller
 * than the Statements page's own filter bar, and the calendar next to
 * it is the compact tile size — this page has far less vertical room
 * next to a single-card carousel than the Statements deck gets.
 *
 * Clicking an uploaded month on the calendar narrows the table below
 * to that month instead of doing nothing, the way it used to.
 */
export function Cards({ accounts, people, categories, onAccountsChanged }) {
  const [pickedId, setPickedId] = useState(null);
  // Month, category and page belong to the card they were picked on (D211):
  // switching cards starts the next one clean, with nothing to reset.
  const [view, setView] = useState({ cardId: null, month: null, category: null, page: 0 });
  const [actionError, setActionError] = useState(null);
  const [historyMerchant, setHistoryMerchant] = useState(null);

  const {
    typeFilter, setTypeFilter,
    personFilter, setPersonFilter,
    personOptions,
    filteredAccounts,
  } = useAccountFilters(accounts, people);

  // The picked card while the filter still shows it, else the first card it
  // does show. Worked out on each render rather than corrected in an effect
  // afterwards, so the page never draws the hidden card first.
  const selectedId = filteredAccounts.some((a) => a.id === pickedId) ? pickedId : filteredAccounts[0]?.id ?? null;
  const own = view.cardId === selectedId;
  const monthFilter = own ? view.month : null; // "YYYY-MM" or null
  const categoryFilter = own ? view.category : null; // category id, 'none', or null (D198)
  const page = own ? view.page : 0;
  const setFilters = (next) => setView({ cardId: selectedId, month: monthFilter, category: categoryFilter, page: 0, ...next });

  // The category bar's sums (the whole card, or the picked month), and the page of rows.
  const range = monthFilter ? monthBounds(monthFilter) : {};
  const summaryReq = useApi(
    selectedId == null ? null : `card-summary:${selectedId}:${monthFilter ?? ''}`,
    () => api.transactions.categorySummary({ account_id: selectedId, ...range }),
    { tags: ['transactions'] },
  );
  const rowsReq = useApi(
    selectedId == null ? null : `card-rows:${selectedId}:${monthFilter ?? ''}:${categoryFilter ?? ''}:${page}`,
    () => api.transactions.list({ account_id: selectedId, limit: PAGE_SIZE, offset: page * PAGE_SIZE, ...range, ...(categoryFilter != null ? { category_id: categoryFilter } : {}) }),
    { tags: ['transactions'] },
  );
  const summary = selectedId == null ? null : summaryReq.data ?? null;
  const data = selectedId == null ? null : rowsReq.data ?? null;
  const error = actionError ?? rowsReq.error ?? summaryReq.error;

  // A new month or category starts the table back on its first page.
  const pickMonth = (key) => setFilters({ month: key });
  const pickCategory = (key) => setFilters({ category: key });
  const setPage = (n) => setFilters({ page: n });
  const selectCard = (id) => setPickedId(id);

  const recategorize = async (transaction, value) => {
    const categoryId = value === '' ? null : Number(value);
    try {
      await api.transactions.update(transaction.id, { category_id: categoryId });
      rowsReq.setData((d) => ({
        ...d,
        rows: d.rows.map((r) =>
          r.id === transaction.id
            ? { ...r, category_id: categoryId, category_name: categories.find((c) => c.id === categoryId)?.name ?? null }
            : r
        ),
      }));
      summaryReq.reload();
      setActionError(null);
    } catch (err) {
      setActionError(err.message);
    }
  };

  const rename = async (transaction, merchant) => {
    try {
      await api.transactions.update(transaction.id, { merchant });
      rowsReq.setData((d) => ({ ...d, rows: d.rows.map((r) => (r.id === transaction.id ? { ...r, merchant } : r)) }));
      setActionError(null);
    } catch (err) {
      setActionError(err.message);
    }
  };

  const selected = filteredAccounts.find((a) => a.id === selectedId);
  const total = data?.total ?? 0;

  return (
    <div>
      <header className="mb-6">
        <PageTitle className="text-2xl font-medium tracking-tight text-ink" emoji="💳" tint="bg-vivid-blue/15">Cards</PageTitle>
        <p className="mt-1 text-sm text-muted">Pick a card to see what's been on it.</p>
      </header>

      {accounts.length === 0 ? (
        <p className="text-sm text-muted">Add an account in Settings to see it here.</p>
      ) : (
        <>
          <div className="mb-6 flex flex-col gap-10 lg:flex-row lg:items-stretch">
            {/* Left half: small filters on top, the carousel below —
                same shape as the Statements page's deck column. */}
            <div className="flex flex-col lg:w-1/2">
              <div className="mb-6 flex justify-center">
                <AccountFilterBar
                  size="md"
                  typeFilter={typeFilter} onTypeFilter={setTypeFilter}
                  personFilter={personFilter} onPersonFilter={setPersonFilter}
                  personOptions={personOptions}
                />
              </div>

              {filteredAccounts.length === 0 && (
                <p className="mb-6 text-center text-sm text-muted">No cards match this filter.</p>
              )}

              <div className="flex flex-1 items-center justify-center">
                <CardCarousel
                  accounts={filteredAccounts}
                  selectedId={selectedId}
                  onSelect={selectCard}
                  onChanged={onAccountsChanged}
                />
              </div>
            </div>

            {/* Right half: the compact statement calendar. */}
            <div className="flex flex-col items-center text-center lg:w-1/2 lg:pt-2">
              {selected && <StatementCalendar accountId={selected.id} onMonthClick={pickMonth} />}
            </div>
          </div>

          {selected && (
            <div className="mb-4 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm text-muted">
              <span>
                {selected.name}
                {selected.mask && <span className="font-mono tnum"> ···{selected.mask}</span>}
                {' · '}
                <span className="tnum">{total}</span> transaction{total === 1 ? '' : 's'}
              </span>
              {monthFilter && (
                <span>
                  · Showing <span className="text-ink">{monthLabel(monthFilter)}</span>{' '}
                  <button
                    onClick={() => pickMonth(null)}
                    className="text-earn underline-offset-4 hover:underline"
                  >
                    Clear
                  </button>
                </span>
              )}
            </div>
          )}

          {error && <p className="mb-4 text-sm text-spend">{error}</p>}

          {selected && summary && summary.total.count > 0 && (
            <CardCategoryBar
              summary={summary}
              selected={categoryFilter}
              onSelect={pickCategory}
              accountType={selected.account_type}
              scopeLabel={monthFilter ? monthLabel(monthFilter) : 'All time'}
            />
          )}

          {data && total > 0 && (
            <DataTable
              fixed
              rows={data.rows}
              rowKey={(t) => t.id}
              attention={needsAttention}
              renderDetail={(t) => <TransactionDetail transaction={t} lookup={{ categories, accounts, people }} onChanged={() => { rowsReq.reload(); summaryReq.reload(); }} edit={{ categories, onRecategorize: recategorize }} />}
              columns={transactionColumns({
                categories,
                onRename: rename,
                onRecategorize: recategorize,
                onOpenMerchant: setHistoryMerchant,
                show: ['date', 'merchant', 'category', 'amount'],
                showDescription: false,
              })}
            />
          )}

          {data && total === 0 && (
            <p className="py-10 text-center text-sm text-muted">
              {categoryFilter != null
                ? 'Nothing in this category here.'
                : monthFilter
                ? `0 transactions in ${monthLabel(monthFilter)} — the statement's on file, this card just wasn't used that month.`
                : 'Nothing on this card yet.'}
            </p>
          )}

          {total > PAGE_SIZE && (
            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="text-faint tnum">
                {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage(page - 1)}
                  disabled={page === 0}
                  className="rounded-md border border-rule px-3 py-1.5 text-ink transition-colors hover:bg-band disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Newer
                </button>
                <button
                  onClick={() => setPage(page + 1)}
                  disabled={(page + 1) * PAGE_SIZE >= total}
                  className="rounded-md border border-rule px-3 py-1.5 text-ink transition-colors hover:bg-band disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Older
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {historyMerchant && (
        <MerchantHistory merchant={historyMerchant} onClose={() => setHistoryMerchant(null)} />
      )}
    </div>
  );
}
