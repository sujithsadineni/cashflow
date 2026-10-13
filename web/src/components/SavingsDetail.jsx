import { useEffect, useState } from 'react';
import { api, formatMoney, formatShortDate, dollarsToCents } from '../api';
import { Button } from './Form';
import { MiniTrend } from './MiniTrend';
import { DetailDialog, ShowMore, BarRow } from './ui/DetailDialog';
import { ACCOUNT_TYPE_CHOICES, personChoices } from '../dropdown-choices';
import { Dropdown } from './ui/Dropdown';
import { useNotify } from '../use-notify';

/**
 * The Savings card's drill-down — same minimal shape as Income and
 * Spend (D51/D54), not the year-browser this used to be (D46). That
 * dialog answered a question nobody asked twice; this one matches
 * what Income/Spend already settled on: this month, plus a running
 * total for the year with a trend alongside it.
 *
 * Savings is now derived, not tracked — income minus spend minus real
 * debt repayment (see the comment in routes/summary.js) — so there's
 * no separate ledger to browse and no per-account split to show
 * (household call: "let's do a single savings for now"). The old
 * SAVINGS-account / txn_type='savings' tagging this replaced is gone
 * from this dialog entirely; a month recalculates the instant a
 * statement is uploaded or a transaction is recategorized.
 *
 * A month can go negative — spending more than came in, or a real
 * debt payment outweighing it — and this shows that as a plain
 * negative number rather than flooring at zero, per explicit
 * instruction: the household wants to see it coming once a
 * balance-transfer loan's payments start pulling the total down.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
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
      notify(`Balance saved for ${line.account?.name ?? line.destination}`, { type: 'success' });
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
        className="w-32 rounded-md border border-rule bg-raised px-2 py-1 font-mono text-sm tnum text-ink focus:border-earn focus:outline-none"
      />
      <Button size="sm" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
      <button onClick={onCancel} className="text-muted hover:text-ink">Cancel</button>
      {error && <span className="w-full text-spend">{error}</span>}
    </div>
  );
}

function WhereItWent({ breakdown, total, people, onChanged }) {
  const [editing, setEditing] = useState(null); // line key
  if (!breakdown) return <p className="text-sm text-muted">Loading…</p>;
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
          {/* A savings move: where that money stands now, or a way to start tracking it. */}
          {(l.account || l.destination) && editing !== l.key && (
            <div className="mt-0.5 flex items-baseline justify-between gap-3 text-xs">
              {l.account?.balance_cents != null ? (
                <span className="text-muted">
                  {l.account.name}: <span className="font-mono tnum text-ink">{formatMoney(l.account.balance_cents)}</span> on{' '}
                  {formatShortDate(l.account.as_of)}
                </span>
              ) : (
                <span className="text-faint">{l.account ? `${l.account.name}: no balance yet` : "This account isn't in the app"}</span>
              )}
              <button onClick={() => setEditing(l.key)} className="shrink-0 text-earn underline-offset-4 hover:underline">
                {l.account ? 'Update balance' : 'Track it'}
              </button>
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

export function SavingsDetail({ month, monthKey, year, total, yearToDate, savingsByMonth, people = [], onAccountsChanged, onClose }) {
  const [breakdown, setBreakdown] = useState(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    api.savingsBreakdown(monthKey).then(setBreakdown).catch(() => setBreakdown(null));
  }, [monthKey, version]);
  const changed = () => { setVersion((v) => v + 1); onAccountsChanged?.(); };

  const max = Math.max(1, ...savingsByMonth.map((m) => Math.abs(m.savings_cents)));
  // Newest first: the month just picked is what someone opened this to see.
  const months = [...savingsByMonth].reverse();

  return (
    <DetailDialog
      title={`Saved in ${month}`}
      emoji="📈"
      tint="bg-vivid-purple/10"
      hero={{ label: 'This month', value: signed(total), tone: total < 0 ? 'spend' : 'earn' }}
      side={{
        label: `${year} so far`,
        value: signed(yearToDate),
        tone: yearToDate < 0 ? 'spend' : 'ink',
        trend: <MiniTrend months={savingsByMonth} valueKey="savings_cents" tone={yearToDate < 0 ? 'spend' : 'earn'} />,
      }}
      sections={[
        {
          key: 'where_year',
          tab: `${year} so far`,
          label: `Where ${year}'s savings went`,
          content: <WhereItWent breakdown={breakdown?.year_to_date} total={yearToDate} people={people} onChanged={changed} />,
        },
        {
          key: 'where_month',
          tab: month,
          label: `Where ${month}'s went`,
          content: <WhereItWent breakdown={breakdown?.month} total={total} people={people} onChanged={changed} />,
        },
        {
          key: 'months',
          tab: 'By month',
          label: `${year}, month by month`,
          content: (
            <ShowMore
              items={months}
              limit={6}
              render={(m) => (
                <BarRow
                  key={m.month}
                  label={`${MONTHS[Number(m.month.slice(5, 7)) - 1]} ${m.month.slice(0, 4)}`}
                  amount={m.savings_cents}
                  max={max}
                  formatted={signed(m.savings_cents)}
                  tone={m.savings_cents < 0 ? 'spend' : 'earn'}
                />
              )}
              className="flex flex-col gap-2.5"
            />
          ),
        },
      ]}
      note="Income minus spend, minus any real loan or debt payment that month — a single household total, not split by person or account."
      onClose={onClose}
    />
  );
}
