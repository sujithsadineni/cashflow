import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needsYou, comingUp, clearedByMonth, clearedTitle, isAnswered, tiles, termsItems, noticeItems } from './alert-feed.js';

const live = {
  card_payments_due: [{ account_id: 9, account_name: 'Blue Cash', mask: '5105', status: 'due_soon', due_date: '2026-10-19', days_left: 1, remaining_cents: 25136 }],
  overdue_statements: [{ account_id: 12, account_name: 'Zolve', mask: '5114', expected_by: '2026-09-24', days_overdue: 24 }],
  missed_recurring: [{ id: 25, name: 'Xfinity', expected_date: '2026-10-09', expected_amount_cents: -4116 }],
  new_recurring: [], pending_review: [], payments_unknown: [{ id: 1 }, { id: 2 }],
};

test('needs you: worst first, each a plain instruction with its action (D315)', () => {
  const items = needsYou(live);
  assert.deepEqual(items.map((i) => i.title), ['Pay Blue Cash ··5105', "Upload Zolve ··5114's statement", "Xfinity hasn't charged", '2 card payments to match']);
  assert.equal(items[0].subtitle, 'Due Oct 19 · tomorrow');
  assert.equal(items[0].cents, 25136);
  assert.equal(items[0].urgent, true);
  assert.deepEqual(items[1].action, { label: 'Upload', to: '/import' });
  assert.deepEqual(needsYou(null), []);
});

test('coming up: the next two weeks by day; a bill already in needs-you is not repeated (D315)', () => {
  const accounts = [
    { id: 9, name: 'Blue Cash', mask: '5105', payment_due: { status: 'due_soon', due_date: '2026-10-19', remaining_cents: 25136 } },
    { id: 3, name: 'Apple Card', mask: '5113', payment_due: { status: 'due', due_date: '2026-10-31', remaining_cents: 12269 } },
    { id: 4, name: 'Far', mask: '1', payment_due: { status: 'due', due_date: '2026-12-01', remaining_cents: 100 } },
  ];
  const bills = [{ id: 2, name: 'HBO Max', status: 'ACTIVE', next_date: '2026-10-20', expected_amount_cents: -589 }, { id: 8, name: 'Old', status: 'ENDED', next_date: '2026-10-20' }];
  const loans = [{ id: 7, name: 'BofA Balance Transfer', bt: { end_date: '2026-11-30', balance_cents: 100000 } }];
  const groups = comingUp({ accounts, bills, loans, today: '2026-10-18', skip: new Set(['pay:9']) });
  assert.deepEqual(groups.map((g) => [g.label, g.items.map((i) => i.title)]), [
    ['Oct 20', ['HBO Max']],
    ['Oct 31', ['Apple Card ··5113 bill']],
    ['Nov 30', ['BofA Balance Transfer: 0% ends']],
  ]);
});

test('cleared: grouped by the month it was cleared, newest first', () => {
  const months = clearedByMonth([
    { id: 1, title: 'A', resolved_at: '2026-09-30T10:00:00Z' },
    { id: 2, title: 'B', resolved_at: '2026-10-02T10:00:00Z' },
    { id: 3, title: 'Open', resolved_at: null },
  ]);
  assert.deepEqual(months.map((m) => [m.label, m.items.map((i) => i.title)]), [['October 2026', ['B']], ['September 2026', ['A']]]);
  assert.equal(clearedTitle({ type: 'CARD_PAYMENT_DUE', title: 'Robinhood Gold Card ···5112 payment' }), 'Paid · Robinhood Gold Card ···5112');
  assert.equal(clearedTitle({ type: 'PENDING_REVIEW', title: 'Apple Card — 2 to review' }), 'Reviewed · Apple Card');
});

test('an answer hides its alert: snoozed until a day, dismissed, or paid for that due date only (D318)', () => {
  const item = { key: 'pay:9', ref: '2026-10-19' };
  assert.equal(isAnswered(item, [{ key: 'pay:9', ref: '2026-10-19', kind: 'paid', until: null }], '2026-10-18'), true);
  assert.equal(isAnswered({ key: 'pay:9', ref: '2026-11-19' }, [{ key: 'pay:9', ref: '2026-10-19', kind: 'paid', until: null }], '2026-10-18'), false, 'next month is a new bill');
  assert.equal(isAnswered(item, [{ key: 'pay:9', ref: '', kind: 'snooze', until: '2026-10-17' }], '2026-10-18'), false, 'a snooze that ran out');
  const shown = needsYou({ ...live, snoozed: [{ key: 'stmt:12', ref: '2026-09-24', kind: 'dismiss', until: null }] }, '2026-10-18');
  assert.equal(shown.some((i) => i.key === 'stmt:12'), false);
});

test('the tiles add up what each kind needs', () => {
  const t = tiles(needsYou(live, '2026-10-18'));
  assert.deepEqual(t, { pay: { count: 1, cents: 25136 }, upload: { count: 1 }, bills: { count: 1, cents: 4116 }, review: { count: 2 } });
});

