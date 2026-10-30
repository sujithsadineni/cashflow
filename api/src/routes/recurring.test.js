import { test } from 'node:test';
import assert from 'node:assert/strict';

test('a bill\'s year cost and its latest price change, from its own charges (D316)', async () => {
  const { chargeFacts } = await import('./recurring.js');
  const c = (posted_date, cents) => ({ posted_date, amount_cents: -cents });
  const facts = chargeFacts([c('2025-06-01', 1549), c('2025-11-01', 1549), c('2026-03-01', 1799), c('2026-04-01', 1799)], '2026-10-18');
  assert.deepEqual(facts.price_change, { from_cents: 1549, to_cents: 1799, since: '2026-03-01' });
  assert.equal(facts.year_cents, 1549 + 1799 + 1799);
  // A one-off odd charge after the change isn't a new price.
  assert.equal(chargeFacts([c('2026-01-01', 1000), c('2026-02-01', 1200), c('2026-03-01', 1000)], '2026-10-18').price_change, null);
  // A cent or under a percent is a wobble, not a change.
  assert.equal(chargeFacts([c('2026-01-01', 10000), c('2026-02-01', 10050)], '2026-10-18').price_change, null);
});

test('a bill\'s average a month is since it was first seen, not over twelve months (D365)', async () => {
  const { chargeFacts } = await import('./recurring.js');
  const c = (posted_date, cents) => ({ posted_date, amount_cents: -cents });
  const facts = chargeFacts([c('2026-05-11', 20000), c('2026-05-17', 20000), c('2026-07-06', 20000), c('2026-07-31', 40000), c('2026-09-08', 2556)], '2026-10-27');
  assert.deepEqual([facts.since, facts.total_cents, facts.avg_monthly_cents], ['2026-05-11', 102556, Math.round(102556 / 5)]);
  assert.equal(chargeFacts([], '2026-10-27').avg_monthly_cents, null);
});

test('a bill paid by hand has ten days\' grace before it is late (D365)', async () => {
  const { billStatus } = await import('../money/bills.js');
  const base = { status: 'ACTIVE', cadence: 'MONTHLY', expected_amount_cents: -2556, match_days_of_month: [8] };
  const charges = [{ posted_date: '2026-09-08' }];
  assert.equal(billStatus({ ...base, amount_varies: false }, charges, '2026-10-15').state, 'late');
  assert.equal(billStatus({ ...base, amount_varies: true }, charges, '2026-10-15').state, 'due');
  assert.equal(billStatus({ ...base, amount_varies: true }, charges, '2026-10-19').state, 'late');
});
