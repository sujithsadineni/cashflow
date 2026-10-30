import { useState } from 'react';
import { api, formatMoney } from '../../api';
import { MerchantAvatar } from '../ui/MerchantAvatar';
import { useNotify } from '../../hooks/use-notify';

/**
 * Names that may be one person (D290), from GET /contacts/similar: each
 * bank spelling of someone ("Quinn", "Quin", "Quinn Parker") became
 * its own contact. Nothing merges by itself — two "Rowan"s can be two
 * people — so each pair shows both sides with what they've moved, and the
 * household picks the name to keep, or says they're different people.
 * Merging moves the other's Zelles and keeps its spelling as an alias, so
 * a later Zelle spelled that way finds the kept contact.
 */
export function SimilarContacts({ pairs, onChanged }) {
  const notify = useNotify();
  const [busy, setBusy] = useState(null);

  if (!pairs?.length) return null;

  const act = async (key, run, message, toast) => {
    setBusy(key);
    try {
      await run();
      notify(message, { name: toast });
      onChanged();
    } catch (err) {
      notify(err.message, { name: toast === 'contacts.merged' ? 'error.merge' : 'error.save' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="mb-5">
      <div className="mb-2 flex items-baseline justify-between">
        <h4 className="text-sm font-medium text-ink">Possible duplicates</h4>
        <span className="text-xs text-faint tnum">{pairs.length}</span>
      </div>
      <ul className="flex flex-col gap-2">
        {pairs.map(({ a, b, why }) => {
          const key = `${a.id}-${b.id}`;
          const keep = (kept, gone) => act(key, () => api.contacts.merge(gone.id, kept.id), `Into ${kept.name}`, 'contacts.merged');
          return (
            <li key={key} className={`rounded-lg border border-rule p-2.5 ${busy === key ? 'opacity-50' : ''}`}>
              <div className="mb-2 text-xs text-faint">{why}</div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Side contact={a} onKeep={() => keep(a, b)} disabled={busy !== null} />
                <Side contact={b} onKeep={() => keep(b, a)} disabled={busy !== null} />
              </div>
              <button
                onClick={() => act(key, () => api.contacts.distinct(a.id, b.id), 'Two different people', 'contacts.kept')}
                disabled={busy !== null}
                className="mt-2 text-xs text-muted underline-offset-4 hover:text-ink hover:underline"
              >
                Different people
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Side({ contact: c, onKeep, disabled }) {
  const years = c.first_date ? [c.first_date.slice(0, 4), c.last_date.slice(0, 4)].filter((y, i, all) => all.indexOf(y) === i).join('–') : null;
  return (
    <div className="flex min-w-0 items-start gap-2.5 rounded-md bg-band/60 p-2">
      <MerchantAvatar contact={{ id: c.id, name: c.name, nickname: c.nickname, image_path: c.image_path }} description="Zelle" clickable={false} size={28} />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-sm text-ink" title={c.name}>{c.name}</div>
        <div className="mt-0.5 text-xs text-faint">
          {c.transaction_count} Zelle{c.transaction_count === 1 ? '' : 's'}
          {c.in_cents > 0 && <> · <span className="font-mono text-earn tnum">+{formatMoney(c.in_cents)}</span></>}
          {c.out_cents < 0 && <> · <span className="font-mono text-spend tnum">−{formatMoney(-c.out_cents)}</span></>}
          {years && ` · ${years}`}
        </div>
      </div>
      <button
        onClick={onKeep}
        disabled={disabled}
        className="shrink-0 rounded-full border border-rule px-2.5 py-1 text-xs font-medium text-ink transition-colors hover:border-rule-str hover:bg-raised disabled:opacity-50"
      >
        Keep this name
      </button>
    </div>
  );
}