test('a late statement is named by its own dates, not the reminder\'s (D320)', () => {
  const [item] = needsYou({ overdue_statements: [{ account_id: 12, account_name: 'Zolve', mask: '5114', expected_by: '2026-09-27', days_overdue: 21, closed_on: '2026-09-17', period_start: '2026-08-18' }] }, '2026-10-18');
  assert.equal(item.subtitle, 'Aug 18 – Sep 17 · closed 31 days ago');
  assert.equal(item.days, -31);
});

test('card terms: APR moves of the same size fold into one item; a limit change stays its card\'s own (D349)', () => {
  const t = (id, name, changes, end = '2026-10-13') => ({ account_id: id, account_name: name, mask: null, period_end: end, changes });
  const items = termsItems([
    t(1, 'Card A', [{ field: 'apr', from: 2749, to: 2774 }]),
    t(2, 'Card B', [{ field: 'apr', from: 2849, to: 2874 }], '2026-10-17'),
    t(3, 'Card C', [{ field: 'apr', from: 3475, to: 3500 }]),
    t(4, 'Card D', [{ field: 'limit', from: 2500000, to: 3000000 }]),
    t(5, 'Card E', [{ field: 'apr', from: 2000, to: 1900 }]),
  ]);
  assert.deepEqual(items.map((i) => [i.key, i.ref, i.title, i.tile]), [
    ['terms:apr', '25:2026-10-17', 'APR up 0.25% on 3 cards', null],
    ['terms:4', '2026-10-13', 'Card D: limit $25,000.00 → $30,000.00', null],
    ['terms:5', '2026-10-13', 'Card E: APR 20.00% → 19.00%', null],
  ]);
  assert.equal(items[0].subtitle, 'The same move on each: Card A, Card B +1 more');
  assert.deepEqual(termsItems(), []);
});

test('a terms notice: one item for cards that got the same one, urgent the week before its reject-by date (D350)', () => {
  const n = (id, name) => ({ account_id: id, account_name: name, mask: null, effective_on: '2026-11-12', reject_by: '2026-11-11', points: ['Balance Transfer 5% of the amount of each transaction', 'Cash Advance'] });
  const [item] = noticeItems([n(1, 'Card A'), n(2, 'Card B')], '2026-10-26');
  assert.deepEqual([item.key, item.ref, item.title, item.urgent, item.tile], ['notice:1+2', '2026-11-12', 'Card A and Card B: terms change Nov 12', false, null]);
  assert.equal(item.subtitle, 'Balance Transfer 5% of the amount of each transaction · Cash Advance · reject by Nov 11');
  assert.equal(noticeItems([n(1, 'Card A')], '2026-11-06')[0].urgent, true);
  const after = noticeItems([n(1, 'Card A')], '2026-11-20')[0];
  assert.deepEqual([after.title, after.urgent, after.subtitle.includes('reject')], ['Card A: terms changed Nov 12', false, false]);
});

test('every unpaid bill from its statement on, a card near its limit, and a spending jump (D361)', () => {
  const live = {
    card_payments_due: [
      { account_id: 16, account_name: 'Gold', mask: '5112', status: 'due', due_date: '2026-11-17', days_left: 22, remaining_cents: 494836, minimum_remaining_cents: 5000 },
      { account_id: 14, account_name: 'Apple', mask: '5113', status: 'due_soon', due_date: '2026-10-31', days_left: 5, remaining_cents: 12269 },
    ],
    card_high_use: [
      { account_id: 10, account_name: 'Visa', mask: '5109', period_end: '2026-10-13', used_cents: 2960898, limit_cents: 3000000, pct: 99, manual: false },
      { account_id: 14, account_name: 'Apple', mask: '5113', period_end: '2026-09-30', used_cents: 400000, limit_cents: 1150000, pct: 35, manual: true },
    ],
    card_spend_jumps: [{ account_id: 16, account_name: 'Gold', mask: '5112', period_end: '2026-10-25', spend_cents: 506414, usual_cents: 108272, ratio: 4.7 }],
    overdue_statements: [], missed_recurring: [], new_recurring: [], pending_review: [], payments_unknown: [],
  };
  const items = needsYou(live, '2026-10-26');
  assert.deepEqual(items.map((i) => [i.kind, i.title]), [
    ['pay_soon', 'Pay Apple ··5113'],
    ['usage', 'Visa ··5109: 99% of its limit used'],
    ['usage', 'Apple ··5113: 35% of your limit used'],
    ['pay_upcoming', 'Pay Gold ··5112'],
    ['spend', 'Gold ··5112: spending 4.7× usual'],
  ]);
  assert.equal(items.find((i) => i.kind === 'usage').urgent, true, '90% and over is urgent');
  assert.equal(items.find((i) => i.kind === 'pay_upcoming').cents, 494836);
  assert.match(items.find((i) => i.kind === 'pay_upcoming').subtitle, /^Due Nov 17 · in 22 days · min \$50\.00$/);
  assert.equal(tiles(items).pay.count, 2, 'a bill weeks out still counts toward what to pay');
  assert.equal(clearedTitle({ type: 'CARD_HIGH_USE', title: 'Visa ···5109 at 99% of its limit' }), 'Back under 30% · Visa ···5109');
});
