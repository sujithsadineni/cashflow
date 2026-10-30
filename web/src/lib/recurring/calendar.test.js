import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthGrid, shiftMonth, billMarks, billTabs } from './calendar.js';

test('the month as weeks, Sunday first (D321)', () => {
  const cells = monthGrid('2026-10');
  assert.equal(cells.length % 7, 0);
  assert.deepEqual(cells.slice(0, 5), [null, null, null, null, '2026-10-01']); // Oct 1, 2026 is a Thursday
  assert.equal(cells.filter(Boolean).length, 31);
  assert.deepEqual([shiftMonth('2026-01', -1), shiftMonth('2026-12', 1)], ['2025-12', '2027-01']);
});

test('each charge on its day: paid, upcoming, waiting (blinks), missed', () => {
  const bill = (id, occ, extra = {}) => ({ id, name: `B${id}`, match_name_contains: `b${id}`, expected_amount_cents: -500, state: 'due', month: { occurrences: occ }, ...extra });
  const marks = billMarks([
    bill(1, [{ date: '2026-10-07', state: 'paid', charge: { date: '2026-10-08', amount_cents: -2150 } }]),
    bill(2, [{ date: '2026-10-20', state: 'due' }]),
    bill(3, [{ date: '2026-10-09', state: 'due' }]),
    bill(4, [{ date: '2026-10-01', state: 'missed' }]),
    bill(5, [{ date: '2026-10-02', state: 'due' }], { state: 'paused' }),
  ], '2026-10-18');
  assert.deepEqual(marks.get('2026-10-08').map((m) => [m.state, m.cents]), [['paid', 2150]]);
  assert.equal(marks.get('2026-10-20')[0].state, 'upcoming');
  assert.equal(marks.get('2026-10-09')[0].state, 'waiting');
  assert.equal(marks.get('2026-10-01')[0].state, 'missed');
  assert.equal(marks.has('2026-10-02'), false, 'a paused bill isn\'t on the calendar');
});

test('the tabs: due, later, paid, late, paused and ended', () => {
  const t = billTabs([
    { id: 1, name: 'A', state: 'due', month: { status: 'due' }, next_date: '2026-10-20' },
    { id: 2, name: 'B', state: 'upcoming', month: { status: 'paid' } },
    { id: 3, name: 'C', state: 'late', month: { status: 'missed' } },
    { id: 4, name: 'D', state: 'paused' },
    { id: 5, name: 'E', state: 'upcoming', month: { status: 'none' } },
  ], '2026-10', '2026-10');
  assert.deepEqual(Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v.map((b) => b.name)])), { due: ['A'], later: ['E'], paid: ['B'], late: ['C'], off: ['D'] });
});
