import { useState } from 'react';
import { dollarsToCents } from '../../api';
import { Field, TextInput, Select, Button } from '../ui/Form';
import { LOAN_TYPE_OPTIONS } from '../../lib/loans/loan-form';
import { accountChoices, blankChoice, loanTypeChoices } from '../../lib/categories/dropdown-choices';
import { DatePicker } from '../ui/DatePicker';

/**
 * The Overview Loans card's add-a-loan form (LoansDetail.jsx). Settings →
 * Loans is its own split view now (settings/loans, D298). Loans: debt tracked outside the normal statement pipeline, with the
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
