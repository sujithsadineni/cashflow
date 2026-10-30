import { test } from 'node:test';
import assert from 'node:assert/strict';
import { giftCardForm, giftCardBody, giftCardSub, localToday } from './gift-card-form.js';

const filled = (over) => ({ ...giftCardForm(null, '2026-03-02'), account_id: '4', brand: ' Bookshop ', value: '25.00', ...over });

test('a new form starts today, in dollars, empty', () => {
  assert.deepEqual(giftCardForm(null, '2026-03-02'), { account_id: '', redeemed_on: '2026-03-02', brand: '', value: '', costIn: 'dollars', cost: '', note: '' });
  assert.match(localToday(new Date(2026, 0, 5)), /^2026-01-05$/);
});

test('an existing gift card fills the form from its cents, points when that is all it cost', () => {
  const f = giftCardForm({ account_id: 4, redeemed_on: '2026-03-02', brand: 'Bookshop', value_cents: 2500, rewards_used_cents: null, points_used: 2000, note: null });
  assert.deepEqual([f.account_id, f.value, f.costIn, f.cost], ['4', '25.00', 'points', '2000']);
  assert.equal(giftCardForm({ value_cents: 2500, rewards_used_cents: 2000 }).cost, '20.00');
});

test('the body: cents, trimmed, dollars or points, never both', () => {
  assert.deepEqual(giftCardBody(filled({ cost: '20' })).body,
    { account_id: 4, redeemed_on: '2026-03-02', brand: 'Bookshop', value_cents: 2500, rewards_used_cents: 2000, points_used: null, note: null });
  assert.deepEqual([giftCardBody(filled({ costIn: 'points', cost: '2,500' })).body.points_used, giftCardBody(filled({ costIn: 'points', cost: '2,500' })).body.rewards_used_cents], [2500, null]);
  assert.equal(giftCardBody(filled({ cost: '' })).body.rewards_used_cents, null, 'what it cost is optional');
});

test('the first thing missing is named, with its field', () => {
  assert.equal(giftCardBody(filled({ account_id: '' })).field, 'account_id');
  assert.equal(giftCardBody(filled({ brand: '  ' })).field, 'brand');
  assert.equal(giftCardBody(filled({ value: '0' })).field, 'value');
  assert.equal(giftCardBody(filled({ costIn: 'points', cost: '1.5' })).field, 'cost');
});

test('the line under it: cost and what came on top', () => {
  assert.deepEqual(giftCardSub({ value_cents: 2500, rewards_used_cents: 2000, points_used: null }), { cost_cents: 2000, points: null, extra_cents: 500 });
  assert.deepEqual(giftCardSub({ value_cents: 2500, rewards_used_cents: null, points_used: 2500 }), { cost_cents: null, points: '2,500 points', extra_cents: null });
});
