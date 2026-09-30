import { formatMoney, formatShortDate } from '../api';
import { MiniTrend } from './MiniTrend';
import { DetailDialog, ShowMore, BarRow } from './ui/DetailDialog';

/**
 * The drill-down behind the smaller cards under Income/Spent/Loans/
 * Savings (Cashback & Interest, Fees & Interest, To India) — one
 * shared shell instead of a near-identical file per card, since
 * they're all a single household-wide figure with no per-person
 * split, same as Savings. Same "this month / year so far with a
 * trend" header those cards already settled on, now followed by two
 * real breakdowns instead of just the sparkline: which months it
 * actually happened in, and which account it came from — asked for
 * directly ("expand the data where it is coming from, month wise,
 * which card"), both computed server-side in routes/summary.js
 * (`secondary_by_month`, `secondary_by_account`) rather than derived
 * here, same as everywhere else real money in this app is a query
 * result, not a client-side guess.
 *
 * `breakdown` names the sources inside a combined card — Cashback &
 * Interest is three (the issuer's own printed reward, a household-
 * curated "Statement credits" tier, and real interest earned); Fees &
 * Interest is two (fees, interest charged). See routes/summary.js for
 * why folding Interest Earned/Charged into these two was legitimate
 * rather than the "don't calculate cashback" rule this might
 * otherwise look like it's bending.
 *
 * `transactions`, when passed, adds a third list below the month/
 * account grid — the real rows behind the total, not just a rollup.
 * Only Fees & Interest uses it today (asked for directly, "as much
 * detail as possible, where the amount came from") — real data only
 * ever produces a handful of these, so a full itemized list is
 * genuinely readable there in a way it wouldn't be for, say, Cashback.
 */

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (iso) => {
  const [y, m] = iso.split('-').map(Number);
  return `${MONTH_ABBR[m - 1]} ${y}`;
};

export function SecondaryDetail({
  title, emoji, tint, month, year, total, yearToDate, byMonth, byAccount, valueKey, description, breakdown, transactions, onClose,
}) {
  const signed = (c) => `${c < 0 ? '−' : ''}${formatMoney(Math.abs(c))}`;
  const toneOf = (c) => (c < 0 ? 'spend' : 'earn');

  // Newest month first: the month someone opened this from is the one they care about.
  const monthRows = byMonth
    .filter((m) => m[valueKey] !== 0)
    .map((m) => ({ key: m.month, label: monthLabel(m.month), amount: m[valueKey] }))
    .reverse();
  const accountRows = (byAccount ?? [])
    .filter((a) => a[valueKey] !== 0)
    .sort((a, b) => Math.abs(b[valueKey]) - Math.abs(a[valueKey]))
    .map((a) => ({ key: a.account_id, label: a.account_name, amount: a[valueKey] }));
  const sources = (breakdown ?? []).filter((b) => b.amount !== 0);

  const bars = (rows) => {
    const max = Math.max(1, ...rows.map((r) => Math.abs(r.amount)));
    return (
      <ShowMore
        items={rows}
        limit={6}
        className="flex flex-col gap-2.5"
        render={(r) => <BarRow key={r.key} label={r.label} amount={r.amount} max={max} formatted={signed(r.amount)} tone={toneOf(r.amount)} />}
      />
    );
  };

  return (
    <DetailDialog
      title={`${title} in ${month}`}
      emoji={emoji}
      tint={tint}
      hero={{ label: 'This month', value: signed(total), tone: toneOf(total) }}
      side={{
        label: `${year} so far`,
        value: signed(yearToDate),
        tone: yearToDate < 0 ? 'spend' : 'ink',
        trend: <MiniTrend months={byMonth} valueKey={valueKey} tone={yearToDate < 0 ? 'spend' : 'earn'} />,
      }}
      sections={[
        sources.length > 0 && { key: 'sources', label: `${year} by source`, tab: 'Sources', count: sources.length, content: bars(sources.map((b) => ({ key: b.label, ...b }))) },
        { key: 'months', label: `${year} by month`, tab: 'By month', count: monthRows.length, content: monthRows.length ? bars(monthRows) : <Empty>Nothing yet this year.</Empty> },
        { key: 'accounts', label: 'By account', count: accountRows.length, content: accountRows.length ? bars(accountRows) : <Empty>No account breakdown yet.</Empty> },
        transactions?.length > 0 && {
          key: 'transactions',
          label: 'Transactions',
          count: transactions.length,
          content: (
            <ShowMore
              items={transactions}
              limit={8}
              className="divide-y divide-rule"
              render={(tx) => (
                <div key={tx.id} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <span className="text-ink">{tx.description || tx.merchant || 'Uncategorized'}</span>
                    <span className="ml-2 text-faint">{formatShortDate(tx.posted_date)}</span>
                    <div className="truncate text-xs text-faint">{tx.account_name}</div>
                  </div>
                  <span className={`shrink-0 font-mono tnum ${tx.amount_cents < 0 ? 'text-spend' : 'text-earn'}`}>{formatMoney(tx.amount_cents)}</span>
                </div>
              )}
            />
          ),
        },
      ]}
      note={description}
      width="max-w-xl"
      onClose={onClose}
    />
  );
}

function Empty({ children }) {
  return <p className="text-sm text-faint">{children}</p>;
}
