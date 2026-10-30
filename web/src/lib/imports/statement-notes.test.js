import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statementNotes, notesSoFar } from './statement-notes.js';

const fmt = { money: (c) => `$${c}`, date: (d) => d, mask: (n) => n, apr: (b) => `${b}bps` };
const row = (id, extra = {}) => ({ id, amount_cents: -100, txn_type: 'purchase', review_status: 'PENDING', confidence: 'HIGH', posted_date: '2026-09-01', ...extra });

test('a quiet statement still says something calm', () => {
  const notes = statementNotes({ rows: [row(1)], summary: { closing_cents: 100, spend_cents: -10500 }, tally: { status: 'match' },
    context: { credit_limit_cents: 10000, apr_purchase_bps: 2874, previous: { credit_limit_cents: 10000, apr_purchase_bps: 2874, total_spend_cents: 10000 } } }, fmt);
  assert.deepEqual(notes.map((n) => [n.key, n.tone, n.text]), [
    ['steady', 'info', 'Limit and APR unchanged'],
    ['spend', 'info', 'Spending steady vs last statement'],
    ['tally', 'earn', 'Adds up to the cent'],
  ]);
  assert.deepEqual(statementNotes(null, fmt), []);
  assert.deepEqual(statementNotes({ rows: [], summary: {}, context: {} }, fmt), [], 'nothing known, nothing said');
});

test('new charges against last time, and payments not matched yet', () => {
  const up = statementNotes({ rows: [], summary: { spend_cents: -14000 }, context: { previous: { total_spend_cents: 10000 }, unmatched_payments: [4, 5] } }, fmt);
  assert.deepEqual(up.map((n) => [n.tone, n.text, n.at]), [
    ['warn', 'Spending up 40% vs last statement', 'summary'],
    ['warn', '2 payments not matched to a bank yet', 4],
  ]);
  const down = statementNotes({ rows: [], summary: { spend_cents: 7000 }, context: { previous: { total_spend_cents: -10000 } } }, fmt);
  assert.deepEqual(down.map((n) => [n.tone, n.text]), [['earn', 'Spending down 30% vs last statement']]);
});

test('the limit and APR against the statement before, and high use', () => {
  const notes = statementNotes({ rows: [], summary: { closing_cents: 8300 }, context: { credit_limit_cents: 10000, apr_purchase_bps: 2874, previous: { credit_limit_cents: 8000, apr_purchase_bps: 2849 } } }, fmt);
  assert.deepEqual(notes.map((n) => [n.key, n.tone, n.text]), [
    ['limit', 'earn', 'Limit raised to $10000 (was $8000)'],
    ['usage', 'warn', '83% of the limit used'],
    ['apr', 'warn', 'APR up to 2874bps (was 2849bps)'],
  ]);
  assert.ok(notes.every((n) => n.at === 'summary'));
});

test('who paid it, one note per bank, appearing at its row', () => {
  const ctx = { payments: [
    { row_id: 7, account: { issuer: 'Bank of America', mask: '1111' } },
    { row_id: 8, account: { issuer: 'SoFi', mask: '2222' } },
    { row_id: 9, account: { issuer: 'SoFi', mask: '2222' } },
  ] };
  const notes = statementNotes({ rows: [], summary: {}, context: ctx }, fmt);
  assert.deepEqual(notes.map((n) => [n.text, n.at]), [['Paid from Bank of America ··1111', 7], ['Paid from SoFi ··2222 ×2', 8]]);
});

