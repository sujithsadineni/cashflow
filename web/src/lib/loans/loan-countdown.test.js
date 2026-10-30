import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countdownFor, nextDeadline, projection } from './loan-countdown.js';

const TODAY = '2026-10-12';
// Shaped like /api/loans rows; invented names.
const BT = {
  id: 1, name: 'Card A transfer', loan_type: 'balance_transfer', effective_balance_cents: 2843201,
  bt: { state: 'active', since: '2026-09-08', end_date: '2027-10-13', days_left: 366, payment_months_left: 13, needed_monthly_cents: 218708,
    transferred_cents: 2850000, fees_cents: 114000, balance_cents: 2843201, promos: [{ apr_bps: 0, standard_apr_bps: 2824 }] },
};
const SOON = { ...BT, id: 2, bt: { ...BT.bt, end_date: '2027-04-05', days_left: 175, payment_months_left: 6, needed_monthly_cents: 331334, balance_cents: 1988000 } };
const CAR = { id: 3, name: 'Car', loan_type: 'car', term_months: 72, start_date: '2026-05-13', monthly_payment_cents: 63866, months_remaining: 68, effective_balance_cents: 4342888 };
const DUE = { id: 4, name: 'Family loan', loan_type: 'other', deadline_date: '2027-04-12', start_date: '2026-04-12', effective_balance_cents: 600000 };

test('a balance transfer counts days at its promo rate, with the server pace', () => {
  const c = countdownFor(BT, TODAY);
  assert.equal(c.kind, 'bt');
  assert.equal(c.count, 366);
  assert.equal(c.unit, 'days at 0%');
  assert.equal(c.perMonthCents, 218708);
  assert.equal(c.startBalanceCents, 2964000); // transferred + fee
  assert.equal(c.afterAprBps, 2824);
  assert.equal(c.urgent, false);
  assert.equal(countdownFor(SOON, TODAY).urgent, true);
});

test('a fixed-term loan counts payments left', () => {
  const c = countdownFor(CAR, TODAY);
  assert.deepEqual([c.kind, c.count, c.made, c.unit, c.end], ['schedule', 68, 4, 'payments left', '2032-05-13']);
  assert.ok(c.timeShare > 0.05 && c.timeShare < 0.07);
});

test('a deadline-only loan: days left, and balance over whole months, rounded up', () => {
  const c = countdownFor(DUE, TODAY);
  assert.deepEqual([c.kind, c.count, c.monthsLeft, c.perMonthCents], ['deadline', 182, 6, 100000]);
});

test('the soonest deadline wins the banner; fixed-term loans never do', () => {
  assert.equal(nextDeadline([BT, CAR, SOON], TODAY).loan.id, 2);
  assert.equal(nextDeadline([CAR], TODAY), null);
});

test('the projection runs month by month to zero', () => {
  const p = projection(countdownFor(BT, TODAY), TODAY);
  assert.equal(p[0].cents, 2843201);
  assert.equal(p.at(-1).cents, 0);
  assert.equal(p.at(-1).date, '2027-10-12');
});

test('nothing to count down: no countdown', () => {
  assert.equal(countdownFor({ id: 9, name: 'x' }, TODAY), null);
});
