import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stagedRowFrom } from './pdf-local.js';

test('a staged row keeps who spent it on a shared card (D344)', () => {
  const row = stagedRowFrom({ posted_date: '2026-07-02', description: 'GROCER 12', amount_cents: -1200, txn_type: 'purchase', suggested_category: 'Groceries', confidence: 'HIGH', raw_text: 'x', spender_name: 'JORDAN LEE', card_ending: '1234' }, ['Groceries']);
  assert.equal(row.spender_name, 'JORDAN LEE');
  assert.equal(row.card_ending, '1234');
  assert.equal(row.suggested_category, 'Groceries');
  assert.equal(stagedRowFrom({ description: 'A', amount_cents: -1 }, []).spender_name, null);
});
