import { useState } from 'react';
import { formatMoney } from '../../../api';
import { aprText, longDate } from '../../../lib/loans/balance-transfer';
import { groupLoans, loanRowStatus } from '../../../lib/loans/loan-edit';
import { LOAN_TYPE_LABEL } from '../../../lib/loans/loan-types';
import { LoanCard } from './LoanCard';
import { MiniCard, ListRow, ListSection, ClosedFold } from '../apple/SplitList';
import { moveSelection } from '../apple/list-keys';

/**
 * The list side of Settings → Loans (D298), on the shared split-view rows:
 * balance transfers, then the other loans, each saying what's owed and its
 * clock ("74 days at 0%", amber when a 0% end is close), closed loans folded
 * at the bottom. Cards carrying a balance transfer no loan tracks yet
 * (D194), and payments that leave the bank for a lender every month (D419),
 * sit on top as suggestions: Track opens a new loan filled in from the
 * statement or the payments, to check before adding; Not a Loan hides it for good.
 */

/** A loan's mark: its card when it's on one, else its own matte card (D299). */
export function LoanMark({ loan, account }) {
  if (account) return <MiniCard account={account} />;
  return <LoanCard loan={loan} size="sm" />;
}

function Suggestion({ s, account, busy, onTrack, onDismiss }) {
  // A loan paid from the bank every month (D419), or a card's balance transfer (D194).
  const monthly = s.kind === 'installment';
  return (
    <li className="flex items-start gap-3 rounded-[10px] px-3 py-2.5">
      {account && !monthly ? <MiniCard account={account} /> : <LoanMark loan={{ loan_type: monthly ? s.loan_type : 'balance_transfer' }} />}
      <div className="min-w-0 flex-1">
        <p className="text-[15px] leading-snug text-ink">{monthly ? s.lender : s.account_name}</p>
        <p className="text-[13px] leading-snug text-muted">
          {monthly
            ? <><span className="tnum">{formatMoney(s.monthly_payment_cents)}</span> a month from {s.account_name}, <span className="tnum">{s.payments}</span> payments since {longDate(s.start_date)}</>
            : <>
              {s.draw_cents ? <><span className="tnum">{formatMoney(s.draw_cents)}</span> balance transfer</> : 'A balance transfer'}
              {s.end_date ? <>, {aprText(s.apr_bps ?? 0)} until {longDate(s.end_date)}</> : ''}
            </>}
        </p>
        <div className="mt-2 flex gap-2">
          <button type="button" onClick={() => onTrack(s)} disabled={busy}
            className="rounded-full bg-info/10 px-3 py-1 text-[13px] font-medium text-info transition-colors hover:bg-info/15 active:bg-info/20 disabled:opacity-40">
            Track
          </button>
          <button type="button" onClick={() => onDismiss(s)} disabled={busy}
            className="rounded-full px-3 py-1 text-[13px] text-muted transition-colors hover:bg-band hover:text-ink disabled:opacity-40">
            Not a Loan
          </button>
        </div>
      </div>
    </li>
  );
}

export function LoanList({ loans, closed, suggestions, accounts, selectedId, onSelect, onTrack, onDismiss, busyKey, today }) {
  const [opened, setShowClosed] = useState(false);
  // A closed loan that's selected keeps its section open.
  const showClosed = opened || closed.some((l) => l.id === selectedId);
  const accountOf = (l) => accounts.find((a) => a.id === l.linked_account_id) ?? null;
  const groups = groupLoans(loans);

  const rows = (list, isClosed = false) => list.map((l, i) => {
    const status = loanRowStatus(l, today);
    const account = accountOf(l);
    return (
      <ListRow
        key={l.id}
        id={l.id}
        selected={l.id === selectedId}
        afterSelected={i > 0 && list[i - 1].id === selectedId}
        onSelect={onSelect}
        leading={<LoanMark loan={l} account={account} />}
        title={l.name}
        subtitle={[l.lender || LOAN_TYPE_LABEL[l.loan_type], isClosed && 'Closed'].filter(Boolean).join(' · ')}
        dimmed={isClosed}
        trailing={(selected) => (
          <span className="shrink-0 text-right leading-snug">
            <span className={`block text-[15px] tnum ${selected ? 'text-white' : isClosed ? 'text-muted' : 'text-ink'}`}>{formatMoney(status.owedCents)}</span>
            {status.clock && (
              <span className={`block text-[13px] tnum ${selected ? 'text-white/80' : status.missed ? 'text-spend' : status.urgent ? 'text-warn' : 'text-muted'}`}>{status.clock}</span>
            )}
          </span>
        )}
      />
    );
  });

  return (
    <div onKeyDown={(e) => moveSelection(e, onSelect)} className="space-y-6">
      {suggestions.length > 0 && (
        <ListSection label="Not tracked yet">
          <ul>
            {suggestions.map((s) => (
              <Suggestion key={s.key} s={s} account={accounts.find((a) => a.id === s.account_id)} busy={busyKey === s.key} onTrack={onTrack} onDismiss={onDismiss} />
            ))}
          </ul>
        </ListSection>
      )}

      {groups.length === 0 && suggestions.length === 0 && (
        <p className="px-3 text-[13px] text-muted">
          No loans tracked yet. A car loan, a 0% balance transfer: anything owed that isn't in the regular ledger.
        </p>
      )}
      {groups.map((g) => (
        <ListSection key={g.key} label={`${g.label} · ${g.rows.length}`}>
          <ul>{rows(g.rows)}</ul>
        </ListSection>
      ))}

      <ClosedFold count={closed.length} open={showClosed} onToggle={() => setShowClosed(!opened)}>
        {rows(closed, true)}
      </ClosedFold>
    </div>
  );
}
