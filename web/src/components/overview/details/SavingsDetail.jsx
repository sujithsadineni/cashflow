import { useState } from 'react';
import { api, formatMoney, formatShortDate, dollarsToCents, maskName } from '../../../api';
import { Button } from '../../ui/Form';
import { DetailDialog } from '../../ui/DetailDialog';
import { YearSwitch, MonthBars, Comparison, Explorer } from './MoneyExplorer';
import { MONTHS, NO_FILTER } from '../../../lib/overview/explorer';
import { useApi } from '../../../hooks/use-api';
import { ACCOUNT_TYPE_CHOICES, personChoices } from '../../../lib/categories/dropdown-choices';
import { Dropdown } from '../../ui/Dropdown';
import { useNotify } from '../../../hooks/use-notify';
import { Loading } from '../../ui/Loading';

/**
 * The Savings card's drill-down, on the shared year explorer (D295) like
 * Cashback, Fees and Investment: a year switch, the twelve months, the year
 * before, and kind and account tiles over the transactions behind it.
 *
 * The Savings figure is a derived flow, not an account balance: income
 * minus spend minus real debt repayment (see routes/summary.js). Income,
 * Spending and Loan payments are the rows that make it; the rest are the
 * flows it leaves out (moves to savings, borrowed money, card bills…),
 * shown in ink as their effect on the account change, never added in.
 *
 * A month can go negative — spending more than came in, or a real
 * debt payment outweighing it — and this shows that as a plain
 * negative number rather than flooring at zero, per explicit
 * instruction: the household wants to see it coming once a
 * balance-transfer loan's payments start pulling the total down. So the
 * bars and the year before are signed, not sized.
 *
 * Kept from the tabbed version (D294): "How it moved" for the picked month
 * or the year, and the account balances with their audited edits.
 */

const signed = (cents) => `${cents < 0 ? '−' : cents > 0 ? '+' : ''}${formatMoney(Math.abs(cents))}`;

/**
 * Where it went (D179): how much the accounts in the app changed, plus
 * the flows Savings leaves out (moves to savings, borrowed money,
 * transfers, …). The lines add up to the Savings figure exactly. That's
 * what makes "+$15,600 moved to Apple Savings" an answer to "why
 * doesn't my bank balance show what I saved?".
 */
// The local date, not UTC's: in the evening UTC is already tomorrow.
const today = () => new Date().toLocaleDateString('en-CA');
const COMPACT = '!min-w-32 !px-2 !py-1 text-xs';
const SAVINGS_TYPES = ACCOUNT_TYPE_CHOICES.filter((t) => t.value === 'SAVINGS' || t.value === 'INVESTMENT');

/**
 * Track or update a destination's balance, inline (D180). For a move with
 * no account yet, it creates one (Savings, or Investment for a broker)
 * and records its first balance. For a tracked one, it records a new
 * balance as of today.
 */
function BalanceForm({ line, people, onSaved, onCancel }) {
  const notify = useNotify();
  const tracked = Boolean(line.account);
  const [amount, setAmount] = useState('');
  const [personId, setPersonId] = useState(String(people[0]?.id ?? ''));
  const [type, setType] = useState(/robinhood|fidelity|vanguard|schwab|etrade|webull/i.test(line.destination ?? '') ? 'INVESTMENT' : 'SAVINGS');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const cents = dollarsToCents(amount);
    if (Number.isNaN(cents)) return setError('Enter the balance, like 21,340.50');
    setBusy(true);
    setError(null);
    try {
      let accountId = line.account?.id;
      if (!tracked) {
        const name = line.destination.replace(/\s+(Money|Gs)\b/gi, '').trim() + (type === 'SAVINGS' ? ' Savings' : '');
        const created = await api.accounts.create({ person_id: Number(personId), name, issuer: line.destination.split(/\s+/)[0], account_type: type });
        accountId = created.id;
      }
      await api.recordBalance(accountId, { as_of: today(), balance_cents: cents });
      onSaved();
      notify(maskName(line.account?.name ?? line.destination), { name: 'account.balance' });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="mt-1.5 mb-1 flex flex-wrap items-center gap-2 rounded-md bg-band/60 p-2 text-xs">
      {!tracked && (
        <>
          <Dropdown value={type} onChange={setType} options={SAVINGS_TYPES} aria-label="Account type" className={COMPACT} />
          <Dropdown value={personId} onChange={setPersonId} options={personChoices(people)} aria-label="Whose account" className={COMPACT} />
        </>
      )}
      <input
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && save()}
        inputMode="decimal"
        placeholder="Balance today"
        aria-label="Balance today"
        className="w-32 rounded-md border border-rule bg-raised px-2 py-1 font-mono text-sm tnum text-ink focus:border-info focus:outline-none"
      />
      <Button size="sm" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
      <button onClick={onCancel} className="text-muted hover:text-ink">Cancel</button>
      {error && <span className="w-full text-spend">{error}</span>}
    </div>
  );
}

