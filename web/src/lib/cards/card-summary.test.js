import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shareOf, totalLines } from './card-summary.js';

test("a picked category's share of money in or out, whichever way it mostly goes", () => {
  const total = { count: 215, in_cents: 11943554, out_cents: 11789019 };
  assert.deepEqual(shareOf({ in_cents: 10853955, out_cents: 0 }, total), { pct: 91, direction: 'in' });
  assert.deepEqual(shareOf({ in_cents: 0, out_cents: 3342000 }, total), { pct: 28, direction: 'out' });
  assert.equal(shareOf(null, total), null);
});

test('checking reads In / Out / Net; a card reads Spent / Paid & credits / Owed change', () => {
  const t = { count: 4, in_cents: 200000, out_cents: 33696 };
  assert.deepEqual(totalLines(t, 'CHECKING').map((l) => [l.label, l.cents]), [['In', 200000], ['Out', -33696], ['Net', 166304]]);
  const card = totalLines({ count: 3, in_cents: 5000, out_cents: 12000 }, 'CREDIT_CARD');
  assert.deepEqual(card.map((l) => [l.label, l.cents, l.tone]), [['Spent', -12000, 'spend'], ['Paid & credits', 5000, 'earn'], ['Owed change', 7000, 'spend']]);
  assert.equal(card[2].net, true);
});
