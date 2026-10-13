import { useEffect, useState } from 'react';
import { api, formatTimestamp, maskName } from '../../api';
import { Button, Field, Segmented, Select, TextInput } from '../Form';
import { describeAction, describeDetail } from '../../activity-format';
import { paymentExplanation } from '../../payment-source';
import { PaymentMark } from '../PaymentMark';
import { TXN_TYPE_CHOICES, blankChoice, categoryChoices } from '../../dropdown-choices';
import { useNotify } from '../../use-notify';

/**
 * What a transaction's ＋ opens (D145): the full line as the statement
 * printed it, where it sits, and its own change history — every edit
 * from audit_log, worded by the same activity-format.js the Activity
 * page uses, so an edit reads identically in both places. The history
 * loads when the panel opens, not for every row on the page.
 */
/**
 * For what the matcher can't see (D200): someone else paid it with no
 * Zelle back, cash, an account not in the app. Set by hand, it's never
 * replaced by a re-check; Undo hands it back to the matcher.
 */
const SOURCE_KINDS = [
  { value: 'person', label: 'Someone else', placeholder: 'Who paid it' },
  { value: 'cash', label: 'Cash', placeholder: 'Where, optional' },
  { value: 'outside', label: 'Account not in the app', placeholder: 'Which account' },
];

export function PaymentSourcePicker({ transaction: t, onChanged }) {
  const notify = useNotify();
  const [open, setOpen] = useState(false);
  const [via, setVia] = useState('person');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const kind = SOURCE_KINDS.find((k) => k.value === via);

  const run = async (call, done) => {
    setBusy(true);
    setError(null);
    try {
      await call();
      setOpen(false);
      onChanged?.();
      notify(done, { type: 'success' });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (t.payment_source.source === 'manual') {
    return (
      <p className="mt-2 text-xs text-muted">
        Set by hand.{' '}
        <button disabled={busy} onClick={() => run(() => api.paymentMatches.clear(t.id), 'Payment source cleared')} className="text-ink underline-offset-4 hover:underline">
          Undo and check again
        </button>
        {error && <span className="ml-2 text-spend">{error}</span>}
      </p>
    );
  }
  if (t.payment_source.status === 'verified') return null;
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mt-2 text-xs text-ink underline-offset-4 hover:underline">
        Paid from somewhere else?
      </button>
    );
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Segmented size="sm" value={via} onChange={setVia} options={SOURCE_KINDS.map(({ value, label: l }) => ({ value, label: l }))} />
      <TextInput value={label} onChange={(e) => setLabel(e.target.value)} placeholder={kind.placeholder} className="w-44 py-1 text-sm" />
      <Button size="sm" disabled={busy || (via !== 'cash' && !label.trim())} onClick={() => run(() => api.paymentMatches.set(t.id, via, label.trim() || undefined), 'Payment source saved')}>
        Save
      </Button>
      <Button size="sm" variant="quiet" onClick={() => setOpen(false)}>Cancel</Button>
      {error && <span className="text-xs text-spend">{error}</span>}
    </div>
  );
}

/**
 * `edit` ({ categories, onRetype, onRecategorize }) adds Type and Category
 * pickers at the top, on a phone only: the table hides those columns there
 * (D232), so this is where they're changed.
 */
export function TransactionDetail({ transaction: t, lookup, onChanged, edit }) {
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

  const paid = paymentExplanation(t.payment_source, t.posted_date, t.payment_target);

  return (
    <div className="grid grid-cols-1 gap-5 text-sm md:grid-cols-2">
      {edit && (
        <div className="grid grid-cols-2 gap-2 md:hidden">
          {edit.onRetype && <Field label="Type">
            <Select value={t.txn_type ?? ''} onChange={(e) => edit.onRetype(t, e.target.value)} options={[blankChoice('—'), ...TXN_TYPE_CHOICES]} />
          </Field>}
          <Field label="Category" className={edit.onRetype ? '' : 'col-span-2'}>
            <Select value={t.category_id ?? ''} onChange={(e) => edit.onRecategorize(t, e.target.value)} options={[blankChoice('—'), ...categoryChoices(edit.categories)]} recentKey="category" />
          </Field>
        </div>
      )}
      {/* Where a card payment came from, or why that isn't known yet (D199). */}
      {paid && (
        <div className={`rounded-md border px-3 py-2.5 md:col-span-2 ${paid.verified || paid.named ? 'border-rule bg-band/50' : 'border-spend/40 bg-spend/5'}`}>
          <div className={`flex items-center gap-1.5 text-sm ${paid.verified || paid.named ? 'text-earn' : 'text-spend'}`}>
            <PaymentMark source={t.payment_source ?? t.payment_target} />
            {paid.title}
          </div>
          {paid.lines.map((line) => (
            <p key={line} className={`mt-1 text-xs ${line.startsWith('On that statement:') ? 'break-words font-mono text-faint' : 'text-muted'}`}>{line}</p>
          ))}
          {t.payment_source && <PaymentSourcePicker transaction={t} onChanged={onChanged} />}
        </div>
      )}
      <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1.5">
        <dt className="text-muted">On the statement</dt>
        <dd className="break-words font-mono text-xs text-ink">{t.description}</dd>
        {t.place && (
          <>
            <dt className="text-muted">Where</dt>
            <dd className="text-ink">{t.place.title}</dd>
          </>
        )}
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
