import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aprText, longDate, statusLine, paceOf, warningSentences, withStatementDates } from './balance-transfer.js';

// The shape GET /api/loans attaches as `bt` (invented amounts).
const bt = {
  state: 'active', since: '2026-09-10', end_date: '2027-04-05', end_source: 'statement', days_left: 179,
  payment_months_left: 6, needed_monthly_cents: 82834, pace: null, last_statement_paid_cents: null,
  promos: [{ kind: 'balance_transfer', apr_bps: 0, standard_apr_bps: 2974, end_date: '2027-04-05' }],
  warnings: [],
};

test('dates and rates in words, without floats', () => {
  assert.equal(longDate('2027-04-05'), 'Apr 5, 2027');
  assert.equal(aprText(2974), '29.74%');
  assert.equal(aprText(399), '3.99%');
  assert.equal(aprText(0), '0%');
  assert.equal(aprText(500), '5%');
});

test('one status line per state', () => {
  assert.deepEqual(statusLine(bt), { text: '0% until Apr 5, 2027 · 179 days', tone: 'muted' });
  assert.deepEqual(statusLine({ ...bt, state: 'ending_soon', days_left: 1 }), { text: '0% ends in 1 day · Apr 5, 2027', tone: 'spend' });
  assert.deepEqual(statusLine({ ...bt, state: 'promo_ended' }), { text: '0% ended Apr 5, 2027 · now 29.74%', tone: 'spend' });
  assert.equal(statusLine({ ...bt, state: 'paid_off' }).text, 'Paid off');
  assert.match(statusLine({ ...bt, state: 'no_end_date', end_date: null, promos: [] }).text, /next statement/);
});

test('the pace, only while there is one', () => {
  assert.deepEqual(paceOf(bt), { needed_cents: 82834, months: 6, by: '2027-04-05', pace: null, paid_cents: null });
  assert.equal(paceOf({ ...bt, needed_monthly_cents: null }), null);
});

test('warnings keep money as cents for the caller to format', () => {
  const [w] = warningSentences({ ...bt, warnings: [{ kind: 'interest_charged', cents: 1234 }] });
  assert.equal(w.tone, 'spend');
  assert.deepEqual(w.parts[1], { cents: 1234 });
});

test('the statement’s dates replace the typed ones for progress and insights', () => {
  const loan = { deadline_date: '2027-01-01', created_at: '2026-10-05T12:00:00Z', bt };
  assert.equal(withStatementDates(loan).deadline_date, '2027-04-05');
  assert.equal(withStatementDates(loan).created_at, '2026-09-10');
  const plain = { deadline_date: '2027-01-01', bt: null };
  assert.equal(withStatementDates(plain), plain);
});
