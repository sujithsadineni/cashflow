import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayWords, cycleWords, cycleShort, suggestionWords, dueLine } from './card-days.js';

test('days in words, 31 as the month\'s last day', () => {
  assert.deepEqual([1, 2, 3, 11, 22, 31].map(dayWords), ['1st', '2nd', '3rd', '11th', '22nd', 'last day']);
});

test('a card\'s cycle: its own days first, else what its statements suggest', () => {
  assert.equal(cycleWords({ closing_day: 5, due_day: 2 }), 'Closes on the 5th · due on the 2nd');
  assert.equal(cycleWords({ date_suggestion: { closing: { day: 31 }, due: { day: 31 } } }), 'Closes on the last day · due on the last day');
  assert.equal(cycleWords({}), null);
  assert.equal(cycleShort({ closing_day: 5, due_day: 31 }), 'Closes 5th · due last day');
  assert.equal(suggestionWords({ day: 14, agree: 2, of: 3 }), 'From your statements: the 14th (2 of 3)');
});

test('a bill in one line, with a tone', () => {
  const base = { due_date: '2026-11-02', owed_cents: 1988000, remaining_cents: 1988000, seen_until: '2026-10-05' };
  assert.deepEqual(dueLine({ ...base, status: 'due', days_left: 16 }), { text: '$19,880.00 due Nov 2 · in 16 days', tone: 'muted' });
  assert.equal(dueLine({ ...base, status: 'due_soon', days_left: 0 }).text, '$19,880.00 due today');
  assert.equal(dueLine({ ...base, status: 'overdue', days_left: -3 }).text, '$19,880.00 was due Nov 2 · 3 days late');
  assert.equal(dueLine({ ...base, status: 'unconfirmed', days_left: -1 }).text, '$19,880.00 was due Nov 2 · paid? Statements run to Oct 5');
  assert.equal(dueLine({ ...base, status: 'paid', remaining_cents: 0 }).tone, 'earn');
  assert.equal(dueLine(null), null);
});
