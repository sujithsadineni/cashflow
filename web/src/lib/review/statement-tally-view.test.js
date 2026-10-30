import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statementMonths, tallyNote, tallyGlow, ytdNote } from './statement-tally-view.js';

const money = (c) => `$${(c / 100).toFixed(2)}`;

test("a card's statement stands for the month whose 15th it holds; without dates, the month it closed in", () => {
  assert.deepEqual(statementMonths({ period_start: '2026-04-26', period_end: '2026-05-25' }, true), ['2026-05']);
  assert.deepEqual(statementMonths({ period_start: '2025-11-20', period_end: '2026-01-19' }, true), ['2025-12', '2026-01']);
  assert.deepEqual(statementMonths({ period_start: '2026-04-26', period_end: '2026-05-25' }, false), ['2026-05']);
  assert.deepEqual(statementMonths({ period_start: null, period_end: '2026-05-25' }, true), ['2026-05']);
  assert.deepEqual(statementMonths({ period_end: null }, true), []);
});

test('only a statement that is off or unchecked gets a note, with the rows still waiting', () => {
  assert.equal(tallyNote({ state: 'match', diff_cents: 0 }, money), null);
  assert.equal(tallyNote(null, money), null);
  assert.deepEqual(tallyNote({ state: 'off', diff_cents: -25000, pending_count: 2, pending_cents: -25000 }, money),
    { tone: 'off', title: "Doesn't add up: off by $250.00 · 2 rows ($-250.00) still waiting in the import" });
  assert.equal(tallyNote({ state: 'unread', pending_count: 0 }, money).tone, 'warn');
});

test('an off statement wins its month over an unchecked one', () => {
  const g = tallyGlow([
    { period_end: '2026-05-25', ledger_tally: { state: 'no_summary', pending_count: 0 } },
    { period_end: '2026-05-28', ledger_tally: { state: 'off', diff_cents: 100, pending_count: 0 } },
    { period_end: '2026-06-25', ledger_tally: { state: 'match', diff_cents: 0 } },
  ], { byFifteenth: false, money });
  assert.deepEqual([...g.keys()], ['2026-05']);
  assert.equal(g.get('2026-05').tone, 'off');
});

test('a statement that adds up but whose year-to-date box disagrees with its rows glows amber, saying which (D346)', () => {
  assert.equal(ytdNote({ fees: true, interest: true, gap: false }), null);
  assert.equal(ytdNote({ fees: null, interest: null, gap: true }), null, 'after a missing statement it can\'t be checked');
  assert.equal(ytdNote(null), null);
  assert.deepEqual(ytdNote({ fees: false, interest: true, gap: false }),
    { tone: 'warn', title: 'Its year-to-date fees don\'t match its fee rows: one may be missing or filed as something else' });
  const glow = tallyGlow([{ period_end: '2026-03-05', ledger_tally: { state: 'match' }, ytd_check: { fees: true, interest: false, gap: false } }], { byFifteenth: false, money: String });
  assert.equal(glow.get('2026-03').tone, 'warn');
});
