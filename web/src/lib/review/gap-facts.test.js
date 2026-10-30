import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatGapFact } from './gap-facts.js';

test('statement gap facts become short facts and preserve old sentences as fallback', () => {
  assert.equal(formatGapFact({ kind: 'paid', cents: 10848, date: '2026-06-02', from: 'Checking Account' }),
    'Paid $108.48 · Jun 2 · Checking Account');
  assert.equal(formatGapFact({ kind: 'held_bill', cents: 10848, date: '2026-06-02' }), 'Bill paid Jun 2');
  assert.equal(formatGapFact({ kind: 'due', label: 'Internet bill', date: '2026-06-05' }), 'Due ~Jun 5');
  assert.equal(formatGapFact({ kind: 'carried', cents: 145400 }), 'Carried in $1,454.00');
  assert.equal(formatGapFact({ kind: 'next_opens', cents: 8306 }), 'Next opens at $83.06');
  assert.equal(formatGapFact({ kind: 'unmatched', cents: 8479, date: '2026-08-25', from: 'Test Checking', issuer: 'Test Bank' }),
    'Unmatched $84.79 · Aug 25 · Test Checking');
  assert.equal(formatGapFact({ kind: 'maybe_owed', cents: 145400 }), 'Maybe still owed $1,454.00');
  assert.equal(formatGapFact({ kind: 'text' }, 'The existing explanation.'), 'The existing explanation.');
  assert.equal(formatGapFact(null, 'The existing explanation.'), 'The existing explanation.');
});
