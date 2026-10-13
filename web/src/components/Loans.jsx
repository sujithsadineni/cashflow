import { useState } from 'react';
import { invalidate, useApi } from '../use-api';
import { useDesign } from '../use-design';
import { LoanProgress } from './LoanProgress';
import { percentClearedFor, VIVID_LOAN } from '../loan-progress';
import { api, formatMoney, dollarsToCents } from '../api';
import { Field, TextInput, Select, Button, EditableText, SectionHeader } from './Form';
import { BalanceTransferStatus, BalanceTransferSuggestions } from './BalanceTransferPanel';
import { withStatementDates } from '../balance-transfer';
import { LOAN_TYPE_OPTIONS, EMPTY_LOAN, loanToForm } from '../loan-form';
import { accountChoices, blankChoice, loanTypeChoices } from '../dropdown-choices';
import { DatePicker } from './ui/DatePicker';
import { useNotify } from '../use-notify';

/**
 * Loans: debt tracked outside the normal statement pipeline, with the
 * balance known one of three ways (see EFFECTIVE_BALANCE_SQL and
 * BALANCE_SOURCE_SQL in api/src/routes/loans.js), reflected here as
 * `loan.balance_source`:
 *
 *   'statement' — linked to a real account with real statements
 *     (a balance-transfer card); the balance is read straight off
 *     that account's most recent statement, same "copy the real
 *     number, don't compute it" spirit as cashback. Not editable here
 *     — it comes from approving a statement, not from this form.
 *   'formula'   — a monthly payment, term, and start date are known
 *     (the Wells Fargo car loan, which has no account of its own);
 *     the balance is ESTIMATED as payment x months left.
 *   'manual'    — none of the above; current_balance_cents is a
 *     plain figure you keep updated by hand.
 *
 * Every field is editable, not just balance/payment/deadline: an
 * "Edit" link on each row opens the exact same field set the add form
 * uses, pre-filled — one form shape for both, rather than a second,
 * differently-shaped edit form to keep in sync.
 */

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (iso) => {
  const [y, m] = iso.split('-').map(Number);
  return `${MONTH_ABBR[m - 1]} ${y}`;
};


/* ------------------------------------------------------------------
   Form — shared by "add a loan" and "edit a loan". `mode` only
   changes how the submitted payload is shaped: create omits an empty
   optional field, edit sends an explicit null so clearing a field in
   the form actually clears it in the database instead of doing
   nothing.
   ------------------------------------------------------------------ */

