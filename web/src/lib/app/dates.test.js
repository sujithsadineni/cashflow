import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthDays, rangePresets, presetFor, rangeLabel, rangeDays, dayCount, shortDate } from './dates.js';

const TODAY = '2026-10-12';

test('presets are exact calendar ranges, relative to today', () => {
  const p = Object.fromEntries(rangePresets(TODAY).map((x) => [x.label, [x.from, x.to]]));
  assert.deepEqual(p['This month'], ['2026-10-01', '2026-10-12']);
  assert.deepEqual(p['Last month'], ['2026-09-01', '2026-09-30']);
  assert.deepEqual(p['Last 3 months'], ['2026-08-01', '2026-10-12']);
  assert.deepEqual(p['This year'], ['2026-01-01', '2026-10-12']);
  assert.deepEqual(p['Last year'], ['2025-01-01', '2025-12-31']);
  assert.deepEqual(p['All time'], ['', '']);
});

test('last month in January is December of the year before', () => {
  const last = rangePresets('2026-01-05').find((x) => x.label === 'Last month');
  assert.deepEqual([last.from, last.to], ['2025-12-01', '2025-12-31']);
});

test('a range reads as its shortcut, its dates, an open end, or any date', () => {
  assert.equal(rangeLabel('2026-09-01', '2026-09-30', TODAY), 'Last month');
  assert.equal(rangeLabel('2026-09-03', '2026-09-17', TODAY), 'Sep 3 – Sep 17');
  assert.equal(rangeLabel('2025-12-20', '2026-01-04', TODAY), 'Dec 20, 2025 – Jan 4');
  assert.equal(rangeLabel('2026-09-03', '2026-09-03', TODAY), 'Sep 3');
  assert.equal(rangeLabel('2026-09-03', '', TODAY), 'From Sep 3');
  assert.equal(rangeLabel('', '', TODAY), 'Any date');
  assert.equal(presetFor('', '', TODAY), null);
});

test('compact days and counts', () => {
  assert.equal(rangeDays('2026-09-01', '2026-09-30', TODAY), 'Sep 1–30');
  assert.equal(rangeDays('2026-08-01', '2026-10-12', TODAY), 'Aug 1 – Oct 12');
  assert.equal(rangeDays('2025-01-01', '2025-12-31', TODAY), 'Jan 1 – Dec 31, 2025');
  assert.equal(dayCount('2026-09-01', '2026-09-30'), 30);
  assert.equal(dayCount('2026-03-01', '2026-03-31'), 31); // across the DST change
  assert.equal(shortDate('2025-03-15', TODAY), 'Mar 15, 2025');
});

test('a month grid leads with the right blanks', () => {
  const { lead, days } = monthDays(new Date(2026, 8, 1)); // Sep 2026 starts on a Tuesday
  assert.equal(lead, 2);
  assert.equal(days.length, 30);
  assert.equal(days[29], '2026-09-30');
});
