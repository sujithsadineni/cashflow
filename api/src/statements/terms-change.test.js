import { test } from 'node:test';
import assert from 'node:assert/strict';
import { termsChanges } from './terms-change.js';

test('an APR and a limit that moved are both reported, with before and after', () => {
  assert.deepEqual(termsChanges({ apr_purchase_bps: 2774, credit_limit_cents: '3000000' }, { apr_purchase_bps: 2749, credit_limit_cents: '2500000' }), [
    { field: 'apr', from: 2749, to: 2774 },
    { field: 'limit', from: 2500000, to: 3000000 },
  ]);
});

test('nothing changed, or a figure one statement didn\'t print, is no change', () => {
  assert.deepEqual(termsChanges({ apr_purchase_bps: 2774, credit_limit_cents: 500000 }, { apr_purchase_bps: 2774, credit_limit_cents: 500000 }), []);
  assert.deepEqual(termsChanges({ apr_purchase_bps: 3500, credit_limit_cents: null }, { apr_purchase_bps: 3500, credit_limit_cents: 500000 }), []);
  assert.deepEqual(termsChanges({ apr_purchase_bps: 3500 }, null), []);
});
