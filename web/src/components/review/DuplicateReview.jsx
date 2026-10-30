import { useState } from 'react';
import { api, formatMoney, formatShortDate } from '../../api';
import { invalidate } from '../../hooks/use-api';
import { useNotify } from '../../hooks/use-notify';
import { useConfirm } from '../../hooks/use-confirm';
import { useDuplicates } from '../../hooks/use-duplicates';
import { MerchantAvatar } from '../ui/MerchantAvatar';
import { Button } from '../ui/Form';

/**
 * Review → Duplicates (D328, D329): the same amount on the same card within
 * three days, on two different statements. Each pair carries a score from
 * the evidence: is each copy printed on its own statement's PDF, and does
 * its statement add up with it or only without it. Both copies are shown
 * with their checks; "Remove this copy" appears only when the evidence
 * names a copy, never one its statement needs. Two rows on one statement
 * are never listed (the bank printed both), so the same purchase made twice
 * for a 5%-back offer never shows here.
 */

// formatShortDate is "Jan 6" (masked in privacy mode); the year matters when
// a statement reprints an older row, so it's added unless the date is masked.
const withYear = (iso) => {
  const s = formatShortDate(iso);
  return iso && !s.startsWith('*') ? `${s}, ${iso.slice(0, 4)}` : s;
};

const VERDICT = {
  duplicate: (p) => `${p.score}% sure it's a duplicate`,
  unsure: (p) => `${p.score}%: the statements couldn't settle it`,
  real: () => 'Not a duplicate: each statement needs its copy',
};
// ok true is evidence the copy is real, false that it's extra, null neither.
const MARK = { true: '✓', false: '✗', null: '·' };

function Checks({ checks }) {
  return (
    <ul className="mt-1.5 space-y-0.5">
      {checks.map((c) => (
        <li key={c.text} className={`flex gap-1.5 text-[12px] ${c.ok === null ? 'text-muted' : 'text-ink'}`}>
          <span aria-hidden="true" className="w-3 shrink-0 text-center">{MARK[c.ok]}</span>
          <span>{c.text}</span>
        </li>
      ))}
    </ul>
  );
}

function Copy({ row, label, checks, tone }) {
  return (
    <div className={`min-w-0 rounded-md border px-3 py-2.5 ${tone === 'remove' ? 'border-spend/30' : 'border-rule'}`}>
      <p className="text-[12px] font-medium text-muted">{label}</p>
      <p className="mt-1 truncate text-[14px] text-ink" title={row.description}>{row.description}</p>
      <p className="mt-0.5 text-[12px] text-muted">
        <span className="tnum">{withYear(row.posted_date)}</span>
        {row.period_start && <> · from the {withYear(row.period_start)} – {withYear(row.period_end)} statement</>}
      </p>
      <Checks checks={checks} />
      {row.approved_anyway_at && <p className="mt-1 text-[12px] text-faint">Approved past the duplicate flag on {formatShortDate(row.approved_anyway_at.slice(0, 10))}</p>}
    </div>
  );
}

export function DuplicateReview() {
  const { data: pairs, error: loadError, setData } = useDuplicates();
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const notify = useNotify();
  const confirm = useConfirm();

  const answer = async (pair, action) => {
    const amount = formatMoney(pair.a.amount_cents, { showSign: true });
    const removed = pair.remove_id === pair.a_id ? pair.a : pair.b;
    if (action === 'remove' && !(await confirm({
      title: `Remove this copy of ${amount}?`,
      message: `The copy from the ${withYear(removed.period_start)} statement is deleted; the other stays. The audit log keeps the whole row.`,
      confirm: 'Remove copy',
      destructive: true,
    }))) return;
    const key = `${pair.a_id}:${pair.b_id}`;
    setBusy(key);
    setError(null);
    try {
      // Both answers name the copy kept and the other one; "both are real" keeps both.
      const other = pair.remove_id ?? (pair.keep_id === pair.a_id ? pair.b_id : pair.a_id);
      await api.duplicates[action === 'remove' ? 'remove' : 'bothReal'](pair.keep_id, other);
      setData((prev) => prev?.filter((p) => `${p.a_id}:${p.b_id}` !== key));
      notify(`${pair.a.description} · ${amount}`, { name: action === 'remove' ? 'review.duplicate_removed' : 'review.duplicate_kept' });
      invalidate('transactions', 'duplicates');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  if (loadError) return <p className="text-sm text-spend">{loadError}</p>;
  if (!pairs) return <p className="text-sm text-muted">Re-reading the statements…</p>;

  if (pairs.length === 0) {
    return (
      <div className="px-2 py-10 text-center">
        <p className="text-[17px] font-semibold text-ink">No duplicates</p>
        <p className="mx-auto mt-1 max-w-sm text-[14px] text-muted">
          The same amount on two statements a few days apart lands here, checked against both PDFs. Two rows on one statement are both real, so they never do.
        </p>
      </div>
    );
  }

  return (
    <>
      {error && <p className="mb-3 text-sm text-spend">{error}</p>}
      <ul className="divide-y divide-rule">
        {pairs.map((pair) => {
          const key = `${pair.a_id}:${pair.b_id}`;
          const sides = [pair.a, pair.b].map((row) => ({
            row,
            label: pair.remove_id == null ? 'Copy' : row.id === pair.remove_id ? 'Remove' : 'Keep',
            tone: row.id === pair.remove_id ? 'remove' : undefined,
          }));
          return (
            <li key={key} className="py-4">
              <div className="mb-2 flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <MerchantAvatar merchant={pair.a.merchant} description={pair.a.description} txnType={pair.a.txn_type} amountCents={pair.a.amount_cents} size={28} />
                  <div className="min-w-0">
                    <p className="truncate text-[15px] text-ink">
                      {pair.a.account_name}{pair.a.account_mask ? ` ··${pair.a.account_mask}` : ''}
                    </p>
                    <p className="text-[12px] text-muted">
                      <span className="tnum">{VERDICT[pair.verdict](pair)}</span>
                      {' · '}{pair.checks.pair.map((c) => c.text).join(' · ')}
                    </p>
                  </div>
                </div>
                <span className={`shrink-0 font-mono text-[15px] tnum ${pair.a.amount_cents < 0 ? 'text-spend' : 'text-earn'}`}>
                  {formatMoney(pair.a.amount_cents, { showSign: true })}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {sides.map((s) => <Copy key={s.row.id} row={s.row} label={s.label} tone={s.tone} checks={pair.checks[s.row.id] ?? []} />)}
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <Button variant={pair.remove_id == null ? 'primary' : 'quiet'} size="sm" disabled={busy === key} onClick={() => answer(pair, 'both')}>
                  Both are real
                </Button>
                {pair.remove_id != null && (
                  <Button size="sm" disabled={busy === key} onClick={() => answer(pair, 'remove')}>
                    Remove this copy
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
