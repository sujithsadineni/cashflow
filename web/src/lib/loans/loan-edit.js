/**
 * Settings → Loans (D298): the rules behind the split view and its edit,
 * kept out of the components so they can be tested. Pure: tested in
 * loan-edit.test.js. Money stays in cents; an amount shown in a field is
 * written from its digits, never divided (CLAUDE.md: only formatMoney
 * divides by 100), and read back with dollarsToCents.
 */

import { dollarsToCents, formatMoney } from '../../api.js';
import { bankBrandFor } from '../cards/bankBrands.js';
import { countdownFor } from './loan-countdown.js';
import { longDate } from './balance-transfer.js';

/** 123456 → "1,234.56", from the digits; '' for none. dollarsToCents reads it back. */
export function centsToInput(cents) {
  if (cents == null) return '';
  const digits = String(Math.abs(Math.trunc(Number(cents)))).padStart(3, '0');
  const whole = digits.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${Number(cents) < 0 ? '-' : ''}${whole}.${digits.slice(-2)}`;
}

const isLinked = (form) => Boolean(form.linked_account_id);

/**
 * Whether what's owed is known without typing it: read off a linked card's
 * statements, or estimated from a full schedule (routes/loans.js's sources).
 * Only when neither is it a field the person fills in.
 */
export const owedIsKnown = (form) => isLinked(form)
  || Boolean(form.monthly_payment.trim() && form.term_months.trim() && form.start_date);
const blankOr = (v) => (v == null ? '' : String(v));

/** A loan's editable fields as the form holds them: strings throughout. */
export const loanForm = (loan) => ({
  name: loan.name ?? '',
  lender: loan.lender ?? '',
  loan_type: loan.loan_type ?? 'other',
  linked_account_id: blankOr(loan.linked_account_id),
  current_balance: centsToInput(loan.current_balance_cents),
  monthly_payment: centsToInput(loan.monthly_payment_cents),
  term_months: blankOr(loan.term_months),
  start_date: (loan.start_date ?? '').slice(0, 10),
  deadline_date: (loan.deadline_date ?? '').slice(0, 10),
  payment_account_id: blankOr(loan.payment_account_id),
  minimum_until: (loan.minimum_until ?? '').slice(0, 10),
});

/** A new loan, starting as a balance transfer when a card is given (a suggestion). */
export const blankLoan = (start = {}) => ({
  name: '', lender: '', loan_type: 'other', linked_account_id: '', current_balance: '',
  monthly_payment: '', term_months: '', start_date: '', deadline_date: '', payment_account_id: '', minimum_until: '', ...start,
});

const money = (v) => (v.trim() === '' ? null : dollarsToCents(v));

/**
 * What's wrong with the form, field by field. Empty when it can be saved.
 * When what's owed is known another way (owedIsKnown), it isn't asked for.
 */
export function loanProblems(form) {
  const out = {};
  if (!form.name.trim()) out.name = 'Give it a name';
  if (!owedIsKnown(form)) {
    const balance = money(form.current_balance);
    if (balance == null) out.current_balance = 'Enter what\'s owed, like 18,400.00';
    else if (Number.isNaN(balance) || balance < 0) out.current_balance = 'An amount, like 18,400.00';
  }
  const payment = money(form.monthly_payment);
  if (payment != null && (Number.isNaN(payment) || payment <= 0)) out.monthly_payment = 'An amount above zero';
  const term = form.term_months.trim();
  if (term && !(/^\d{1,3}$/.test(term) && Number(term) >= 1 && Number(term) <= 600)) out.term_months = 'Months, from 1 to 600';
  if (form.start_date && form.deadline_date && form.deadline_date < form.start_date) out.deadline_date = 'After the start date';
  return out;
}

/**
 * When some of payment, term and start are filled but not all three, the
 * balance can't be estimated: which ones are missing, in words. Null when
 * none or all are there.
 */
export function scheduleGap(form) {
  const parts = [['monthly payment', form.monthly_payment], ['term', form.term_months], ['start date', form.start_date]];
  const missing = parts.filter(([, v]) => !String(v).trim()).map(([n]) => n);
  if (missing.length === 0 || missing.length === 3) return null;
  const list = missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(', ')} and ${missing.at(-1)}`;
  return `Add the ${list} to estimate what's owed from the schedule.`;
}

const FIELDS = ['name', 'lender', 'loan_type', 'linked_account_id', 'current_balance', 'monthly_payment', 'term_months', 'start_date', 'deadline_date', 'payment_account_id', 'minimum_until'];
const API_KEY = { current_balance: 'current_balance_cents', monthly_payment: 'monthly_payment_cents' };

