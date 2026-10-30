import { useState } from 'react';
import { api, formatMoney, formatShortDate } from '../../../api';
import { useApi, invalidate } from '../../../hooks/use-api';
import { useNotify } from '../../../hooks/use-notify';
import { aprText, earnedLine } from '../../../lib/cards/utilisation';
import { activePlans, loanFromPlan } from '../../../lib/cards/plans';
import { GroupBlock, GroupRow } from '../apple/grouped';

/**
 * What a card's newest statement printed (D354): its credit line, rates,
 * the year's fees and interest, and what it earned. Shown, not edited (a
 * value read off a statement isn't a field: D297); the limit the household
 * sets lives in Billing above. Rows the statement didn't print are left out.
 */
export function StatementFactsGroup({ account }) {
  const req = useApi(`statement-facts:${account.id}:`, () => api.accounts.statementFacts(account.id), { tags: ['imports'] });
  const notify = useNotify();
  const [added, setAdded] = useState(() => new Set());
  const s = req.data?.statement;
  if (!s) return null;
  // A plan still being paid can become a loan, by hand, one click (D356).
  const addToLoans = async (plan) => {
    try {
      await api.loans.create(loanFromPlan(plan, account));
      setAdded((x) => new Set(x).add(`${plan.created_on}|${plan.description}`));
      invalidate('loans');
      notify(plan.description, { name: 'loan.from_statement', action: { label: 'Loans', to: '/settings?tab=loans' } });
    } catch (err) {
      notify(err.message, { name: 'error.add' });
    }
  };
  const plans = activePlans(s.plans);
  const money = (c) => (c == null ? null : formatMoney(Number(c)));
  const rows = [
    ['Credit limit', money(s.credit_limit_cents)],
    ['Available', money(s.available_credit_cents)],
    ['Cash advance limit', money(s.cash_advance_limit_cents)],
    ['Purchase APR', s.apr_purchase_bps == null ? null : `${aprText(s.apr_purchase_bps)}${s.apr_variable ? ' · variable' : ''}`],
    ['Balance transfer APR', aprText(s.apr_balance_transfer_bps)],
    ['Cash advance APR', aprText(s.apr_cash_advance_bps)],
    ['Penalty APR', aprText(s.apr_penalty_bps)],
    [s.ytd_year ? `Fees in ${s.ytd_year}` : 'Fees this year', money(s.ytd_fees_cents)],
    [s.ytd_year ? `Interest in ${s.ytd_year}` : 'Interest this year', money(s.ytd_interest_cents)],
    ['Rewards', earnedLine(s, (c) => formatMoney(c))],
    // The opening date it prints (D393): months before it read as before the account on Import and Cards.
    ['Member since', s.member_since ? `${formatShortDate(s.member_since)}, ${s.member_since.slice(0, 4)}` : null],
  ].filter(([, v]) => v != null);
  if (rows.length === 0 && plans.length === 0) return null;
  return (
    <GroupBlock header="From its statements" footer={`As printed on the statement closing ${formatShortDate(s.period_end)}, ${s.period_end.slice(0, 4)}. Cards shows any month's.`}>
      {rows.map(([label, value]) => (
        <GroupRow key={label} label={label}><span className="truncate text-ink tnum">{value}</span></GroupRow>
      ))}
      {plans.map((p) => {
        const key = `${p.created_on}|${p.description}`;
        return (
          <GroupRow key={key} label={`Plan · ${p.description}`}>
            <span className="truncate tnum">{formatMoney(p.remaining_cents)} left · {formatMoney(p.payment_due_cents)} a month</span>
            <button type="button" disabled={added.has(key)} onClick={() => addToLoans(p)}
              className="shrink-0 rounded-md px-1 text-[13px] text-info transition-opacity hover:opacity-80 disabled:text-faint">
              {added.has(key) ? 'Added' : 'Add to Loans'}
            </button>
          </GroupRow>
        );
      })}
    </GroupBlock>
  );
}