function SavingsBalances({ accounts, people, onChanged }) {
  const [editing, setEditing] = useState(null);
  if (!accounts) return <p className="text-sm text-muted">Loading balances…</p>;
  if (accounts.length === 0) {
    return <p className="text-sm text-muted">No savings or investment accounts are tracked yet.</p>;
  }

  const recorded = accounts.filter((account) => account.balance_cents != null);
  const knownTotal = recorded.reduce((sum, account) => sum + account.balance_cents, 0);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3 border-b border-rule pb-3">
        <div>
          <p className="text-xs text-muted">Known balance total</p>
          <p className="font-mono text-xl font-semibold tnum text-ink">
            {recorded.length > 0 ? formatMoney(knownTotal) : 'Not recorded'}
          </p>
        </div>
        <span className="text-right text-xs text-muted tnum">
          {recorded.length} of {accounts.length} balances recorded
        </span>
      </div>
      <p className="mb-2 text-xs text-faint">Latest statement or hand-entered balance. No holdings or returns.</p>
      <ul className="divide-y divide-rule">
        {accounts.map((account) => (
          <li key={account.id} className="py-2.5">
            <div className="flex min-w-0 items-center gap-3">
              <div className="min-w-0 flex-1">
                <span className="block truncate text-sm text-ink">{maskName(account.name)}</span>
                <span className="block text-xs text-muted">
                  {account.account_type === 'INVESTMENT' ? 'Investment' : 'Savings'}
                  {account.as_of && <> · as of <span className="tnum">{formatShortDate(account.as_of)}</span></>}
                </span>
              </div>
              <div className="shrink-0 text-right">
                {account.balance_cents == null
                  ? <span className="text-xs text-faint">No balance recorded</span>
                  : <span className="font-mono text-sm tnum text-ink">{formatMoney(account.balance_cents)}</span>}
                <button
                  type="button"
                  onClick={() => setEditing(editing === account.id ? null : account.id)}
                  aria-expanded={editing === account.id}
                  className="mt-0.5 block w-full text-right text-xs text-earn underline-offset-4 hover:underline"
                >
                  {account.balance_cents == null ? 'Add balance' : 'Update'}
                </button>
              </div>
            </div>
            {editing === account.id && (
              <BalanceForm
                line={{ key: account.id, account }}
                people={people}
                onCancel={() => setEditing(null)}
                onSaved={() => { setEditing(null); onChanged(); }}
              />
            )}
          </li>
        ))}
      </ul>
      {recorded.length < accounts.length && (
        <p className="mt-2 text-xs text-muted">
          The total is partial until every account has a balance.
        </p>
      )}
    </div>
  );
}

function WhereItWent({ breakdown, total, people, onChanged }) {
  const [editing, setEditing] = useState(null); // line key
  if (!breakdown) return <Loading />;
  const lines = [{ key: 'accounts', label: 'Change in your accounts in the app', cents: breakdown.accounts_change_cents }, ...breakdown.lines];
  const remainder = total - lines.reduce((s, l) => s + l.cents, 0); // only when refunds outweighed spend
  return (
    <div className="text-sm">
      {lines.map((l) => (
        <div key={l.key} className="border-b border-rule py-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-ink">{l.label}</span>
            <span className={`shrink-0 font-mono tnum ${l.cents < 0 ? 'text-spend' : 'text-earn'}`}>{signed(l.cents)}</span>
          </div>
          {(l.account || l.destination) && editing !== l.key && (
            <div className="mt-0.5 flex items-baseline justify-between gap-3 text-xs">
              {l.account
                ? <span className="text-muted">Tracked as {maskName(l.account.name)} in Balances.</span>
                : <span className="text-faint">This destination isn't tracked yet.</span>}
              {l.destination && (
                <button type="button" onClick={() => setEditing(l.key)} className="shrink-0 text-earn underline-offset-4 hover:underline">
                  Track it
                </button>
              )}
            </div>
          )}
          {editing === l.key && (
            <BalanceForm line={l} people={people} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} />
          )}
        </div>
      ))}
      {remainder !== 0 && (
        <div className="flex items-baseline justify-between gap-3 border-b border-rule py-1.5">
          <span className="text-muted">Refunds beyond spending (not counted)</span>
          <span className="font-mono tnum text-muted">{signed(remainder)}</span>
        </div>
      )}
      <div className="flex items-baseline justify-between gap-3 pt-2 font-medium">
        <span className="text-ink">Saved</span>
        <span className={`font-mono tnum ${total < 0 ? 'text-spend' : 'text-earn'}`}>{signed(total)}</span>
      </div>
    </div>
  );
}

// What makes the Savings figure; every other kind is a flow it leaves out.
const COUNTED = [
  { key: 'income', label: 'Income' },
  { key: 'spending', label: 'Spending' },
  { key: 'loan', label: 'Loan payments' },
];
const LEFT_OUT = ['borrowed', 'transfers', 'card_bills', 'earned', 'other'];

