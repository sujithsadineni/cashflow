/**
 * The Overview add-a-loan form's options and blank state (D222). Settings →
 * Loans edits through lib/loans/loan-edit.js (D298), which also replaced the
 * stored-loan → form mapping that used to divide cents by 100 here.
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

/** A suggested monthly loan's name (D419): "Sample Bank car loan", "Acme Lending loan". */
export const installmentName = (s) => `${s.lender} ${s.loan_type === 'car' ? 'car loan' : s.loan_type === 'home' ? 'mortgage' : 'loan'}`;
