import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dueDate, loanPaymentStatus } from './loan-payments.js';

// Invented loan with the real shape: due on the 13th, $638.66 a month.
const loan = { start_date: '2026-05-13', term_months: 72, monthly_payment_cents: 63866 };
const pay = (posted_date, cents = 63866) => ({ posted_date, cents, account_id: 7 });
const onTime = [pay('2026-05-13'), pay('2026-06-15'), pay('2026-07-13'), pay('2026-08-13'), pay('2026-09-14')];

test('due dates keep the start day, or the month\'s last day when shorter', () => {
  assert.equal(dueDate('2026-05-13', 0), '2026-05-13');
  assert.equal(dueDate('2026-05-13', 8), '2027-01-13');
  assert.equal(dueDate('2026-01-31', 1), '2026-02-28');
});

test('every payment on file, and the next one not on file yet', () => {
  const s = loanPaymentStatus({ loan, payments: onTime, coveredThrough: '2026-09-22', today: '2026-10-18' });
  assert.equal(s.made, 5);
  assert.equal(s.missed, 0);
  assert.equal(s.due_day, 13);
  // Oct 13 has passed, but the records stop at Sep 22: not missed, just not on file.
  assert.deepEqual(s.next, { date: '2026-10-13', status: 'not_on_file' });
  assert.deepEqual(s.dues.map((d) => d.status), ['paid', 'paid', 'paid', 'paid', 'paid', 'not_on_file', 'upcoming']);
  assert.equal(s.dues[1].paid_on, '2026-06-15');
  assert.equal(s.last_payment.posted_date, '2026-09-14');
});

test('a skipped month is missed once the records cover it', () => {
  const skipped = onTime.filter((p) => p.posted_date !== '2026-07-13');
  const s = loanPaymentStatus({ loan, payments: skipped, coveredThrough: '2026-09-22', today: '2026-10-18' });
  // Four payments settle the first four due dates; Sep 13 is the one left unpaid.
  assert.equal(s.made, 4);
  assert.equal(s.missed, 1);
  assert.deepEqual(s.dues.filter((d) => d.status === 'missed').map((d) => d.date), ['2026-09-13']);
  // Behind since July, the month with no payment, though July was later made up by order.
  assert.equal(s.behind_since, '2026-07-13');
});

test('within the grace days it is not missed yet', () => {
  const s = loanPaymentStatus({ loan, payments: onTime.slice(0, 4), coveredThrough: '2026-09-16', today: '2026-10-18' });
  assert.equal(s.missed, 0);
  assert.equal(s.dues[4].status, 'not_on_file');
});

test('a late or double payment catches up; a short one waits to be made up', () => {
  const caughtUp = [...onTime.filter((p) => p.posted_date !== '2026-07-13'), pay('2026-09-14')];
  assert.equal(loanPaymentStatus({ loan, payments: caughtUp, coveredThrough: '2026-09-22', today: '2026-10-18' }).missed, 0);
  assert.equal(loanPaymentStatus({ loan, payments: caughtUp, coveredThrough: '2026-09-22', today: '2026-10-18' }).behind_since, null);
  const short = [...onTime.slice(0, 4), pay('2026-09-14', 30000)];
  const s = loanPaymentStatus({ loan, payments: short, coveredThrough: '2026-09-22', today: '2026-10-18' });
  assert.equal(s.made, 4);
  assert.equal(s.missed, 1);
  assert.equal(s.behind_since, '2026-09-13');
});

test('no records at all: nothing is called missed', () => {
  const s = loanPaymentStatus({ loan, payments: [], coveredThrough: null, today: '2026-10-18' });
  assert.equal(s.missed, 0);
  assert.equal(s.next.status, 'not_on_file');
  assert.equal(loanPaymentStatus({ loan: { start_date: '2026-05-13' }, payments: [], today: '2026-10-18' }), null);
});
