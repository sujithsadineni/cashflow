import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askedLabel, isNewAnswer } from './questions.js';

const now = new Date(2026, 9, 23, 22, 0);

test('askedLabel: today and yesterday with the time, older days as a date, another year with it', () => {
  assert.equal(askedLabel(new Date(2026, 9, 23, 9, 14).toISOString(), now), 'Today 9:14 AM');
  assert.equal(askedLabel(new Date(2026, 9, 22, 20, 2).toISOString(), now), 'Yesterday 8:02 PM');
  assert.equal(askedLabel(new Date(2026, 9, 20, 12, 0).toISOString(), now), 'Oct 20');
  assert.equal(askedLabel(new Date(2025, 11, 31, 12, 0).toISOString(), now), 'Dec 31, 2025');
  assert.equal(askedLabel('not a date', now), '');
});

test('isNewAnswer: answered and never opened', () => {
  assert.equal(isNewAnswer({ status: 'answered', seen_at: null }), true);
  assert.equal(isNewAnswer({ status: 'answered', seen_at: '2026-10-23T10:00:00Z' }), false);
  assert.equal(isNewAnswer({ status: 'waiting', seen_at: null }), false);
});
