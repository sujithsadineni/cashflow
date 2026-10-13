import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupFindings, statementHintText } from './review-groups.js';

const f = (id, kind, cents) => ({ id, check_kind: kind, amount_cents: cents });

test('findings are grouped by tier, fix-first on top, each with what approving changes', () => {
  const tiers = groupFindings([f(1, 'category_history', -500), f(2, 'type_reward', 1000), f(3, 'amount_sign', 2000000), f(4, 'type_reward', 539)]);
  assert.deepEqual(tiers.map((t) => t.tier.key), ['fix', 'totals', 'tidy']);
  const reward = tiers[1].groups[0];
  assert.equal(reward.kind, 'type_reward');
  assert.equal(reward.sum_cents, 1539);
  assert.deepEqual(reward.impact, [{ cents: 1539 }, ' moves from refunds to cashback. Spending goes up by the same amount.']);
});

test("a kind the web doesn't know yet still shows, under Labels only", () => {
  const [tier] = groupFindings([f(1, 'something_new', -100)]);
  assert.equal(tier.tier.key, 'tidy');
  assert.equal(tier.groups[0].meta.title, 'something_new');
});

test('statement hints read as a title and a sentence; a sign fix is one click', () => {
  assert.equal(statementHintText({ kind: 'sign_fix', cents: 2000000 }).action, 'approve');
  assert.equal(statementHintText({ kind: 'small', cents: 53 }).tone, 'muted');
  assert.equal(statementHintText({ kind: 'missing_draw', fee_count: 2, cents: 760000 }).parts[0], 'The statement has 2 transfer fees but not the transfer itself. ');
  assert.equal(statementHintText(null).title, "Doesn't add up");
});
