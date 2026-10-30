import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statementAccounts, silentAccounts } from './review-lists.js';

test('statements by account: missing first, then off, with a one-line summary (D319)', () => {
  const view = {
    upload: [{ account_id: 17, name: 'Frontier', mask: '5111', cycles: [{ start: '2025-01-06', end: '2025-02-05', facts: [] }] }],
    problems: [{ account_id: 5, name: 'Apple', mask: '5113', problem: { reason: 'Two statements overlap' } }],
  };
  const statements = [
    { batch_id: 1, account_name: 'Frontier', period_end: '2025-06-05', tally: { diff_cents: 33794 }, hint: { kind: 'missing_out' } },
    { batch_id: 2, account_name: 'Bilt', period_end: '2025-06-05', tally: { diff_cents: -250 }, hint: { kind: 'small' } },
  ];
  const rows = statementAccounts({ view, statements, accountIdByName: (n) => ({ Frontier: 17, Bilt: 3 })[n] ?? null });
  assert.deepEqual(rows.map((r) => [r.name, r.summary]), [
    ['Frontier', '1 missing · $337.94 off'],
    ['Apple', '1 saved wrong'],
    ['Bilt', '1 small gap'],
  ]);
  assert.equal(rows[0].id, 'a17');
});

test('silent months by card: to answer first, newest first', () => {
  const cy = (end) => ({ start: `${end.slice(0, 8)}01`, end });
  const rows = silentAccounts({
    ask: [{ account_id: 2, name: 'Cash Magnet', mask: '5104', cycle: cy('2025-07-08') }],
    silent: [{ account_id: 2, name: 'Cash Magnet', mask: '5104', months: [cy('2025-03-08'), { ...cy('2026-06-08'), answered: true }] }, { account_id: 9, name: 'Frontier', mask: '5111', months: [cy('2026-08-05')] }],
  });
  assert.deepEqual(rows.map((r) => [r.name, r.summary]), [['Cash Magnet', '1 to answer · 2 silent months'], ['Frontier', '1 silent month']]);
  assert.deepEqual(rows[0].quiet.map((q) => [q.month, q.answered]), [['Jun 2026', true], ['Mar 2025', false]]);
});
