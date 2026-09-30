import { useEffect, useState } from 'react';
import { api, formatTimestamp, maskName } from '../../api';
import { describeAction, describeDetail } from '../../activity-format';

/**
 * What a transaction's ＋ opens (D145): the full line as the statement
 * printed it, where it sits, and its own change history — every edit
 * from audit_log, worded by the same activity-format.js the Activity
 * page uses, so an edit reads identically in both places. The history
 * loads when the panel opens, not for every row on the page.
 */
export function TransactionDetail({ transaction: t, lookup }) {
  const [history, setHistory] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api
      .activity(50, { entity: `transaction:${t.id}` })
      .then((rows) => !cancelled && setHistory(rows))
      .catch(() => !cancelled && setHistory([]));
    return () => {
      cancelled = true;
    };
  }, [t.id]);

  return (
    <div className="grid grid-cols-1 gap-5 text-sm md:grid-cols-2">
      <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1.5">
        <dt className="text-muted">On the statement</dt>
        <dd className="break-words font-mono text-xs text-ink">{t.description}</dd>
        <dt className="text-muted">Account</dt>
        <dd className="text-ink">
          {t.account_name}
          {t.account_mask && <span className="font-mono text-xs tnum text-muted"> ···{t.account_mask}</span>}
        </dd>
        <dt className="text-muted">Person</dt>
        <dd className="text-ink">{maskName(t.person_name)}</dd>
        {t.notes && (
          <>
            <dt className="text-muted">Notes</dt>
            <dd className="text-ink">{t.notes}</dd>
          </>
        )}
        <dt className="text-muted">Record</dt>
        <dd className="font-mono text-xs text-faint">#{t.id}</dd>
      </dl>

      <div>
        <div className="mb-1.5 text-xs font-medium text-muted">History</div>
        {history === null ? (
          <p className="text-xs text-faint">Loading…</p>
        ) : history.length === 0 ? (
          <p className="text-xs text-faint">Never edited — exactly as imported.</p>
        ) : (
          <ol className="flex flex-col gap-2 border-l-2 border-rule pl-3">
            {history.map((entry) => {
              const { emoji, label } = describeAction(entry.action);
              const { changes, legacyFields } = describeDetail(entry.detail, lookup);
              return (
                <li key={entry.id}>
                  <div className="text-xs text-faint">
                    <span aria-hidden="true">{emoji}</span> {label} · {formatTimestamp(entry.created_at)}
                  </div>
                  {changes.map((c) => (
                    <div key={c.label} className="text-xs">
                      <span className="text-muted">{c.label}:</span>{' '}
                      <span className="text-spend line-through decoration-spend/40">{c.from}</span>{' '}
                      <span className="text-faint">→</span> <span className="font-medium text-earn">{c.to}</span>
                    </div>
                  ))}
                  {legacyFields && <div className="text-xs text-muted">Changed {legacyFields.join(', ').toLowerCase()}</div>}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