test('interest, fees, terms, address, plans, rewards, names, checks and the tally', () => {
  const rows = [row(1, { txn_type: 'interest', amount_cents: -1250 }), row(2, { txn_type: 'fee', amount_cents: -9500 }), row(3, { duplicate_of_id: 44 })];
  const notes = statementNotes({
    rows,
    summary: { cashback_cents: 412 },
    tally: { status: 'mismatch', diff_cents: -300 },
    context: {
      terms_notice: { effective_on: '2026-11-12', reject_by: '2026-11-11', points: ['Balance transfer fee 5%'] },
      address_changed: true,
      plans: [{ remaining_cents: 0 }, { remaining_cents: 580 }],
      proposed: [{ printed_name: 'J LEE', card_ending: '2222', rows: 3 }],
    },
  }, fmt);
  assert.deepEqual(notes.map((n) => n.text), [
    'Interest charged: $1250',
    'Fee charged: $9500',
    'Terms change 2026-11-12 · reject by 2026-11-11',
    'New mailing address',
    'Plan still running: $580 left',
    '$412 in rewards earned',
    'Who is J LEE ··2222? 3 rows',
    '1 line to check',
    'Off by $300: a line may be missing',
  ]);
  assert.deepEqual(notes.find((n) => n.key === 'interest').target, { row: 1 });
  assert.ok(notes.every((n) => n.emoji), 'each led by an emoji');
});

test('notes appear as the reading reaches them', () => {
  const notes = [{ key: 'a', at: 'summary' }, { key: 'b', at: 5 }, { key: 'c', at: 'end' }];
  const keys = (o) => notesSoFar(notes, o).map((n) => n.key);
  assert.deepEqual(keys({ summaryRead: false, landed: new Set(), ended: false }), []);
  assert.deepEqual(keys({ summaryRead: true, landed: new Set([5]), ended: false }), ['a', 'b']);
  assert.deepEqual(keys({ summaryRead: true, landed: new Set(), ended: true }), ['a', 'b', 'c']);
});

test('high use against the limit the household set, when the statement prints none', () => {
  const notes = statementNotes({ rows: [], summary: { closing_cents: 6000 }, context: { credit_limit_cents: null, credit_limit_manual_cents: 10000 } }, fmt);
  assert.deepEqual(notes.map((n) => n.text), ['60% of your limit used']);
});

test('a bank account: each card payment, ✅ with what it covered, ❗ until verified (D392, D394)', () => {
  const st = (balance, minimum = 3500, before = 0, next = '2026-10-21') => ({ period_end: '2026-09-21', balance_cents: balance, minimum_cents: minimum, paid_before_cents: before, next_period_end: next });
  const paid = (row_id, cents, statement) => ({ row_id, account: { name: 'Amex BCP' }, paid_cents: cents, statement });
  const context = {
    paid_cards: [
      paid(10, 102287, st(102287)),
      paid(11, 40000, st(102287)),
      paid(12, 3500, st(102287)),
      paid(13, 62287, st(102287, 3500, 40000)),
      paid(14, 110000, st(102287)),
      paid(15, 20000, st(102287, 3500, 102287)),
      paid(16, 5000, st(-1200)),
      paid(18, 72000, st(0, null, 0, null)),
      paid(17, 61880, null),
    ],
    unverified_card_payments: [{ row_id: 20, name: 'Barclaycard', paid_cents: 72000 }],
  };
  const notes = statementNotes({ rows: [], summary: {}, context }, fmt);
  assert.deepEqual(notes.map((n) => [n.emoji, n.text, n.at]), [
    ['✅', 'Paid Amex BCP · Sep balance in full', 10],
    ['✅', 'Paid Amex BCP · $40000 of $102287 Sep balance', 11],
    ['✅', 'Paid Amex BCP · Sep minimum only', 12],
    ['✅', 'Paid Amex BCP · rest of Sep balance', 13],
    ['✅', 'Paid Amex BCP · Sep balance + $7713 more', 14],
    ['✅', 'Paid Amex BCP · $20000 early, toward Oct statement', 15],
    ['✅', 'Paid Amex BCP · $5000 early, toward Oct statement', 16],
    ['✅', 'Paid Amex BCP · $72000 early, nothing owed yet', 18],
    ['✅', 'Paid Amex BCP · $61880', 17],
    ['❗', 'Barclaycard $72000 not verified yet', 20],
  ]);
  // Once a card statement verifies it, the server lists it as paid instead: the ❗ becomes a ✅.
  const later = statementNotes({ rows: [], summary: {}, context: { paid_cards: [{ ...paid(20, 72000, st(72000)), account: { name: 'Barclays View' } }] } }, fmt);
  assert.deepEqual(later.map((n) => [n.emoji, n.text]), [['✅', 'Paid Barclays View · Sep balance in full']]);
});
