import { test } from 'node:test';
import assert from 'node:assert/strict';
import { percentClearedFor, loanInsightsFor, loanMonthStatus } from './loan-progress.js';

// Three loans in the exact shape GET /api/loans returns (invented amounts), pinned to 2026-09-30.
const TODAY = new Date(2026, 8, 30);
const carLoan = { loan_type: 'car', term_months: 72, start_date: '2026-05-13', deadline_date: '2032-05-13', monthly_payment_cents: 54000, effective_balance_cents: 3900000, months_remaining: 68 };
const balanceTransfer = { loan_type: 'balance_transfer', term_months: null, start_date: '2026-09-08', deadline_date: '2027-10-13', monthly_payment_cents: null, effective_balance_cents: 2500000, months_remaining: null, created_at: '2026-09-17T17:53:47.243Z' };
const personalLoan = { loan_type: 'other', term_months: 18, start_date: '2026-05-07', deadline_date: null, monthly_payment_cents: 180000, effective_balance_cents: 2520000, months_remaining: 14 };

test('fixed-term loan: months left from the server, payoff at its deadline, its monthly payment', () => {
  const i = loanInsightsFor(carLoan, 6, TODAY);
  assert.equal(i.monthsLeft, 68);
  assert.equal(i.payoffDate, '2032-05-13');
  assert.equal(i.monthlyCents, 54000);
  assert.equal(i.daysLeft, undefined);
  assert.equal(i.milestone, 'start');
});

test('fixed-term loan with no deadline: payoff is start + term', () => {
  assert.equal(loanInsightsFor(personalLoan, 22, TODAY).payoffDate, '2027-11-01');
});

test('deadline-only loan: days left and the monthly amount that clears it in time, rounded up', () => {
  const i = loanInsightsFor(balanceTransfer, 3, TODAY);
  assert.equal(i.daysLeft, 378);
  // Oct 2026 through Oct 2027 = 13 payment months; 2,500,000 / 13 = 192,307.69 → 192,308
  assert.equal(i.neededCents, 192308);
  assert.equal(i.monthsLeft, undefined);
});

test('a deadline already passed: zero days, no impossible monthly figure', () => {
  const i = loanInsightsFor({ ...balanceTransfer, deadline_date: '2026-09-01' }, 100, TODAY);
  assert.equal(i.daysLeft, 0);
  assert.equal(i.neededCents, undefined);
});

test('milestones at the quarter marks', () => {
  assert.equal(loanInsightsFor(carLoan, 24, TODAY).milestone, 'start');
  assert.equal(loanInsightsFor(carLoan, 25, TODAY).milestone, 'quarter');
  assert.equal(loanInsightsFor(carLoan, 50, TODAY).milestone, 'half');
  assert.equal(loanInsightsFor(carLoan, 75, TODAY).milestone, 'stretch');
  assert.equal(loanInsightsFor(carLoan, null, TODAY).milestone, undefined);
});

test('percentClearedFor: a car loan term (4 of 72 months) is 6%', () => {
  const real = Date;
  globalThis.Date = class extends real { constructor(...a) { super(...(a.length ? a : [2026, 8, 30])); } static now() { return new real(2026, 8, 30).getTime(); } };
  try {
    assert.equal(percentClearedFor(carLoan), 6);
  } finally {
    globalThis.Date = real;
  }
});

test('loanMonthStatus: future, untracked, before records, loan start, paid, due this month, and nothing found', () => {
  const base = { currentMonth: '2026-09', paidSource: 'lender_match' };
  assert.equal(loanMonthStatus({ ...base, month: '2026-11', paidCents: 0 }), 'ahead');
  assert.equal(loanMonthStatus({ ...base, month: '2026-05', paidCents: 54000, paidSource: null }), 'untracked');
  assert.equal(loanMonthStatus({ ...base, month: '2025-03', paidCents: 0, recordsFrom: '2025-10' }), 'before');
  assert.equal(loanMonthStatus({ ...base, month: '2025-11', paidCents: 0, recordsFrom: '2025-10' }), 'none');
  assert.equal(loanMonthStatus({ ...base, month: '2026-03', paidCents: 0, startMonth: '2026-03' }), 'started');
  assert.equal(loanMonthStatus({ ...base, month: '2026-03', paidCents: 35000, startMonth: '2026-03' }), 'paid');
  assert.equal(loanMonthStatus({ ...base, month: '2026-05', paidCents: 54000 }), 'paid');
  assert.equal(loanMonthStatus({ ...base, month: '2026-09', paidCents: 0 }), 'due');
  assert.equal(loanMonthStatus({ ...base, month: '2026-08', paidCents: 0 }), 'none');
});
