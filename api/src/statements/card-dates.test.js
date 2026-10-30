import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestCardDays, nextOnDay, dateInMonth, dayWords } from './card-dates.js';

const st = (period_end, payment_due_date = null) => ({ period_end, payment_due_date });

test('the usual closing and due day, with how many statements agree', () => {
  const s = suggestCardDays([st('2026-07-05', '2026-08-02'), st('2026-08-05', '2026-09-02'), st('2026-09-05', '2026-10-02')]);
  assert.deepEqual(s, { closing: { day: 5, agree: 3, of: 3 }, due: { day: 2, agree: 3, of: 3 } });
});

test('the month\'s last day is one rule: 28 in February and 31 in March are both "31"', () => {
  const s = suggestCardDays([st('2026-02-28', '2026-03-31'), st('2026-03-31', '2026-04-30'), st('2026-04-30', '2026-05-31')]);
  assert.equal(s.closing.day, 31);
  assert.equal(s.due.day, 31);
});

test('a card that moved its due day: only recent statements count, and a tie goes to the newest', () => {
  const s = suggestCardDays([st('2026-05-14', '2026-06-10'), st('2026-07-17', '2026-08-14')]);
  assert.deepEqual(s.due, { day: 14, agree: 1, of: 2 });
});

test('no statements, or none with a due date, suggest nothing', () => {
  assert.deepEqual(suggestCardDays([]), { closing: null, due: null });
  assert.equal(suggestCardDays([st('2026-09-24')]).due, null);
});

test('dates a day falls on: the last day when the month is short', () => {
  assert.equal(dateInMonth(2026, 2, 31), '2026-02-28');
  assert.equal(nextOnDay(2, '2026-10-17'), '2026-11-02');
  assert.equal(nextOnDay(19, '2026-10-17'), '2026-10-19');
  assert.equal(nextOnDay(31, '2026-02-10'), '2026-02-28');
});

test('a day in words', () => {
  assert.deepEqual([1, 2, 3, 5, 11, 12, 13, 22, 31].map(dayWords), ['1st', '2nd', '3rd', '5th', '11th', '12th', '13th', '22nd', 'last day']);
});

test('cardDue: what\'s owed on the newest statement, what\'s been paid, and how it stands', async () => {
  const { cardDue } = await import('./card-dates.js');
  const statement = { period_end: '2026-10-05', payment_due_date: '2026-11-02', closing_balance_cents: 1988000, minimum_payment_cents: 19880 };
  assert.equal(cardDue({ statement, today: '2026-10-17' }).status, 'due');
  assert.deepEqual(
    (({ status, days_left, remaining_cents }) => ({ status, days_left, remaining_cents }))(cardDue({ statement, today: '2026-10-30' })),
    { status: 'due_soon', days_left: 3, remaining_cents: 1988000 }
  );
  assert.equal(cardDue({ statement, paidCents: 1988000, today: '2026-10-30' }).status, 'paid');
  assert.equal(cardDue({ statement, today: '2026-11-03', seenUntil: '2026-11-05' }).status, 'overdue');
  assert.equal(cardDue({ statement, paidCents: 19880, today: '2026-11-03', seenUntil: '2026-11-05' }).status, 'minimum_paid');
  assert.equal(cardDue({ statement, today: '2026-11-03', seenUntil: '2026-10-31' }).status, 'unconfirmed', 'no statement reaches the due date yet');
  assert.equal(cardDue({ statement, today: '2026-11-03' }).status, 'unconfirmed', 'can\'t see payments at all');
  assert.equal(cardDue({ statement: { ...statement, closing_balance_cents: -6053 }, today: '2026-10-17' }).status, 'nothing_due');
  assert.equal(cardDue({ statement: null, today: '2026-10-17' }), null);
});

test('cardDue: a statement whose due date wasn\'t read falls back to the card\'s due day', async () => {
  const { cardDue } = await import('./card-dates.js');
  const statement = { period_end: '2026-10-05', payment_due_date: null, closing_balance_cents: 5000, minimum_payment_cents: null };
  assert.equal(cardDue({ statement, dueDay: 2, today: '2026-10-17' }).due_date, '2026-11-02');
  assert.equal(cardDue({ statement, today: '2026-10-17' }).status, 'unknown');
});

test('nextClose: the next closing day a cycle on, never the day after the last close', async () => {
  const { nextClose } = await import('./card-dates.js');
  assert.equal(nextClose('2026-09-07', 8), '2026-10-08');
  assert.equal(nextClose('2026-10-05', 5), '2026-11-05');
  assert.equal(nextClose('2026-01-31', 31), '2026-02-28');
});

test('the two newest statements move a card\'s days when the bank does (D320)', async () => {
  const { daysMoved } = await import('./card-dates-run.js');
  assert.deepEqual(daysMoved([{ closing: 17, due: 14 }, { closing: 17, due: 14 }], { closing_day: 14, due_day: 10 }), { closing_day: 17, due_day: 14 });
  assert.equal(daysMoved([{ closing: 17, due: 14 }, { closing: 14, due: 10 }], { closing_day: 14, due_day: 10 }), null, 'one statement is not a move');
  assert.equal(daysMoved([{ closing: 14, due: 10 }, { closing: 14, due: 10 }], { closing_day: 14, due_day: 10 }), null);
});
