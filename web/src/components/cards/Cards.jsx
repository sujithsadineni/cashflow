import { useState } from 'react';
import { useApi } from '../../hooks/use-api';
import { api, formatMoney } from '../../api';
import { useNotify } from '../../hooks/use-notify';
import { txnName } from '../../lib/transactions/txn-name';
import { editedToast } from '../../lib/app/toast-words';
import { paidAfter, paidValue } from '../../lib/transactions/payment-methods';
import { CardCarousel } from './CardCarousel';
import { StatementCalendar } from './StatementCalendar';
import { dueLine } from '../../lib/cards/card-days';
import { PageTitle } from '../ui/Form';
import { MerchantHistory } from '../transactions/MerchantHistory';
import { DataTable } from '../ui/DataTable';
import { TransactionDetail } from '../transactions/TransactionDetail';
import { transactionColumns } from '../transactions/columns';
import { needsAttention } from '../../lib/transactions/payment-source';
import { AccountFilterBar } from '../ui/AccountFilters';
import { useAccountFilters } from '../../lib/cards/account-filters';
import { CardCategoryBar } from './CardCategoryBar';
import { backLimit } from '../../lib/cards/utilisation';
import { Pager } from '../ui/Pager';
import { useDesign } from '../../hooks/use-design';

const formatRate = (bps) => `${bps / 100}%`;

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
  const notify = useNotify();
  const { design } = useDesign();
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
  // Rows per page (D397: 10, 25, 50 or 100), kept as you move between cards.
  const [pageSize, setPageSize] = useState(25);
  const setFilters = (next) => setView({ cardId: selectedId, month: monthFilter, category: categoryFilter, page: 0, ...next });

  // The category bar's sums (the whole card, or the picked month), and the page of rows.
  const range = monthFilter ? monthBounds(monthFilter) : {};
  const summaryReq = useApi(
    selectedId == null ? null : `card-summary:${selectedId}:${monthFilter ?? ''}`,
    () => api.transactions.categorySummary({ account_id: selectedId, ...range }),
    { tags: ['transactions'] },
  );
  const rowsReq = useApi(
    selectedId == null ? null : `card-rows:${selectedId}:${monthFilter ?? ''}:${categoryFilter ?? ''}:${page}:${pageSize}`,
    () => api.transactions.list({ account_id: selectedId, limit: pageSize, offset: page * pageSize, ...range, ...(categoryFilter != null ? { category_id: categoryFilter } : {}) }),
    { tags: ['transactions'] },
  );
  const summary = selectedId == null ? null : summaryReq.data ?? null;
  const data = selectedId == null ? null : rowsReq.data ?? null;
  const error = actionError ?? rowsReq.error ?? summaryReq.error;

  // A new month or category starts the table back on its first page.
  const pickMonth = (key) => setFilters({ month: key });
  // The statement behind the picked month, or the newest (D347): the back of the card and its credit bar.
  // A bank account's back is its balance and what it earned instead (D355).
  const selectedIsCard = accounts.find((a) => a.id === selectedId)?.account_type === 'CREDIT_CARD';
  const factsReq = useApi(
    selectedId == null ? null : `${selectedIsCard ? 'statement' : 'bank'}-facts:${selectedId}:${monthFilter ?? ''}`,
    () => (selectedIsCard ? api.accounts.statementFacts(selectedId, monthFilter) : api.accounts.bankFacts(selectedId, monthFilter)),
    { tags: ['imports', 'transactions'] }
  );
  const factsData = factsReq.data ?? null;
  const limit = selectedIsCard ? backLimit(factsData) : { u: null };
  const pickCategory = (key) => setFilters({ category: key });
  const setPage = (n) => setFilters({ page: n });
  const selectCard = (id) => setPickedId(id);

  const recategorize = async (transaction, value, undoing = false) => {
    const categoryId = value === '' ? null : Number(value);
    try {
      await api.transactions.update(transaction.id, { category_id: categoryId });
      if (!undoing) {
        const { message, options } = editedToast(txnName(transaction) ?? transaction.description, 'category', categories.find((c) => c.id === categoryId)?.name ?? null,
          () => recategorize({ ...transaction, category_id: categoryId }, transaction.category_id == null ? '' : String(transaction.category_id), true));
        notify(message, options);
      }
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

  const rename = async (transaction, merchant, undoing = false) => {
    try {
      await api.transactions.update(transaction.id, { merchant });
      if (!undoing) {
        const { message, options } = editedToast(transaction.description, 'merchant', merchant || 'none', () => rename({ ...transaction, merchant }, transaction.merchant ?? '', true));
        notify(message, options);
      }
      rowsReq.setData((d) => ({ ...d, rows: d.rows.map((r) => (r.id === transaction.id ? { ...r, merchant } : r)) }));
      setActionError(null);
    } catch (err) {
      setActionError(err.message);
    }
  };

  // How it was paid (D359): '' goes back to what the statement says. Applies at once, with Undo.
  const repay = async (transaction, value, undoing = false) => {
    try {
      await api.transactions.update(transaction.id, { payment_method: value || null });
      const paid = paidAfter(transaction.paid_with, value);
      if (!undoing) {
        const { message, options } = editedToast(txnName(transaction) ?? transaction.description, 'payment_method', paid?.label ?? null,
          () => repay({ ...transaction, paid_with: paid }, paidValue(transaction.paid_with), true));
        notify(message, options);
      }
      rowsReq.setData((d) => ({ ...d, rows: d.rows.map((r) => (r.id === transaction.id ? { ...r, paid_with: paid } : r)) }));
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
                  facts={factsReq.loading ? undefined : factsData}
                  monthFilter={monthFilter}
                  accounts={filteredAccounts}
                  selectedId={selectedId}
                  onSelect={selectCard}
                  onChanged={onAccountsChanged}
                />
              </div>
            </div>

            {/* Right half: the compact statement calendar. */}
            <div className="flex flex-col items-center text-center lg:w-1/2 lg:pt-2">
              {selected && <StatementCalendar accountId={selected.id} openedOn={selected.member_since} onMonthClick={pickMonth} />}
            </div>
          </div>

          {/* One quiet row under the card (D348): which card, how many rows, the month picked, and
              pills for what to act on. The cycle and earlier cards live in Settings → Accounts; the
              statement's own figures are on the back of the card. */}
          {selected && (
            <div className="mb-6 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-sm text-muted">
              <span>
                <span className="text-ink">{selected.name}</span>
                {selected.mask && <span className="font-mono tnum"> ··{selected.mask}</span>}
                {' · '}
                <span className="tnum">{total}</span> transaction{total === 1 ? '' : 's'}
              </span>
              {monthFilter && (
                <button onClick={() => pickMonth(null)} aria-label={`Show every month, not just ${monthLabel(monthFilter)}`}
                  className="flex items-center gap-1.5 rounded-full bg-band px-2.5 py-0.5 text-[13px] text-ink transition-colors hover:bg-rule/60">
                  {monthLabel(monthFilter)} <span aria-hidden="true" className="text-muted">✕</span>
                </button>
              )}
              {dueLine(selected.payment_due) && (
                <span className={`rounded-full bg-band px-2.5 py-0.5 text-[13px] tnum ${{ spend: 'text-spend', earn: 'text-earn', warn: 'text-ink font-medium' }[dueLine(selected.payment_due).tone] ?? ''}`}>
                  {dueLine(selected.payment_due).text}
                </span>
              )}
              {limit.u && (
                <span title={limit.lastPrinted ? `This statement prints no limit, so this is ${limit.note}.` : 'Flip the card for its statement'}
                  className={`rounded-full bg-band px-2.5 py-0.5 text-[13px] tnum ${{ warn: 'text-warn', spend: 'text-spend' }[limit.u.tone] ?? 'text-muted'}`}>
                  <span className="font-medium">{limit.u.pct}%</span> of {limit.u.manual ? 'your ' : limit.lastPrinted ? 'last ' : ''}limit used
                </span>
              )}
              {/* A card with a flat rate (D330): what the rows listed earned. */}
              {selected.cashback_rate_bps && data && (
                <span className="rounded-full bg-band px-2.5 py-0.5 text-[13px] tnum">
                  {formatRate(selected.cashback_rate_bps)} back · <span className="font-mono text-earn">{formatMoney(data.cashback_cents ?? 0, { showSign: true })}</span>
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
                onRepay: repay,
                onOpenMerchant: setHistoryMerchant,
                show: ['date', 'merchant', 'paid', 'category', 'amount', ...(selected?.cashback_rate_bps ? ['cashback'] : [])],
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

          {/* The design's pager (D397); Classic keeps Newer and Older. */}
          {total > 10 && design !== 'classic' && (
            <div className="mt-5">
              <Pager page={page} total={total} pageSize={pageSize} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(0); }} />
            </div>
          )}
          {total > pageSize && design === 'classic' && (
            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="text-faint tnum">
                {page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} of {total}
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
                  disabled={(page + 1) * pageSize >= total}
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
