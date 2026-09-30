import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changesBetween } from './changes.js';

test('changesBetween: records from and to for a field that changed', () => {
  assert.deepEqual(
    changesBetween({ category_id: 12, merchant: 'Costco' }, { category_id: 35, merchant: 'Costco' }, ['category_id']),
    { category_id: { from: 12, to: 35 } }
  );
});

test('changesBetween: a field sent but unchanged is left out', () => {
  assert.deepEqual(changesBetween({ name: 'Tesla' }, { name: 'Tesla' }, ['name']), {});
});

test('changesBetween: null and missing both read as null, so clearing a field shows as X → null', () => {
  assert.deepEqual(changesBetween({ nickname: 'Suji' }, { nickname: null }, ['nickname']), {
    nickname: { from: 'Suji', to: null },
  });
  assert.deepEqual(changesBetween({}, { nickname: null }, ['nickname']), {});
});

test('changesBetween: arrays and dates compare by value, not identity', () => {
  assert.deepEqual(changesBetween({ days: [1, 15] }, { days: [1, 15] }, ['days']), {});
  assert.deepEqual(changesBetween({ days: [1] }, { days: [1, 15] }, ['days']), { days: { from: [1], to: [1, 15] } });
});
