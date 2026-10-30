import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPeriods, previousPeriod, monthsIn, periodBetween, yearToDate } from './periods.js';

const today = '2026-10-23';
const read = (text) => findPeriods(text, today).map((p) => [p.from, p.to, p.label]);

test('this month, last month, this year, last year', () => {
  assert.deepEqual(read('utilities this month'), [['2026-10-01', '2026-10-23', 'Oct 2026 so far']]);
  assert.deepEqual(read('rent last month'), [['2026-09-01', '2026-09-30', 'Sep 2026']]);
  assert.deepEqual(read('rent ytd'), [['2026-01-01', '2026-10-23', '2026 so far']]);
  assert.deepEqual(read('how much so far this year'), [['2026-01-01', '2026-10-23', '2026 so far']], 'one period, not two');
  assert.deepEqual(read('groceries last year'), [['2025-01-01', '2025-12-31', '2025']]);
});

test('named months and years: a month later than this one means last year', () => {
  assert.deepEqual(read('dining in march'), [['2026-03-01', '2026-03-31', 'Mar 2026']]);
  assert.deepEqual(read('dining in december'), [['2025-12-01', '2025-12-31', 'Dec 2025']]);
  assert.deepEqual(read('sept 2024 fuel'), [['2024-09-01', '2024-09-30', 'Sep 2024']]);
  assert.deepEqual(read('rent 2025'), [['2025-01-01', '2025-12-31', '2025']]);
  assert.deepEqual(read('rent in 2026'), [['2026-01-01', '2026-10-23', '2026 so far']]);
  assert.deepEqual(read('what may i spend'), [], '"may" the verb is not May');
  assert.deepEqual(read('fuel in may'), [['2026-05-01', '2026-05-31', 'May 2026']]);
  assert.deepEqual(read('a market trip'), [], 'no month inside a word');
});

test('spans: since, last N months (full months before this one), last N days, same month last year', () => {
  assert.deepEqual(read('rent since march'), [['2026-03-01', '2026-10-23', 'since Mar 2026']]);
  assert.deepEqual(read('fuel last 3 months'), [['2026-07-01', '2026-09-30', 'Jul–Sep 2026']]);
  assert.deepEqual(read('fuel past six months'), [['2026-04-01', '2026-09-30', 'Apr–Sep 2026']]);
  assert.deepEqual(read('dining last 30 days'), [['2026-09-24', '2026-10-23', 'last 30 days']]);
  assert.deepEqual(read('dining this month vs same month last year'), [
    ['2026-10-01', '2026-10-23', 'Oct 2026 so far'],
    ['2025-10-01', '2025-10-31', 'Oct 2025'],
  ], '"last year" is not read again inside "same month last year"');
});

test('two periods come back in the order written', () => {
  assert.deepEqual(read('last month vs this month').map((p) => p[2]), ['Sep 2026', 'Oct 2026 so far']);
});

test('previousPeriod: like for like', () => {
  const [oct] = findPeriods('this month', today);
  assert.deepEqual(previousPeriod(oct, today), { from: '2026-09-01', to: '2026-09-23', label: 'Sep 2026 to the 23rd' });
  const [sep] = findPeriods('last month', today);
  assert.deepEqual(previousPeriod(sep, today), { from: '2026-08-01', to: '2026-08-31', label: 'Aug 2026' });
  assert.deepEqual(previousPeriod(yearToDate(today), today), { from: '2025-01-01', to: '2025-10-23', label: '2025 to Oct 23' });
  const [y25] = findPeriods('2025', today);
  assert.equal(previousPeriod(y25, today).label, '2024');
  const [days] = findPeriods('last 30 days', today);
  assert.deepEqual([previousPeriod(days, today).from, previousPeriod(days, today).to], ['2026-08-25', '2026-09-23']);
});

test('monthsIn lists every month a period touches', () => {
  assert.deepEqual(monthsIn({ from: '2025-11-15', to: '2026-02-03' }), ['2025-11', '2025-12', '2026-01', '2026-02']);
});

test('periodBetween labels a whole year or month as usual, a span by its ends, clipped to today', () => {
  assert.equal(periodBetween('2025-01-01', '2025-12-31', today).label, '2025');
  assert.deepEqual(periodBetween('2026-10-01', '2026-10-31', today), { from: '2026-10-01', to: '2026-10-23', label: 'Oct 2026 so far' });
  assert.equal(periodBetween('2026-03-05', '2026-04-20', today).label, 'Mar 5 – Apr 20, 2026');
  assert.equal(periodBetween('2026-09-01', '2026-12-15', today).label, 'Sep 1 – Oct 23, 2026 so far');
  assert.equal(periodBetween('2027-01-01', '2027-02-01', today), null);
  assert.equal(periodBetween('2026-01-01', '2026-10-23', today).label, '2026 so far', 'Jan 1 to today reads as this year so far');
  assert.equal(periodBetween('2026-10-01', '2026-10-23', today).label, 'Oct 2026 so far');
  assert.equal(periodBetween('2025-12-31', '2025-01-01', today).label, '2025', 'ends in either order');
});
