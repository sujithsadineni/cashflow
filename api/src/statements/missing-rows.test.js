import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missingRows } from './missing-rows.js';

const r = (posted_date, amount_cents, description = '') => ({ posted_date, amount_cents, description });

test('only what the saved rows lack, counting duplicates, ignoring zero lines', () => {
  const saved = [r('2025-01-13', -21300), r('2024-12-16', -1500), r('2026-01-31', -5323), r('2026-01-31', -5323)];
  const parsed = [
    r('2024-12-16', -50000, 'DIRECT DEPOSIT'), r('2024-12-16', -1500, 'FEE'),
    r('2025-01-13', -710000, 'DIRECT DEPOSIT'), r('2025-01-13', -21300, 'FEE'),
    r('2026-01-31', -5323), r('2026-01-31', -5323), r('2026-01-31', -5323), // a third identical one is new
    r('2025-01-13', 0, 'INTEREST CHARGED ON BALANCE TRANSFERS'),
  ];
  assert.deepEqual(missingRows(parsed, saved).map((x) => x.amount_cents), [-50000, -710000, -5323]);
});
