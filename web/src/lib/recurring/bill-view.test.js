import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cadenceLine, sections, statusLine, priceNote, monthTotals } from './bill-view.js';

const bill = (o) => ({ id: o.id ?? 1, name: o.name ?? 'Bill', cadence: 'MONTHLY', match_days_of_month: [25], state: 'due', monthly_cents: 1000, ...o });

test('the cadence and the line that says where a bill stands (D316)', () => {
  assert.equal(cadenceLine(bill({})), 'Monthly · on the 25th');
  assert.equal(cadenceLine(bill({ cadence: 'WEEKLY' })), 'Weekly');
  assert.deepEqual(statusLine(bill({ state: 'late', until: -23 }), '2026-10'), { text: '23 days late', tone: 'spend' });
  assert.deepEqual(statusLine(bill({ until: 7, month: { occurrences: [{ state: 'due', date: '2026-10-25' }] } }), '2026-10'), { text: 'Due Oct 25 · in 7 days', tone: 'ink' });
  assert.deepEqual(statusLine(bill({ month: { occurrences: [{ state: 'paid', charge: { date: '2026-10-07' } }] } }), '2026-10'), { text: 'Paid Oct 7', tone: 'muted' });
  assert.deepEqual(statusLine(bill({ state: 'paused' }), '2026-10'), { text: 'Paused', tone: 'muted' });
});

test('sections: late only this month, paused and ended together, empty ones left out', () => {
  const bills = [
    bill({ id: 1, name: 'A', state: 'late', month: { status: 'missed' } }),
    bill({ id: 2, name: 'B', next_date: '2026-10-20', month: { status: 'due' } }),
    bill({ id: 3, name: 'C', state: 'paused' }),
  ];
  assert.deepEqual(sections(bills, '2026-10', '2026-10').map((s) => [s.label, s.bills.map((b) => b.name)]), [['Late', ['A']], ['Due in October', ['B']], ['Paused and ended', ['C']]]);
  assert.deepEqual(sections(bills, '2026-09', '2026-10').map((s) => s.label), ['Due in September', 'Missed in September', 'Paused and ended']);
});

test('a price change shows for six months; the month adds up the live bills', () => {
  const changed = bill({ price_change: { from_cents: 1549, to_cents: 1799, since: '2026-08-01' } });
  assert.deepEqual(priceNote(changed, '2026-10-18'), { text: 'Up $2.50 since Aug 1', up: true });
  assert.equal(priceNote({ price_change: { from_cents: 1, to_cents: 2, since: '2025-01-01' } }, '2026-10-18'), null);
  const t = monthTotals([bill({ month: { paid_cents: -500, due_cents: -300, status: 'due' } }), bill({ state: 'ended', monthly_cents: 9999 })]);
  assert.deepEqual(t, { count: 1, monthly_cents: 1000, paid_cents: 500, due_cents: 300, missed: 0 });
});
