import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paidChoices, paidValue, paidAfter, PAYMENT_METHODS } from './payment-methods.js';

const read = { key: 'in_person', label: 'In person', source: 'statement', read: 'in_person' };

test('the picker starts with what the statement says, then every method', () => {
  const choices = paidChoices(read);
  assert.deepEqual(choices[0], { value: '', label: 'In person', hint: 'As its statement says' });
  assert.equal(choices.length, PAYMENT_METHODS.length + 1);
  assert.equal(paidChoices(null)[0].label, '—');
});

test('a hand pick is the picker\'s value; the statement\'s is ""', () => {
  assert.equal(paidValue(read), '');
  assert.equal(paidValue({ ...read, key: 'tap', source: 'you' }), 'tap');
  assert.equal(paidValue(null), '');
});

test('picking, and going back to the statement\'s', () => {
  const tapped = paidAfter(read, 'tap');
  assert.deepEqual(tapped, { key: 'tap', label: 'Tap', source: 'you', read: 'in_person' });
  assert.deepEqual(paidAfter(tapped, ''), read);
  assert.equal(paidAfter(null, ''), null, 'nothing printed and nothing picked');
  assert.deepEqual(paidAfter(null, 'chip'), { key: 'chip', label: 'Chip', source: 'you', read: null });
});
