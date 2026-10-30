import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readRewards } from './rewards.js';

// Each bank's real wording; the figures are invented.
test('Bank of America: every part, the figure first, a leading zero sometimes missing', () => {
  const text = 'Your Reward Summary\n1.94 Base Cash Back Earned\n3.76 Category Bonus Earned\nMake the most of your\n.63 Relationship Bonus Earned\nrewards program today!\n92.57 Cash Back Redeemed\n6.33 Total Cash Back Available';
  assert.deepEqual(readRewards(text), {
    rewards: { base_cents: 194, bonus_cents: 376, relationship_cents: 63, redeemed_cents: 9257, available_cents: 633 },
    cashback_earned_cents: 633,
  });
});

test('a month with only some parts earns their sum', () => {
  assert.deepEqual(readRewards('.45 Base Cash Back Earned\n.90 Category Bonus Earned\n1.49 Total Cash Back Available'), {
    rewards: { base_cents: 45, bonus_cents: 90, available_cents: 149 }, cashback_earned_cents: 135,
  });
});

test('a trailing minus is cash back taken back', () => {
  assert.equal(readRewards('.25- Base Cash Back Earned\n.62 Category Bonus Earned\n17.66 Total Cash Back Available').cashback_earned_cents, 37);
});

test('Frontier: miles in miles, never dollars', () => {
  assert.deepEqual(readRewards('Miles Summary\nTotal Miles Sent to Frontier Airlines 1,966\nFor details see page 5'), {
    rewards: { miles: 1966, miles_to: 'Frontier Airlines' }, cashback_earned_cents: null,
  });
});

test('nothing printed', () => {
  assert.deepEqual(readRewards('Make the most of your rewards program today!'), { rewards: null, cashback_earned_cents: null });
});