export function LoanForm({ mode, initial, accounts, submitLabel, savingLabel, onSubmit, onCancel }) {
  const [form, setForm] = useState(initial);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const set = (key) => (event) => setForm({ ...form, [key]: event.target.value });

  async function submit() {
    const cents = dollarsToCents(form.current_balance);
    if (Number.isNaN(cents)) {
      setError({ message: 'Enter the current balance', field: 'current_balance' });
      return;
    }

    const monthlyPaymentCents = form.monthly_payment ? dollarsToCents(form.monthly_payment) : NaN;
    const empty = mode === 'edit' ? null : undefined; // edit clears the field; create just omits it

    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        name: form.name,
        lender: form.lender || empty,
        loan_type: form.loan_type || 'other',
        current_balance_cents: cents,
        term_months: form.term_months ? Number(form.term_months) : empty,
        start_date: form.start_date || empty,
        monthly_payment_cents: Number.isNaN(monthlyPaymentCents) ? empty : monthlyPaymentCents,
        deadline_date: form.deadline_date || empty,
        linked_account_id: form.linked_account_id ? Number(form.linked_account_id) : empty,
      });
    } catch (err) {
      setError({ message: err.message, field: err.field });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border border-rule bg-raised p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" error={error?.field === 'name' ? error.message : null}>
          <TextInput
            value={form.name}
            onChange={set('name')}
            placeholder="Tesla Car Loan"
            invalid={error?.field === 'name'}
            autoFocus
          />
        </Field>

        <Field label="Lender" hint="Optional">
          <TextInput value={form.lender} onChange={set('lender')} placeholder="Wells Fargo" />
        </Field>

        <Field label="Type" hint="For the icon shown on the loan">
          <Select value={form.loan_type} onChange={set('loan_type')} options={loanTypeChoices(LOAN_TYPE_OPTIONS)} />
        </Field>

        <Field
          label="Current balance"
          hint="Used only if there's no term + payment + start date to estimate from"
          error={error?.field === 'current_balance' ? error.message : null}
        >
          <TextInput
            value={form.current_balance}
            onChange={set('current_balance')}
            placeholder="18,400.00"
            inputMode="decimal"
            className="tnum"
            invalid={error?.field === 'current_balance'}
          />
        </Field>

        <Field
          label="Deadline"
          hint={form.loan_type === 'balance_transfer' && form.linked_account_id
            ? 'Optional — the 0% end date is read from the card’s statements'
            : 'Payoff target, or when a 0% rate ends'}
        >
          <DatePicker value={form.deadline_date} onChange={(value) => set('deadline_date')({ target: { value } })} aria-label="Pay off by" />
        </Field>

        <Field label="Monthly payment" hint="Optional — enables the balance estimate below">
          <TextInput
            value={form.monthly_payment}
            onChange={set('monthly_payment')}
            placeholder="638.66"
            inputMode="decimal"
            className="tnum"
          />
        </Field>

        <Field label="Term" hint="Months — optional">
          <TextInput
            value={form.term_months}
            onChange={set('term_months')}
            placeholder="72"
            inputMode="numeric"
            className="tnum"
          />
        </Field>

        <Field label="Started" hint="Optional — needed for the estimate">
          <DatePicker value={form.start_date} onChange={(value) => set('start_date')({ target: { value } })} aria-label="Start date" />
        </Field>

        {accounts.length > 0 && (
          <Field label="Linked account" hint="Only if this loan is a card with its own statements">
            <Select
              value={form.linked_account_id}
              onChange={set('linked_account_id')}
              options={[blankChoice('None'), ...accountChoices(accounts)]}
            />
          </Field>
        )}
      </div>

      {error && !error.field && <p className="mt-4 text-sm text-spend">{error.message}</p>}

      <div className="mt-5 flex items-center gap-2">
        <Button onClick={submit} disabled={saving || !form.name.trim()}>
          {saving ? savingLabel : submitLabel}
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

export function Loans({ accounts, onChange }) {
  const { design } = useDesign();
  const vivid = design === 'vivid';
  // Glass (D244): the pane header names the page, so no section title; a grouped list.
  const glass = design === 'glass';
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  // useApi (D211): it used to start this request during render.
  const req = useApi('loans:settings', () => api.loans.list(), { tags: ['loans'] });
  const loans = req.data ?? null;
  const error = req.error;
  // After a create or edit: reload this list, and everything else showing loans.
  const load = () => invalidate('loans');

  const notify = useNotify();
  const handleCreated = (loan) => {
    setAdding(false);
    load();
    onChange?.();
    notify(`${loan.name} added`, { type: 'success' });
  };

  const handleEdited = (loan) => {
    setEditingId(null);
    load();
    onChange?.();
    notify(`${loan.name} saved`, { type: 'success' });
  };

  // The inline edits: say it saved, or why it didn't (D232: a failure used to vanish).
  const quickUpdate = async (loan, patch, what) => {
    try {
      await api.loans.update(loan.id, patch);
      load();
      onChange?.();
      notify(`${loan.name}: ${what} updated`, { type: 'success' });
    } catch (err) {
      notify(err.message, { type: 'error', title: `Couldn't update ${loan.name}` });
    }
  };

  const updateBalance = (loan, raw) => {
    const cents = dollarsToCents(raw);
    if (Number.isNaN(cents)) return;
    return quickUpdate(loan, { current_balance_cents: cents }, 'balance');
  };

  const updatePayment = (loan, raw) => {
    const cents = dollarsToCents(raw);
    if (Number.isNaN(cents)) return;
    return quickUpdate(loan, { monthly_payment_cents: cents }, 'monthly payment');
  };

  const updateDeadline = (loan, raw) => {
    if (raw && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return;
    return quickUpdate(loan, { deadline_date: raw || null }, 'deadline');
  };

  return (
    <section className="mb-12">
      {glass ? (
        <div className="mb-1.5 flex items-end justify-between px-4">
          <h4 className="text-[13px] text-muted tnum">{loans ? `${loans.length} loan${loans.length === 1 ? '' : 's'}` : ''}</h4>
          {!adding && loans?.length > 0 && (
            <button type="button" onClick={() => setAdding(true)} className="text-[13px] font-medium text-info">Add Loan</button>
          )}
        </div>
      ) : (
        <SectionHeader as="h2" title="Loans" emoji="💰" tint="bg-vivid-amber/20">
          {!adding && loans?.length > 0 && (
            <Button size="sm" onClick={() => setAdding(true)}>Add another</Button>
          )}
        </SectionHeader>
      )}

      {error && <p className="mb-3 text-sm text-spend">{error}</p>}

      {loans !== null && <BalanceTransferSuggestions onAdded={() => { load(); onChange?.(); }} />}

      {adding && (
        <div className="mb-6">
          <LoanForm
            mode="create"
            initial={EMPTY_LOAN}
            accounts={accounts}
            submitLabel="Add loan"
            savingLabel="Adding…"
            onSubmit={async (payload) => handleCreated(await api.loans.create(payload))}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

      {loans?.length === 0 && !adding && (
        <div className="border border-dashed border-rule-str px-5 py-10 text-center">
          <p className="text-ink">No loans tracked yet</p>
          <p className="mx-auto mt-1.5 mb-5 max-w-sm text-sm text-muted">
            A car loan, a 0% balance transfer — anything you owe that isn't in the regular transaction ledger.
          </p>
          <Button onClick={() => setAdding(true)}>Add your first loan</Button>
        </div>
      )}

      {loans?.length > 0 && (
        <ul className={vivid ? 'flex flex-col gap-3' : glass ? 'gs-group' : 'divide-y divide-rule'}>
          {loans.map((loan) => {
            const isEditing = editingId === loan.id;

            if (isEditing) {
              return (
                <li key={loan.id} className={glass ? 'gs-row p-4' : 'py-3'}>
                  <LoanForm
                    mode="edit"
                    initial={loanToForm(loan)}
                    accounts={accounts}
                    submitLabel="Save"
                    savingLabel="Saving…"
                    onSubmit={async (payload) => handleEdited(await api.loans.update(loan.id, payload))}
                    onCancel={() => setEditingId(null)}
                  />
                </li>
              );
            }

            const info = (
              <div className="min-w-0">
                <span className="text-ink">{loan.name}</span>
                <button
                  onClick={() => setEditingId(loan.id)}
                  className={glass
                    ? 'ml-2 text-[13px] font-medium text-info'
                    : `ml-2 text-sm text-faint underline-offset-4 opacity-0 transition-opacity
                       group-hover:opacity-100 hover:text-ink hover:underline`}
                >
                  Edit
                </button>
                {loan.bt && <BalanceTransferStatus bt={loan.bt} className="mt-0.5" />}
                <div className="mt-0.5 text-sm text-muted">
                  {loan.lender}
                  {loan.term_months ? `${loan.lender ? ' · ' : ''}${loan.term_months} months` : ''}
                  {loan.linked_account_name ? `${loan.lender || loan.term_months ? ' · ' : ''}${loan.linked_account_name}` : ''}
                </div>
              </div>
            );
            const balance = (
              <div className="shrink-0 text-right">
                <div className="font-mono text-sm text-spend tnum">
                  {loan.balance_source === 'manual' ? (
                    <EditableText
                      value={formatMoney(loan.current_balance_cents)}
                      onSave={(raw) => updateBalance(loan, raw)}
                      className="text-spend"
                    />
                  ) : (
                    formatMoney(loan.effective_balance_cents)
                  )}
                </div>
                {loan.balance_source === 'statement' ? (
                  <div className="text-sm text-faint tnum">
                    as of {monthLabel(loan.balance_as_of)} statement
                  </div>
                ) : loan.balance_source === 'formula' ? (
                  <div className="text-sm text-faint tnum">
                    <EditableText
                      value={formatMoney(loan.monthly_payment_cents)}
                      onSave={(raw) => updatePayment(loan, raw)}
                    />
                    {`/mo · ${loan.months_remaining} mo left`}
                  </div>
                ) : (
                  <div className="text-sm text-faint tnum">
                    <EditableText
                      value={loan.deadline_date}
                      onSave={(raw) => updateDeadline(loan, raw)}
                      placeholder="no deadline"
                    />
                  </div>
                )}
              </div>
            );

            if (vivid) {
              const meta = VIVID_LOAN[loan.loan_type] ?? VIVID_LOAN.other;
              return (
                <li key={loan.id} className={`group rounded-2xl p-4 ${meta.tint}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-raised text-2xl leading-none shadow-sm" aria-hidden="true">
                        <span style={meta.flip ? { transform: 'scaleX(-1)' } : undefined}>{meta.emoji}</span>
                      </span>
                      {info}
                    </div>
                    {balance}
                  </div>
                  <div className="mt-3">
                    <LoanProgress type={loan.loan_type} percent={percentClearedFor(withStatementDates(loan))} size="sm" />
                  </div>
                </li>
              );
            }

            return (
              <li key={loan.id} className={`group flex items-baseline justify-between gap-4 py-3 ${glass ? 'gs-row px-4' : ''}`}>
                {info}
                {balance}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
