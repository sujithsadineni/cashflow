import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statementTally } from './tally.js';

const rows = (...cents) => cents.map((amount_cents) => ({ amount_cents }));

test('checking: rows equal closing − opening → match', () => {
  const t = statementTally({ accountType: 'CHECKING', openingCents: 40000, closingCents: 70000, rows: rows(100000, -70000) });
  assert.deepEqual(t, { status: 'match', expected_cents: 30000, rows_cents: 30000, diff_cents: 0 });
});

test('credit card: purchases raise what you owe, so rows equal opening − closing', () => {
  // Owed $100, bought $60, paid $100 → owe $60.
  const t = statementTally({ accountType: 'CREDIT_CARD', openingCents: 10000, closingCents: 6000, rows: rows(-6000, 10000) });
  assert.equal(t.status, 'match');
});

test('a missed row shows up as the exact amount off', () => {
  const t = statementTally({ accountType: 'CHECKING', openingCents: 25317, closingCents: 19535, rows: rows(-4232) });
  assert.equal(t.status, 'mismatch');
  assert.equal(t.diff_cents, 1550); // rows say −42.32, statement says −57.82
});

test('no printed balance → unknown, never a guess', () => {
  assert.equal(statementTally({ accountType: 'CHECKING', openingCents: null, closingCents: 500, rows: rows(1) }).status, 'unknown');
});
