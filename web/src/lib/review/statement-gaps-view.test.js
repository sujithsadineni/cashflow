import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gapView, silentView, cycleMonth, cycleRange, groupAskedByCard } from './statement-gaps-view.js';

const cy = (start, end, verdict, o = {}) => ({ start, end, verdict, reasons: ['why'], answered: false, ...o });
const cards = [
  { account_id: 20, name: 'Cash Magnet Card', mask: '5104', problems: [], gaps: [
    { trailing: false, cycles: [cy('2026-05-09', '2026-06-08', 'missing'), cy('2026-06-09', '2026-07-08', 'quiet'), cy('2026-07-09', '2026-08-07', 'quiet')] },
    { trailing: true, cycles: [cy('2026-09-08', '2026-10-07', 'missing')] },
  ] },
  { account_id: 9, name: 'Blue Cash Preferred', mask: '5105', problems: [{ kind: 'overlap', reason: 'Two statements overlap' }], gaps: [
    { trailing: true, cycles: [cy('2026-09-25', '2026-10-07', 'likely_quiet'), cy('2025-03-08', '2025-04-07', 'unknown')] },
  ] },
];

test('a cycle is named by the month it closed in, with its dates', () => {
  assert.equal(cycleMonth({ start: '2026-05-09', end: '2026-06-08' }), 'Jun 2026');
  assert.equal(cycleMonth({ start: '2026-09-06', end: '2026-10-05', month: '2026-09' }), 'Sep 2026', 'the server\'s month wins');
  assert.equal(cycleMonth({ start: '2025-06-07', end: '2025-07-16', months: ['2025-06', '2025-07'] }), 'Jun – Jul 2025');
  assert.equal(cycleMonth({ start: '2025-12-07', end: '2026-01-16', months: ['2025-12', '2026-01'] }), 'Dec 2025 – Jan 2026');
  assert.equal(cycleRange({ start: '2026-05-09', end: '2026-06-08' }), 'May 9 – Jun 8');
});

test('verdicts sort into upload, ask, quiet and problems, and the count is what needs you', () => {
  const v = gapView(cards);
  assert.deepEqual(v.upload.map((u) => [u.name, u.cycles.length]), [['Cash Magnet Card', 2]]);
  assert.deepEqual(v.ask.map((a) => a.cycle.end), ['2026-10-07', '2025-04-07']);
  assert.equal(v.quiet.length, 2);
  assert.equal(v.problems[0].problem.kind, 'overlap');
  assert.equal(v.count, 2 + 1, 'the Statements tab counts uploads and problems');
  assert.equal(v.toUpload, 2);
});

test('silent months: the questions, then each card\'s silent months oldest first', () => {
  const s = silentView(cards);
  assert.equal(s.count, 2);
  assert.deepEqual(s.silent.map((c) => [c.name, c.months.map((m) => m.end)]), [['Cash Magnet Card', ['2026-07-08', '2026-08-07']]]);
});

test('unanswered cycles group into one card row, newest month first', () => {
  const grouped = groupAskedByCard(gapView(cards).ask);
  assert.deepEqual(grouped.map((c) => [c.name, c.months.length, c.months.map((m) => m.cycle.end)]), [
    ['Blue Cash Preferred', 2, ['2026-10-07', '2025-04-07']],
  ]);
});

test('a statement with no activity joins the card\'s silent months', () => {
  const withStatement = [{ ...cards[0], quiet_statements: [{ start: '2025-03-08', end: '2025-04-07', verdict: 'quiet', statement: true, reasons: ['on file'], months: ['2025-03'] }] }];
  const s = silentView(withStatement);
  assert.deepEqual(s.silent[0].months.map((m) => m.end), ['2025-04-07', '2026-07-08', '2026-08-07']);
});

test('nothing to show is an empty view', () => {
  assert.deepEqual(gapView([]), { upload: [], ask: [], problems: [], quiet: [], count: 0, toUpload: 0 });
});

test('a missing statement is named by the month it closes, as the bank names it (D307)', async () => {
  const { statementMonth, closingDate, cycleMonth } = await import('./statement-gaps-view.js');
  // Barclays' "February 2025" statement: Jan 6 – Feb 5. The 15th rule calls it January.
  const cycle = { start: '2025-01-06', end: '2025-02-05', month: '2025-01' };
  assert.equal(statementMonth(cycle), 'Feb 2025');
  assert.equal(closingDate(cycle), 'Feb 5, 2025');
  assert.equal(cycleMonth(cycle), 'Jan 2025');
});
