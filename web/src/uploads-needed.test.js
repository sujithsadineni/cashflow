import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uploadsNeeded, monthLabel } from './uploads-needed.js';

const bofa = { account_id: 8, account_name: 'Adv SafeBalance', mask: '5508', issuer: 'Bank of America' };
const pay = (date, cents, status, likely = bofa) => ({ posted_date: date, amount_cents: cents, payment_source: { status, likely } });

test('uploadsNeeded: payments group by the bank that likely paid them, months newest first', () => {
  const out = uploadsNeeded([
    pay('2026-03-16', 3217, 'unverified'),
    pay('2026-03-08', 31322, 'unverified'),
    pay('2026-02-11', 9583, 'unverified'),
    pay('2026-09-30', 16558, 'named'),
    pay('2026-01-13', 1000, 'unverified', null),
    pay('2026-01-13', 1000, 'verified'),
  ]);
  assert.equal(out[0].key, 'bank:8');
  assert.deepEqual(out[0].months, ['2026-09', '2026-03', '2026-02']);
  assert.equal(out[0].payments, 3);
  assert.equal(out[0].waiting, 1);
  assert.equal(out[0].cents, 3217 + 31322 + 9583 + 16558);
  assert.equal(out[1].kind, 'unknown');
  assert.equal(out.length, 2);
});

test('uploadsNeeded: card bills group by card, and the account with most to clear comes first', () => {
  const out = uploadsNeeded([pay('2026-03-16', 100, 'unverified')], [
    { card: { id: 20, name: 'Cash Magnet', mask: '5503' }, month: '2026-09', count: 1, total_cents: 100 },
    { card: { id: 20, name: 'Cash Magnet', mask: '5503' }, month: '2026-06', count: 2, total_cents: 10848 },
  ]);
  assert.equal(out[0].key, 'card:20');
  assert.equal(out[0].bills, 3);
  assert.deepEqual(out[0].months, ['2026-09', '2026-06']);
});

test('monthLabel: a short month and year', () => {
  assert.equal(monthLabel('2026-03'), 'Mar 2026');
});

test('uploadsNeeded: a bill only pinned to an issuer groups under that issuer', () => {
  const out = uploadsNeeded([], [
    { card: null, issuer: 'Zolve', candidates: ['Zolve Credit Card', 'Zolve Credit Card'], month: '2026-09', count: 1, total_cents: 40000 },
    { card: null, issuer: 'Zolve', candidates: ['Zolve Credit Card'], month: '2026-08', count: 1, total_cents: 775 },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, 'Zolve Credit Card');
  assert.deepEqual(out[0].months, ['2026-09', '2026-08']);
});
