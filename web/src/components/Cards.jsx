import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { CardCarousel } from './CardCarousel';
import { StatementCalendar } from './StatementCalendar';
import { PageTitle } from './Form';
import { MerchantHistory } from './MerchantHistory';
import { DataTable } from './ui/DataTable';
import { TransactionDetail } from './transactions/TransactionDetail';
import { transactionColumns } from './transactions/columns';
import { useAccountFilters, AccountFilterBar } from './AccountFilters';

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
  const [selectedId, setSelectedId] = useState(null);
  const [monthFilter, setMonthFilter] = useState(null); // "YYYY-MM" or null
  const [data, setData] = useState(null);
  const [page, setPage] = useState(0);
  const [error, setError] = useState(null);
  const [historyMerchant, setHistoryMerchant] = useState(null);

  const {
    typeFilter, setTypeFilter,
    personFilter, setPersonFilter,
    personOptions,
    filteredAccounts,
  } = useAccountFilters(accounts, people);

  // A card that's selected when a filter hides it falls back to the
  // first card the filter still shows, same as the Statements deck
  // dropping back to "pick a card" — there's just always a card
  // selected here instead, since this page has no unselected state.
  useEffect(() => {
    if (filteredAccounts.length === 0) {
      if (selectedId !== null) setSelectedId(null);
    } else if (selectedId === null || !filteredAccounts.some((a) => a.id === selectedId)) {
      setSelectedId(filteredAccounts[0].id);
    }
  }, [filteredAccounts, selectedId]);

  // Switching cards drops any month picked on the previous one —
  // otherwise "April" from the last card would silently narrow the
  // next one's table too, with no visible reason why it's empty.
  useEffect(() => {
    setMonthFilter(null);
    setPage(0);
  }, [selectedId]);

  const load = useCallback(async () => {
    if (selectedId === null) {
      setData(null);
      return;
    }
    try {
      const filters = { account_id: selectedId, limit: PAGE_SIZE, offset: page * PAGE_SIZE };
      if (monthFilter) Object.assign(filters, monthBounds(monthFilter));
      setData(await api.transactions.list(filters));
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, [selectedId, page, monthFilter]);

  useEffect(() => { load(); }, [load]);

  const selectCard = (id) => {
    setSelectedId(id);
    setPage(0);
  };

  const recategorize = async (transaction, value) => {
    const categoryId = value === '' ? null : Number(value);
    try {
      await api.transactions.update(transaction.id, { category_id: categoryId });
      setData({
        ...data,
        rows: data.rows.map((r) =>
          r.id === transaction.id
            ? { ...r, category_id: categoryId, category_name: categories.find((c) => c.id === categoryId)?.name ?? null }
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
      setData({ ...data, rows: data.rows.map((r) => (r.id === transaction.id ? { ...r, merchant } : r)) });
    } catch (err) {
      setError(err.message);
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
              {selected && <StatementCalendar accountId={selected.id} onMonthClick={setMonthFilter} />}
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
                    onClick={() => setMonthFilter(null)}
                    className="text-earn underline-offset-4 hover:underline"
                  >
                    Clear
                  </button>
                </span>
              )}
            </div>
          )}

          {error && <p className="mb-4 text-sm text-spend">{error}</p>}

          {data && total > 0 && (
            <DataTable
              fixed
              rows={data.rows}
              rowKey={(t) => t.id}
              renderDetail={(t) => <TransactionDetail transaction={t} lookup={{ categories, accounts, people }} />}
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
              {monthFilter
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
