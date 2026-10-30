import { test } from 'node:test';
import assert from 'node:assert/strict';
import { costLabel, describeAnswer, describeLookup, monthLabel } from './answer-text.js';

// A stand-in for formatMoney: whole dollars, enough to read the sentences.
const money = (c) => `$${c / 100}`;
const rent = [{ kind: 'category', name: 'Rent', id: 1 }];
const period = (label, net, extra = {}) => ({ label, net_cents: net, paid_cents: net, back_cents: 0, back_count: 0, count: 2, ...extra });

test('a total says paid, got back and net when shares came back', () => {
  const d = describeAnswer({ intent: 'total', subjects: rent, periods: [period('2026 so far', 30000, { paid_cents: 50000, back_cents: 20000, back_count: 1 })], notes: [] }, money);
  assert.equal(d.headline, 'Rent, 2026 so far: $300');
  assert.deepEqual(d.lines, ['Paid $500, got back $200 in 1 refund.', '2 payments.']);
  assert.match(d.how, /category Rent; money out less refunds/);
});

test('nothing spent is said in words, not $0', () => {
  const d = describeAnswer({ intent: 'total', subjects: [], periods: [period('Oct 2026 so far', 0, { count: 0 })], notes: [] }, money);
  assert.equal(d.headline, 'All spending, Oct 2026 so far: nothing spent');
});

test('compare: both figures, then up or down by how much', () => {
  const d = describeAnswer({ intent: 'compare', subjects: rent, periods: [period('Oct', 15000), period('Sep', 10000)], notes: [] }, money);
  assert.equal(d.headline, 'Rent: $150 in Oct, $100 in Sep');
  assert.deepEqual(d.lines, ['Up $50 (50%).']);
  assert.deepEqual(describeAnswer({ intent: 'compare', subjects: rent, periods: [period('a', 0), period('b', 0)], notes: [] }, money).lines, ['The same in both.']);
});

test('by month: an average and the biggest month', () => {
  const months = [{ month: '2026-01', net_cents: 10000 }, { month: '2026-02', net_cents: -2000 }, { month: '2026-03', net_cents: 22000 }];
  const d = describeAnswer({ intent: 'by_month', subjects: rent, periods: [period('Jan–Mar 2026', 30000)], months, notes: [] }, money);
  assert.ok(d.lines.includes('About $100 a month over 3 months.'));
  assert.ok(d.lines.includes('Most in Mar: $220.'));
  assert.equal(monthLabel('2026-11'), 'Nov');
});

test('notes: nothing saved after a day, and other meanings of a word', () => {
  const d = describeAnswer({ intent: 'top', top: { of: 'merchants', items: [] }, subjects: [], periods: [period('Sep 2026', 0)],
    notes: [{ kind: 'after_latest', latest: '2026-10-13' }, { kind: 'also', word: 'power', options: ['A', 'B'] }] }, money);
  assert.equal(d.headline, 'Top merchants, Sep 2026');
  assert.deepEqual(d.notes, ['Nothing is saved after Oct 13: statements since then aren\'t in yet.', '“power” could also mean A, B.']);
});

test('compare with a period whose statements aren\'t in yet says so, not "down 100%"', () => {
  const d = describeAnswer({ intent: 'compare', subjects: rent, notes: [{ kind: 'after_latest', latest: '2026-10-13' }],
    periods: [period('Oct 2026 so far', 0, { to: '2026-10-23', count: 0 }), period('Sep 2026', 12000, { to: '2026-09-30' })] }, money);
  assert.deepEqual(d.lines, ["Nothing saved for Oct 2026 so far yet, so there's nothing to compare."]);
});

test('an Ask Claude answer: its cost and what it looked up, in words', () => {
  assert.deepEqual([costLabel(4_000), costLabel(26_000), costLabel(1_234_000), costLabel(null)], ['under 1¢', 'about 3¢', 'about 123¢', null]);
  assert.equal(describeLookup({ tool: 'find_names', input: { text: 'power' } }), 'Looked for names with “power”');
  assert.equal(describeLookup({ tool: 'spending', input: { subjects: [{ name: 'Rent' }] }, result: { periods: [{ label: '2026 so far' }] } }), 'Spending: Rent, 2026 so far');
  assert.equal(describeLookup({ tool: 'spending', input: { subjects: [], periods: [{ from: '2027-01-01', to: '2027-02-01' }] }, error: 'A period starts after today' }),
    'Spending: all spending, 2027-01-01 to 2027-02-01 (A period starts after today)');
});
