import { useState } from 'react';
import { api, ACCOUNT_TYPES, typeLabel, maskName } from '../api';
import { Field, TextInput, Select, Button, SectionHeader } from './Form';
import { useNotify } from '../notification-context';
import { useDesign } from '../design-context';
import { PersonAvatar } from './ui/PersonAvatar';

const EMPTY = {
  person_id: '',
  name: '',
  issuer: '',
  account_type: 'CREDIT_CARD',
  mask: '',
};

/* ------------------------------------------------------------------
   Add form
   ------------------------------------------------------------------ */

function AddAccountForm({ people, onCreated, onCancel }) {
  const [form, setForm] = useState({ ...EMPTY, person_id: String(people[0]?.id ?? '') });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const set = (key) => (event) => setForm({ ...form, [key]: event.target.value });

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const account = await api.accounts.create(form);
      onCreated(account);
    } catch (err) {
      // The backend tells us which field it rejected, so we can
      // point at it rather than showing a generic failure.
      setError({ message: err.message, field: err.field });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border border-rule bg-raised p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Whose account is it?">
          <Select
            value={form.person_id}
            onChange={set('person_id')}
            options={people.map((p) => ({ value: String(p.id), label: maskName(p.name) }))}
          />
        </Field>

        <Field label="Type">
          <Select value={form.account_type} onChange={set('account_type')} options={ACCOUNT_TYPES} />
        </Field>

        <Field
          label="What do you call it?"
          error={error?.field === 'name' ? error.message : null}
        >
          <TextInput
            value={form.name}
            onChange={set('name')}
            placeholder="Bilt Blue"
            invalid={error?.field === 'name'}
            autoFocus
          />
        </Field>

        <Field label="Issuer" hint="Optional">
          <TextInput value={form.issuer} onChange={set('issuer')} placeholder="Bilt" />
        </Field>

        <Field
          label="Last 4 digits"
          hint="Optional — helps you tell two cards apart"
          error={error?.field === 'mask' ? error.message : null}
        >
          <TextInput
            value={form.mask}
            onChange={set('mask')}
            placeholder="4417"
            inputMode="numeric"
            maxLength={4}
            className="tnum"
            invalid={error?.field === 'mask'}
          />
        </Field>
      </div>

      {error && !error.field && (
        <p className="mt-4 text-sm text-spend">{error.message}</p>
      )}

      <div className="mt-5 flex items-center gap-2">
        <Button onClick={submit} disabled={saving || !form.name.trim()}>
          {saving ? 'Adding…' : 'Add account'}
        </Button>
        <Button variant="quiet" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------
   List
   ------------------------------------------------------------------ */

// Vivid (D147): an emoji and tint per account type, so a list of
// thirteen accounts reads as banks vs cards at a glance.
const TYPE_VIVID = {
  CHECKING: { emoji: '🏦', tint: 'bg-vivid-blue/10' },
  SAVINGS: { emoji: '🐷', tint: 'bg-vivid-green/10' },
  CREDIT_CARD: { emoji: '💳', tint: 'bg-vivid-purple/10' },
};

function VividAccountGrid({ accounts, people }) {
  const max = Math.max(1, ...accounts.map((a) => Number(a.transaction_count)));
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {accounts.map((account) => {
        const t = TYPE_VIVID[account.account_type] ?? TYPE_VIVID.CHECKING;
        const owner = people.find((p) => p.id === account.person_id) ?? { name: account.person_name ?? '?' };
        const count = Number(account.transaction_count);
        return (
          <li key={account.id} className="flex items-center gap-3 rounded-2xl border border-rule bg-raised p-3.5 shadow-sm">
            <span className={`flex size-11 shrink-0 items-center justify-center rounded-xl text-xl leading-none ${t.tint}`} aria-hidden="true">
              {t.emoji}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="truncate font-medium text-ink">{account.name}</span>
                {account.mask && <span className="shrink-0 font-mono text-xs text-faint tnum">···{account.mask}</span>}
              </div>
              <div className="truncate text-xs text-muted">
                {typeLabel(account.account_type)}
                {account.issuer ? ` · ${account.issuer}` : ''}
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <span className="h-1.5 flex-1 rounded-full bg-band">
                  <span className="animate-bar-grow block h-1.5 rounded-full bg-vivid-blue" style={{ width: `${(count / max) * 100}%` }} />
                </span>
                <span className="shrink-0 font-mono text-[11px] text-muted tnum">{count} txns</span>
              </div>
            </div>
            <span title={maskName(owner.name)}>
              <PersonAvatar person={owner} size={30} />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function Accounts({ accounts, people, onChange }) {
  const vivid = useDesign().design === 'vivid';
  const notify = useNotify();
  const [adding, setAdding] = useState(false);

  const handleCreated = (account) => {
    setAdding(false);
    onChange();   // refetch, so the list reflects what the server actually has
    notify(`${account.name} added`, { type: 'success' });
  };

  return (
    <section className="mb-12">
      <SectionHeader as="h2" title="Accounts" emoji="🏦" tint="bg-vivid-blue/15">
        {!adding && accounts.length > 0 && (
          <Button size="sm" onClick={() => setAdding(true)}>Add another</Button>
        )}
      </SectionHeader>

      {adding && (
        <div className="mb-6">
          <AddAccountForm
            people={people}
            onCreated={handleCreated}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

      {accounts.length === 0 && !adding && (
        <div className="border border-dashed border-rule-str px-5 py-10 text-center">
          <p className="text-ink">No accounts yet</p>
          <p className="mx-auto mt-1.5 mb-5 max-w-sm text-sm text-muted">
            Add a card or bank account, then upload a statement to fill it with history.
          </p>
          <Button onClick={() => setAdding(true)}>Add your first account</Button>
        </div>
      )}

      {vivid && accounts.length > 0 && <VividAccountGrid accounts={accounts} people={people} />}

      {!vivid && accounts.length > 0 && (
        <ul className="divide-y divide-rule">
          {accounts.map((account) => (
            <li key={account.id} className="flex items-baseline justify-between gap-4 py-3">
              <div className="min-w-0">
                <span className="text-ink">{account.name}</span>
                {account.mask && (
                  <span className="ml-2 font-mono text-sm text-faint tnum">···{account.mask}</span>
                )}
                <div className="mt-0.5 text-sm text-muted">
                  {maskName(account.person_name)} · {typeLabel(account.account_type)}
                  {account.issuer ? ` · ${account.issuer}` : ''}
                </div>
              </div>

              <div className="shrink-0 text-right">
                <div className="font-mono text-sm text-ink tnum">
                  {account.transaction_count}
                </div>
                <div className="text-sm text-faint">
                  {Number(account.transaction_count) === 1 ? 'transaction' : 'transactions'}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
