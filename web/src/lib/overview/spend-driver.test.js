import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spendDriver } from './spend-driver.js';

const row = (id, name, cents) => ({ category_id: id, name, spend_cents: -cents });

test('names the category behind most of the change, either way (D381)', () => {
  const before = [row(1, 'Shopping', 10000), row(2, 'Dining', 5000)];
  assert.equal(spendDriver([row(1, 'Shopping', 40000), row(2, 'Dining', 6000)], before), 'Shopping');
  assert.equal(spendDriver([row(1, 'Shopping', 10000), row(2, 'Dining', 1000)], before), 'Dining');
});

test('a category new this month or gone since counts', () => {
  assert.equal(spendDriver([row(1, 'Shopping', 100), row(3, 'Travel', 90000)], [row(1, 'Shopping', 100)]), 'Travel');
  assert.equal(spendDriver([row(1, 'Shopping', 100)], [row(1, 'Shopping', 100), row(3, 'Travel', 90000)]), 'Travel');
});

test('no name when the change is spread out, or there is none', () => {
  const before = [row(1, 'A', 0), row(2, 'B', 0), row(3, 'C', 0)];
  assert.equal(spendDriver([row(1, 'A', 100), row(2, 'B', 100), row(3, 'C', 100)], before), null);
  assert.equal(spendDriver([row(1, 'A', 100)], [row(1, 'A', 100)]), null);
  assert.equal(spendDriver(undefined, undefined), null);
});

test('no name when a small net change hides moves that cancel out', () => {
  const before = [row(1, 'Transfers', 90000), row(2, 'Shopping', 10000)];
  assert.equal(spendDriver([row(1, 'Transfers', 0), row(2, 'Shopping', 98500)], before), null);
});

test('measured against the card\'s own change when given', () => {
  const before = [row(1, 'Rent', 170816), row(2, 'Other', 995388)];
  const now = [row(2, 'Other', 829218)];
  assert.equal(spendDriver(now, before), 'Rent');             // half of the categories' own drop
  assert.equal(spendDriver(now, before, -447149), null);      // but well under half of the card's
});