/** Counted kinds first, then moves to savings, then the rest, in the API's own words. */
function kindsOf(labels = {}) {
  const moved = Object.keys(labels).filter((k) => k.startsWith('moved:'));
  return [...COUNTED, ...[...moved, ...LEFT_OUT].filter((k) => labels[k]).map((k) => ({ key: k, label: labels[k], ink: true }))];
}

/** A kind's effect on Savings (measure_cents); spending never comes out positive, as on the tile. */
function kindAmount(kind, rows) {
  const cents = rows.reduce((a, r) => a + r.measure_cents, 0);
  return kind === 'spending' ? Math.min(cents, 0) : cents;
}

export function SavingsDetail({ month, people = [], onAccountsChanged, onClose }) {
  const [year, setYear] = useState(Number(month.slice(0, 4)));
  const [filter, setFilter] = useState(NO_FILTER);
  const { data, reload } = useApi(`savings:${year}`, () => api.savings(year), { tags: ['transactions'] });
  // How it moved: the picked month, else the year to its last month so far.
  const asOf = filter.month ?? (data && `${year}-${String(data.through_month).padStart(2, '0')}`);
  const breakdownReq = useApi(asOf && `savings-breakdown:${asOf}`, () => api.savingsBreakdown(asOf), { tags: ['transactions'] });
  const breakdown = breakdownReq.data;

  const years = data?.years?.length ? data.years : [year];
  const pickYear = (y) => { setYear(y); setFilter(NO_FILTER); };
  const toggle = (key, value) => setFilter((f) => ({ ...f, [key]: f[key] === value ? null : value }));
  const changed = () => { breakdownReq.reload(); reload(); onAccountsChanged?.(); };
  const kinds = kindsOf(data?.kind_labels);

  const picked = filter.month && data?.months.find((m) => m.month === filter.month);
  const movedTotal = picked ? picked.total : data?.total_cents;
  const movedLabel = picked ? `How ${MONTHS[Number(filter.month.slice(5)) - 1]} ${year} moved` : `How ${year} moved`;
  const recorded = breakdown?.accounts.filter((a) => a.balance_cents != null) ?? [];
  const known = recorded.reduce((sum, a) => sum + a.balance_cents, 0);

  const howItMoved = breakdownReq.error ? (
    <div className="flex items-center justify-between gap-3 rounded-md bg-band px-3 py-2 text-sm">
      <span className="min-w-0 text-spend">Couldn’t load savings details: {breakdownReq.error}</span>
      <button type="button" onClick={breakdownReq.reload} className="shrink-0 text-ink underline-offset-4 hover:underline">Retry</button>
    </div>
  ) : breakdownReq.loading
    ? <Loading />
    : <WhereItWent breakdown={picked ? breakdown?.month : breakdown?.year_to_date} total={movedTotal} people={people} onChanged={changed} />;

  return (
    <DetailDialog
      title="Savings"
      emoji="📈"
      tint="bg-vivid-purple/10"
      actions={years.length > 1 && <YearSwitch years={years} year={year} onChange={pickYear} />}
      hero={data && { label: data.through_month < 12 ? `Saved, ${year} so far` : `Saved in ${year}`, value: signed(data.total_cents), tone: data.total_cents < 0 ? 'spend' : 'earn' }}
      side={recorded.length > 0 && {
        label: recorded.length < breakdown.accounts.length ? `Balances on file · ${recorded.length} of ${breakdown.accounts.length}` : 'Balances on file',
        value: formatMoney(known),
        tone: 'ink',
      }}
      sections={[
        {
          key: 'explore',
          label: 'Month by month',
          content: data ? (
            <>
              <MonthBars months={data.months} through={data.through_month} kinds={kinds} signed picked={filter.month} onPick={(m) => toggle('month', m)} empty="Nothing saved or spent this year." />
              <Comparison data={data} verb="had saved" signed />
              <div className="mt-6 mb-2 text-xs font-medium text-faint">{movedLabel}</div>
              {howItMoved}
              <Explorer
                data={data}
                kinds={kinds}
                kindAmount={kindAmount}
                filter={filter}
                toggle={toggle}
                clear={() => setFilter(NO_FILTER)}
                onClose={onClose}
                noun={['transaction', 'transactions']}
              />
            </>
          ) : <Loading />,
        },
        {
          key: 'balances',
          tab: 'Balances',
          label: 'Current account balances',
          content: breakdown
            ? <SavingsBalances accounts={breakdown.accounts} people={people} onChanged={changed} />
            : <p className="text-sm text-muted">Loading balances…</p>,
        },
      ]}
      note="Savings is income minus spending and real loan payments. The other kinds are money that moved without being saved or spent, shown as their effect on your accounts. Account balances are separate snapshots, not holdings or returns."
      width="max-w-4xl"
      onClose={onClose}
    />
  );
}
