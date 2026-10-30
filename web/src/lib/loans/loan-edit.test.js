import { test } from 'node:test';
import assert from 'node:assert/strict';
import { centsToInput, owedIsKnown, loanForm, blankLoan, loanProblems, scheduleGap, loanChanges, createPayload, balanceSourceWords, loanRowStatus, groupLoans, lenderChoices } from './loan-edit.js';

// Invented loans with the real shapes: a term loan, a card-linked transfer, a hand-entered one.
const car = { id: 1, name: 'Car Loan', lender: 'Northwind Auto', loan_type: 'car', linked_account_id: null, current_balance_cents: 1840000,
  monthly_payment_cents: 63866, term_months: 72, start_date: '2025-05-01', deadline_date: null, months_remaining: 67,
  effective_balance_cents: 4279022, balance_source: 'formula', is_active: true };
const bt = { id: 2, name: 'Card transfer', lender: 'BOFA', loan_type: 'balance_transfer', linked_account_id: 7, linked_account_name: 'Everyday Card',
  current_balance_cents: 0, monthly_payment_cents: null, term_months: null, start_date: '2026-01-10', deadline_date: null,
  effective_balance_cents: 500000, balance_source: 'statement', balance_as_of: '2026-09-30', is_active: true,
  bt: { end_date: '2026-12-31', days_left: 74, since: '2026-01-10', balance_cents: 500000, promos: [{ apr_bps: 0, standard_apr_bps: 2974 }], state: 'active' } };
const manual = { id: 3, name: 'Family loan', lender: null, loan_type: 'other', linked_account_id: null, current_balance_cents: 250000,
  monthly_payment_cents: null, term_months: null, start_date: null, deadline_date: null, effective_balance_cents: 250000,
  balance_source: 'manual', updated_at: '2026-10-02T10:00:00Z', is_active: true };

test('cents become a field value from their digits', () => {
  assert.equal(centsToInput(1840000), '18,400.00');
  assert.equal(centsToInput(123456789), '1,234,567.89');
  assert.equal(centsToInput(5), '0.05');
  assert.equal(centsToInput(null), '');
});

test('a loan as the form holds it', () => {
  assert.deepEqual(loanForm(car), {
    name: 'Car Loan', lender: 'Northwind Auto', loan_type: 'car', linked_account_id: '', current_balance: '18,400.00',
    monthly_payment: '638.66', term_months: '72', start_date: '2025-05-01', deadline_date: '', payment_account_id: '', minimum_until: '',
  });
  assert.equal(blankLoan({ loan_type: 'balance_transfer', linked_account_id: '7' }).linked_account_id, '7');
});

test('problems as typed: name, balance unless linked, payment, term, dates', () => {
  assert.deepEqual(loanProblems(loanForm(car)), {});
  assert.deepEqual(loanProblems(loanForm(bt)), {});
  assert.deepEqual(loanProblems({ ...blankLoan(), name: ' ' }), { name: 'Give it a name', current_balance: 'Enter what\'s owed, like 18,400.00' });
  assert.deepEqual(loanProblems({ ...loanForm(car), monthly_payment: '0', term_months: '700', deadline_date: '2025-01-01' }), {
    monthly_payment: 'An amount above zero', term_months: 'Months, from 1 to 600', deadline_date: 'After the start date',
  });
  assert.deepEqual(loanProblems({ ...loanForm(manual), current_balance: 'abc' }), { current_balance: 'An amount, like 18,400.00' });
  assert.deepEqual(loanProblems({ ...loanForm(bt), current_balance: '' }), {});
});

test('what is owed is asked for only when nothing else knows it', () => {
  assert.equal(owedIsKnown(loanForm(car)), true);
  assert.equal(owedIsKnown(loanForm(bt)), true);
  assert.equal(owedIsKnown(loanForm(manual)), false);
  assert.equal(owedIsKnown({ ...loanForm(car), start_date: '' }), false);
  // A full schedule needs no typed balance, and a new one starts its fallback at 0.
  assert.deepEqual(loanProblems({ ...loanForm(car), current_balance: '' }), {});
  assert.equal(createPayload({ ...blankLoan(), name: 'Car', monthly_payment: '500', term_months: '60', start_date: '2026-01-01' }).current_balance_cents, 0);
});