/** A field's value as the API takes it; null clears it. */
function apiValue(key, v) {
  const t = v.trim();
  if (key === 'current_balance' || key === 'monthly_payment') return t === '' ? null : dollarsToCents(t);
  if (key === 'term_months' || key === 'linked_account_id' || key === 'payment_account_id') return t === '' ? null : Number(t);
  if (key === 'name' || key === 'loan_type') return t;
  return t === '' ? null : t;
}

/** Only what changed, in the API's shape, so the audit log records just those fields. */
export function loanChanges(before, after) {
  const out = {};
  for (const key of FIELDS) {
    if (after[key].trim() === before[key].trim()) continue;
    // The balance can't be cleared (the column is required); a linked loan keeps its last one.
    if (key === 'current_balance' && after[key].trim() === '') continue;
    out[API_KEY[key] ?? key] = apiValue(key, after[key]);
  }
  return out;
}

/**
 * A new loan in the API's shape: empty optional fields left out. The column
 * is required, so a loan whose owed figure comes from its card or schedule
 * starts its hand-typed fallback at 0.
 */
export function createPayload(form) {
  const out = { current_balance_cents: owedIsKnown(form) && !form.current_balance.trim() ? 0 : apiValue('current_balance', form.current_balance) };
  for (const key of FIELDS) {
    if (key === 'current_balance') continue;
    const v = apiValue(key, form[key]);
    if (v != null && v !== '') out[API_KEY[key] ?? key] = v;
  }
  return out;
}

/** Where the owed figure comes from, in a sentence. */
export function balanceSourceWords(loan) {
  if (loan.balance_source === 'statement') {
    return loan.balance_as_of ? `From the ${loan.linked_account_name ?? 'card'} statement ending ${longDate(String(loan.balance_as_of).slice(0, 10))}.` : 'From the card\'s statements.';
  }
  if (loan.balance_source === 'formula') {
    const left = `${formatMoney(Number(loan.monthly_payment_cents))} a month × ${loan.months_remaining} ${loan.months_remaining === 1 ? 'payment' : 'payments'} left`;
    // D299: counted from the payments found, so a skipped one keeps it up.
    if (loan.payments) return `Estimated: ${left}, from ${loan.payments.made} ${loan.payments.made === 1 ? 'payment' : 'payments'} found.`;
    return `Estimated: ${left}.`;
  }
  return loan.updated_at ? `Entered by hand, last updated ${longDate(String(loan.updated_at).slice(0, 10))}.` : 'Entered by hand.';
}

/**
 * The list row's trailing figures: what's owed, and its clock in a few
 * words ("312 days at 0%", "67 payments left"), urgent when a 0% end or a
 * payoff date is close.
 */
export function loanRowStatus(loan, today) {
  const owed = Number(loan.bt?.balance_cents ?? loan.effective_balance_cents ?? 0);
  const c = loan.is_active === false ? null : countdownFor(loan, today);
  // A missed payment (D299) outranks the clock: it's the thing to act on.
  const missed = loan.is_active !== false ? loan.payments?.missed ?? 0 : 0;
  let clock = null;
  if (missed > 0) clock = `${missed} missed`;
  else if (c && c.ended) clock = c.kind === 'bt' ? '0% period ended' : c.kind === 'schedule' ? 'Last payment made' : 'Past its date';
  else if (c) clock = `${c.count.toLocaleString()} ${c.unit}`;
  return { owedCents: owed, clock, urgent: Boolean(c?.urgent), missed: missed > 0 };
}

/** Balance transfers, then the other loans; a group with nothing in it isn't shown. */
export function groupLoans(loans) {
  return [
    { key: 'bt', label: 'Balance transfers', rows: loans.filter((l) => l.loan_type === 'balance_transfer') },
    { key: 'loans', label: 'Loans', rows: loans.filter((l) => l.loan_type !== 'balance_transfer') },
  ].filter((g) => g.rows.length > 0);
}

/** Lenders to suggest: every one on file and every card issuer, one spelling each, alphabetical. */
export function lenderChoices(loans, accounts) {
  const byKey = new Map();
  for (const raw of [...loans.map((l) => l.lender), ...accounts.map((a) => a.issuer)]) {
    const name = raw?.trim();
    if (!name) continue;
    const brand = bankBrandFor(name);
    const key = brand?.key ?? name.toLowerCase();
    if (!byKey.has(key)) byKey.set(key, brand?.name ?? name);
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b));
}
