/**
 * The loan form's options, blank state, and stored-loan → form mapping
 * (D222: moved out of Loans.jsx so it only exports components).
 */

export const LOAN_TYPE_OPTIONS = [
  { value: 'car', label: 'Car' },
  { value: 'home', label: 'Home' },
  { value: 'credit_card', label: 'Credit card' },
  { value: 'balance_transfer', label: 'Balance transfer' },
  { value: 'other', label: 'Other' },
];

export const EMPTY_LOAN = {
  name: '',
  lender: '',
  loan_type: 'other',
  current_balance: '',
  term_months: '',
  start_date: '',
  monthly_payment: '',
  deadline_date: '',
  linked_account_id: '',
};

/** 123456 -> "1234.56", for populating a form field from a stored value. */
const centsToDollarsStr = (cents) => (cents == null ? '' : (cents / 100).toFixed(2));

/** A loan row's stored shape -> this form's field shape. */
export function loanToForm(loan) {
  return {
    name: loan.name ?? '',
    lender: loan.lender ?? '',
    loan_type: loan.loan_type ?? 'other',
    current_balance: centsToDollarsStr(loan.current_balance_cents),
    term_months: loan.term_months != null ? String(loan.term_months) : '',
    start_date: loan.start_date ?? '',
    monthly_payment: centsToDollarsStr(loan.monthly_payment_cents),
    deadline_date: loan.deadline_date ?? '',
    linked_account_id: loan.linked_account_id != null ? String(loan.linked_account_id) : '',
  };
}