test('a partial schedule says what is missing', () => {
  assert.equal(scheduleGap(loanForm(car)), null);
  assert.equal(scheduleGap(loanForm(manual)), null);
  assert.equal(scheduleGap({ ...loanForm(manual), monthly_payment: '100' }), 'Add the term and start date to estimate what\'s owed from the schedule.');
  assert.equal(scheduleGap({ ...loanForm(car), start_date: '' }), 'Add the start date to estimate what\'s owed from the schedule.');
});

test('only changed fields are sent; a cleared optional field becomes null', () => {
  const before = loanForm(car);
  assert.deepEqual(loanChanges(before, before), {});
  assert.deepEqual(loanChanges(before, { ...before, name: ' New ', monthly_payment: '700', term_months: '', lender: '', current_balance: '' }), {
    name: 'New', monthly_payment_cents: 70000, term_months: null, lender: null,
  });
  assert.deepEqual(loanChanges(loanForm(manual), { ...loanForm(manual), linked_account_id: '7', deadline_date: '2027-01-01', payment_account_id: '4' }), {
    linked_account_id: 7, deadline_date: '2027-01-01', payment_account_id: 4,
  });
});

test('a new loan leaves blanks out; a linked one starts at zero owed', () => {
  assert.deepEqual(createPayload({ ...blankLoan(), name: 'Family loan', current_balance: '2,500' }), {
    current_balance_cents: 250000, name: 'Family loan', loan_type: 'other',
  });
  assert.deepEqual(createPayload({ ...blankLoan(), name: 'T', loan_type: 'balance_transfer', linked_account_id: '7', lender: 'Bank' }), {
    current_balance_cents: 0, name: 'T', lender: 'Bank', loan_type: 'balance_transfer', linked_account_id: 7,
  });
});

test('where the owed figure comes from', () => {
  assert.equal(balanceSourceWords(bt), 'From the Everyday Card statement ending Sep 30, 2026.');
  assert.equal(balanceSourceWords(car), 'Estimated: $638.66 a month × 67 payments left.');
  assert.equal(balanceSourceWords({ ...car, payments: { made: 5 } }), 'Estimated: $638.66 a month × 67 payments left, from 5 payments found.');
  assert.equal(balanceSourceWords(manual), 'Entered by hand, last updated Oct 2, 2026.');
});

test('a row says what is owed and its clock', () => {
  assert.deepEqual(loanRowStatus(bt, '2026-10-18'), { owedCents: 500000, clock: '74 days at 0%', urgent: true, missed: false });
  assert.deepEqual(loanRowStatus(car, '2026-10-18'), { owedCents: 4279022, clock: '67 payments left', urgent: false, missed: false });
  assert.deepEqual(loanRowStatus(manual, '2026-10-18'), { owedCents: 250000, clock: null, urgent: false, missed: false });
  assert.deepEqual(loanRowStatus({ ...car, payments: { missed: 1 } }, '2026-10-18'), { owedCents: 4279022, clock: '1 missed', urgent: false, missed: true });
  assert.equal(loanRowStatus({ ...car, is_active: false }, '2026-10-18').clock, null);
});

test('balance transfers first; lenders one spelling each', () => {
  assert.deepEqual(groupLoans([car, bt, manual]).map((g) => [g.key, g.rows.map((l) => l.id)]), [['bt', [2]], ['loans', [1, 3]]]);
  assert.deepEqual(lenderChoices([car, bt, manual], [{ issuer: 'Bank of America' }, { issuer: 'Chase' }]), ['Bank of America', 'Chase', 'Northwind Auto']);
});
