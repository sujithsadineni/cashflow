import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stageOfThrow, readingFacts } from './reading-stages.js';

test('a password or a damaged PDF stops at Open; any other throw while reading', () => {
  assert.equal(stageOfThrow({ name: 'PasswordException' }), 'open');
  assert.equal(stageOfThrow({ name: 'InvalidPDFException' }), 'open');
  assert.equal(stageOfThrow(new TypeError('x is undefined')), 'read');
  assert.equal(stageOfThrow(undefined), 'read');
});

const parsed = {
  account: { issuer: 'Barclays', name: 'Test Card', mask: '1111', product: 'View', holder_name: 'ALEX MORGAN' },
  statement: { period_start: '2026-09-12', period_end: '2026-10-11' },
  rows: [
    { suggested_category: 'Groceries', confidence: 'HIGH' },
    { suggested_category: null, confidence: 'LOW' },
    { suggested_category: 'Fuel', confidence: 'HIGH' },
  ],
  report: { pages_total: 6 },
};

test('what each box found on a matched card', () => {
  assert.deepEqual(readingFacts({ batch: { account_id: null }, parsed, suggestedAccountId: 7, maskTied: false, duplicates: 1 }), {
    pages: 6,
    card: { issuer: 'Barclays', name: 'Test Card', mask: '1111', product: 'View', holder: 'ALEX MORGAN' },
    card_known: 'suggested',
    account_id: 7,
    period: { start: '2026-09-12', end: '2026-10-11' },
    rows: 3,
    sorted: 2,
    low_confidence: 1,
    duplicates: 1,
    same_statement: null,
  });
});

test('how well the card is known', () => {
  const known = (batch, suggestedAccountId, maskTied) => readingFacts({ batch, parsed, suggestedAccountId, maskTied }).card_known;
  assert.equal(known({ account_id: 3 }, null, false), 'confirmed');
  assert.equal(known({ account_id: null }, null, true), 'tied');
  assert.equal(known({ account_id: null }, null, false), 'none');
});

test('a CSV has no pages, card or period', () => {
  const f = readingFacts({ batch: { account_id: null }, parsed: { rows: [] }, suggestedAccountId: null, maskTied: false });
  assert.deepEqual([f.pages, f.card, f.period, f.rows], [null, null, null, 0]);
});
