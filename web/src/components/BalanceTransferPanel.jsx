import { useState } from 'react';
import { api, formatMoney } from '../api';
import { useApi } from '../use-api';
import { useDesign } from '../use-design';
import { Button } from './Form';
import { aprText, longDate, paceOf, statusLine, warningSentences } from '../balance-transfer';
import { useNotify } from '../use-notify';

/**
 * A balance transfer, read off its card (D195): when 0% ends, what it
 * cost, what's owed and paid, the pace that clears it in time, and what
 * to watch. Every fact comes from GET /api/loans's `bt` (D193); this
 * only lays it out. Classic keeps to spend/earn; Vivid adds its emoji.
 */

const TONE = { spend: 'text-spend', earn: 'text-earn', muted: 'text-muted' };

/** The one-line status, for a loan row or card. */
export function BalanceTransferStatus({ bt, className = '' }) {
  const vivid = useDesign().design === 'vivid';
  const { text, tone } = statusLine(bt);
  return <div className={`text-xs ${TONE[tone]} ${className}`}>{vivid && tone === 'spend' ? '⚠️ ' : ''}{text}</div>;
}

const renderParts = (parts) =>
  parts.map((p, i) => (typeof p === 'string' ? p : <span key={i} className="font-mono tnum">{formatMoney(p.cents)}</span>));

function Figure({ label, cents, tone = 'ink', sub }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className={`font-mono tnum ${tone === 'ink' ? 'text-ink' : TONE[tone]}`}>{cents != null ? formatMoney(cents) : '—'}</div>
      {sub && <div className="text-xs text-faint">{sub}</div>}
    </div>
  );
}

export function BalanceTransferPanel({ loan }) {
  const vivid = useDesign().design === 'vivid';
  const bt = loan.bt;
  const pace = paceOf(bt);
  const warnings = warningSentences(bt);

  return (
    <div className="space-y-5">
      <BalanceTransferStatus bt={bt} className="text-sm" />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Figure label="Transferred" cents={bt.transferred_cents || null} sub={bt.since ? longDate(bt.since) : null} />
        <Figure label="Transfer fee" cents={bt.fees_cents} tone="spend" />
        <Figure label="Paid on the card since" cents={bt.paid_cents} tone="earn" />
        <Figure label="Owed now" cents={bt.balance_cents} tone="spend" sub={bt.balance_as_of ? `${longDate(bt.balance_as_of)} statement` : 'entered by hand'} />
      </div>

      {pace && (
        <div className="border-t border-rule pt-4">
          <p className="text-sm text-ink">
            {vivid ? '🎯 ' : ''}About <span className="font-mono tnum">{formatMoney(pace.needed_cents)}</span> a month
            {pace.months > 0 ? ` for ${pace.months} payment${pace.months === 1 ? '' : 's'}` : ''} clears it by {longDate(pace.by)}.
          </p>
          {pace.pace && (
            <p className={`mt-1 text-sm ${pace.pace === 'on_track' ? 'text-earn' : 'text-spend'}`}>
              {pace.pace === 'on_track' ? 'On track' : 'Behind'}: the latest statement shows{' '}
              <span className="font-mono tnum">{formatMoney(pace.paid_cents)}</span> paid.
            </p>
          )}
          {!pace.pace && <p className="mt-1 text-xs text-faint">The pace shows once a full statement has passed since the transfer.</p>}
        </div>
      )}

      {bt.promos.length > 0 && (
        <div className="border-t border-rule pt-4">
          <div className="mb-2 text-xs text-muted">From the card’s statement</div>
          <ul className="divide-y divide-rule text-sm">
            {bt.promos.map((p, i) => (
              <li key={`${p.end_date}-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-1.5">
                <span className="text-ink">
                  {p.label}
                  {p.offer_id && <span className="ml-1.5 text-xs text-faint">{p.offer_id}</span>}
                </span>
                <span className="text-muted tnum">
                  {aprText(p.apr_bps)} until {longDate(p.end_date)}
                  {p.standard_apr_bps != null && <>, then {aprText(p.standard_apr_bps)}</>}
                </span>
              </li>
            ))}
          </ul>
          {bt.end_source === 'manual' && <p className="mt-1 text-xs text-faint">End date typed in by hand; the statement didn’t print one.</p>}
        </div>
      )}

      {warnings.length > 0 && (
        <ul className="space-y-2 border-t border-rule pt-4 text-sm">
          {warnings.map((w) => (
            <li key={w.kind} className={TONE[w.tone]}>
              {vivid ? (w.tone === 'spend' ? '⚠️ ' : '💡 ') : ''}
              {renderParts(w.parts)}
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-faint">
        Owed now is the whole card’s statement balance: fees and any purchases on the card are part of it. No issuer prints
        what’s left of one transfer on its own.
      </p>
    </div>
  );
}

/**
 * Cards carrying a balance transfer with no loan tracking it (D194).
 * One click adds the loan, prefilled from the statement; "Not a loan"
 * hides that suggestion for good.
 */
export function BalanceTransferSuggestions({ onAdded }) {
  const notify = useNotify();
  const vivid = useDesign().design === 'vivid';
  // Loaded with useApi (D211); it used to start the request during render.
  const req = useApi('loan-suggestions', () => api.loans.suggestions(), { tags: ['loans'] });
  const items = req.data ?? null;
  const setItems = req.setData;
  const [busy, setBusy] = useState(null);
  const [actionError, setError] = useState(null);
  const error = actionError ?? req.error;

  if (!items?.length && !error) return null;

  const track = async (s) => {
    setBusy(s.key);
    try {
      await api.loans.create({
        name: `${s.account_name} balance transfer`,
        lender: s.issuer ?? '',
        loan_type: 'balance_transfer',
        linked_account_id: s.account_id,
        start_date: s.draw_date ?? '',
        deadline_date: s.end_date ?? '',
        current_balance_cents: Math.max(s.balance_cents ?? s.draw_cents ?? 0, 0),
      });
      setItems(items.filter((x) => x.key !== s.key));
      onAdded?.();
      notify(`${s.account_name} balance transfer is now tracked`, { type: 'success', action: { label: 'Open Loans', to: '/settings?tab=loans' } });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const dismiss = async (s) => {
    setBusy(s.key);
    try {
      await api.loans.dismissSuggestion(s.key);
      setItems(items.filter((x) => x.key !== s.key));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mb-4 space-y-2">
      {error && <p className="text-sm text-spend">{error}</p>}
      {(items ?? []).map((s) => (
        <div key={s.key} className={`flex flex-wrap items-center justify-between gap-3 border border-rule p-3 ${vivid ? 'rounded-xl bg-vivid-amber/10' : 'bg-band'}`}>
          <p className="min-w-0 text-sm text-ink">
            {vivid ? '🔄 ' : ''}
            {s.account_name} has
            {s.draw_cents ? <> a <span className="font-mono tnum">{formatMoney(s.draw_cents)}</span> balance transfer</> : ' a balance transfer'}
            {s.end_date ? <>, {aprText(s.apr_bps ?? 0)} until {longDate(s.end_date)}</> : ''}. It isn’t tracked as a loan.
          </p>
          <div className="flex shrink-0 gap-2">
            <Button size="sm" onClick={() => track(s)} disabled={busy === s.key}>Track it</Button>
            <Button size="sm" variant="quiet" onClick={() => dismiss(s)} disabled={busy === s.key}>Not a loan</Button>
          </div>
        </div>
      ))}
    </div>
  );
}
