import { useEffect, useRef, useState } from 'react';
import { api } from '../../../api';
import { useApi, invalidate } from '../../../hooks/use-api';
import { useNotify } from '../../../hooks/use-notify';
import { useConfirm } from '../../../hooks/use-confirm';
import { Field, TextInput, Select, Segmented, Button } from '../../ui/Form';
import { DatePicker } from '../../ui/DatePicker';
import { accountChoices } from '../../../lib/categories/dropdown-choices';
import { giftCardForm, giftCardBody } from '../../../lib/overview/gift-card-form';

/**
 * Record a gift card the rewards were taken as (D330), or change or remove
 * one. Opens in place at the top of Cashback & Interest, not as a second
 * dialog over it. No statement shows a gift card, so this is the only way
 * that money is counted: its value, on the day it came.
 */
export function GiftCardForm({ gift, onDone }) {
  const { data: accounts } = useApi('accounts:all', () => api.accounts.list(true), { tags: ['accounts'] });
  const [form, setForm] = useState(() => giftCardForm(gift));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const notify = useNotify();
  const confirm = useConfirm();
  // Opened from a gift card far down the list: bring the form into view.
  const boxRef = useRef(null);
  useEffect(() => { boxRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, []);
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  const cards = (accounts ?? []).filter((a) => a.account_type === 'CREDIT_CARD' && (a.is_active || String(a.id) === form.account_id));

  const save = async () => {
    const out = giftCardBody(form);
    if (out.error) return setError(out);
    setBusy(true);
    setError(null);
    try {
      await (gift ? api.redemptions.update(gift.redemption_id, out.body) : api.redemptions.create(out.body));
      notify(out.body.brand, { name: gift ? 'gift.updated' : 'gift.added' });
      invalidate('transactions', 'redemptions');
      onDone();
    } catch (err) {
      // The API names its own fields; the form shows them on its own.
      setError({ error: err.message, field: { value_cents: 'value', rewards_used_cents: 'cost', points_used: 'cost' }[err.field] ?? err.field });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!(await confirm({ title: `Remove the ${gift.brand} gift card?`, message: "It stops counting as cashback. The record is kept in the activity log.", confirm: 'Remove', destructive: true }))) return;
    setBusy(true);
    try {
      await api.redemptions.void(gift.redemption_id);
      notify(gift.brand, { name: 'gift.removed' });
      invalidate('transactions', 'redemptions');
      onDone();
    } catch (err) {
      setError({ error: err.message });
      setBusy(false);
    }
  };

  const errorFor = (field) => (error?.field === field ? error.error : null);
  return (
    <div ref={boxRef} className="mb-5 scroll-mt-4 rounded-xl border border-rule p-4">
      <p className="mb-3 text-sm font-medium text-ink">{gift ? 'Gift card' : 'Record a gift card'}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Rewards from" error={errorFor('account_id')}>
          <Select value={form.account_id} onChange={set('account_id')} options={accountChoices(cards)} placeholder="Pick a card…" />
        </Field>
        <Field label="Received on" error={errorFor('redeemed_on')}>
          <DatePicker value={form.redeemed_on} onChange={(value) => set('redeemed_on')({ target: { value } })} aria-label="Received on" />
        </Field>
        <Field label="Gift card" error={errorFor('brand')}>
          <TextInput value={form.brand} onChange={set('brand')} placeholder="Amazon" maxLength={60} />
        </Field>
        <Field label="Worth" error={errorFor('value')}>
          <TextInput value={form.value} onChange={set('value')} placeholder="25.00" inputMode="decimal" />
        </Field>
        <Field label={form.costIn === 'points' ? 'Points used' : 'Rewards used'} error={errorFor('cost')} hint="Optional: what it cost. Reward dollars come off what the card is holding.">
          <TextInput value={form.cost} onChange={set('cost')} placeholder={form.costIn === 'points' ? '2,500' : '20.00'} inputMode={form.costIn === 'points' ? 'numeric' : 'decimal'} />
        </Field>
        <div className="flex items-start pt-2">
          <Segmented value={form.costIn} onChange={(costIn) => setForm((f) => ({ ...f, costIn }))} options={[{ value: 'dollars', label: 'Dollars' }, { value: 'points', label: 'Points' }]} />
        </div>
        <Field label="Note" className="sm:col-span-2" error={errorFor('note')}>
          <TextInput value={form.note} onChange={set('note')} placeholder="Optional" maxLength={200} />
        </Field>
      </div>
      {error && !error.field && <p className="mt-3 text-sm text-spend">{error.error}</p>}
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        {gift && <Button variant="quiet" size="sm" disabled={busy} onClick={remove}>Remove</Button>}
        <span className="flex-1" />
        <Button variant="quiet" size="sm" disabled={busy} onClick={onDone}>Cancel</Button>
        <Button size="sm" disabled={busy} onClick={save}>{gift ? 'Save' : 'Record'}</Button>
      </div>
    </div>
  );
}
