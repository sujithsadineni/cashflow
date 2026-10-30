import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodLabel, statementHeading, statementFigures, foldsAway, statementCreditLine } from './statement-view.js';

test('the dates, one year or across two', () => {
  assert.equal(periodLabel('2026-09-14', '2026-10-13'), 'Sep 14 – Oct 13, 2026');
  assert.equal(periodLabel('2025-12-14', '2026-01-13'), 'Dec 14, 2025 – Jan 13, 2026');
  assert.equal(periodLabel(null, '2026-01-13'), null);
});

test('the header names the card and says how far along the statement is', () => {
  const b = { account_id: 3, account_name: 'Visa Signature', account_mask: '4821', period_start: '2026-09-14', period_end: '2026-10-13', rows_parsed: 10, rows_approved: 10, file_type: 'PDF', parse_method: 'local' };
  assert.deepEqual(statementHeading(b), { title: 'Visa Signature', mask: '4821', facts: ['Sep 14 – Oct 13, 2026', '10 rows saved', 'read on this computer'] });
  assert.deepEqual(statementHeading({ ...b, rows_approved: 3, parse_method: 'api' }).facts.slice(1), ['3 of 10 rows saved', 'read by Claude']);
  assert.equal(statementHeading({ ...b, account_id: null }), null, 'no card yet: the file keeps its own name');
});

test("the strip says what this statement printed, in its account's words (D360)", () => {
  const card = statementFigures({ opening_cents: 100, closing_cents: 200, spend_cents: 300, payments_cents: null, cashback_cents: 0, due_date: '2026-11-07', minimum_cents: 3500 }, 'CREDIT_CARD');
  assert.deepEqual(card.map((f) => f.label), ['Previous balance', 'New charges', 'New balance', 'Due']);
  assert.equal(card.at(-1).minimum, 3500);
  assert.equal(card[1].tone, 'spend');
  assert.deepEqual(statementFigures({ spend_cents: 1, payments_cents: 2 }, 'CHECKING').map((f) => [f.label, f.tone]), [['Money in', 'earn'], ['Money out', 'spend']]);
  assert.deepEqual(statementFigures(null, 'CHECKING'), []);
  assert.equal(statementFigures({ spend_cents: -50000 }, 'CREDIT_CARD')[0].cents, 50000, 'a total stored negative still prints as its size');
});

test('nothing that says nothing: no "Spent $0.00", no fees when none', () => {
  const quiet = statementFigures({ opening_cents: 0, closing_cents: 1988000, spend_cents: 0, payments_cents: 72000, ytd_fees_cents: 0, due_date: '2026-11-02' }, 'CREDIT_CARD');
  assert.deepEqual(quiet.map((f) => f.key), ['opening', 'payments', 'closing', 'due']);
});

test('the year\'s fees and interest, rewards, and six at most', () => {
  const busy = statementFigures({ opening_cents: 1, closing_cents: 2, spend_cents: 3, payments_cents: 4, ytd_year: 2026, ytd_fees_cents: 9500, ytd_interest_cents: 120, rewards: { base_cents: 100, bonus_cents: 50 }, due_date: '2026-11-02' }, 'CREDIT_CARD');
  assert.equal(busy.length, 6);
  assert.deepEqual(busy.map((f) => f.key), ['opening', 'payments', 'spend', 'closing', 'cashback', 'due'], 'fees and interest give way first');
  assert.equal(busy.find((f) => f.key === 'cashback').cents, 150);
});

test('a savings account: its interest and APY', () => {
  const sv = statementFigures({ opening_cents: 100, closing_cents: 200, savings: { apy_bps: 350, interest_cents: 49 } }, 'SAVINGS');
  assert.deepEqual(sv.map((f) => [f.label, f.cents ?? f.text]), [['Opening', 100], ['Closing', 200], ['Interest', 49], ['APY', '3.50%']]);
});

test('only a clean $0.00 line folds away', () => {
  assert.equal(foldsAway({ amount_cents: 0, review_status: 'APPROVED' }, false), true);
  assert.equal(foldsAway({ amount_cents: 0, review_status: 'PENDING' }, true), false);
  assert.equal(foldsAway({ amount_cents: 0, review_status: 'REJECTED' }, false), false);
  assert.equal(foldsAway({ amount_cents: -1, review_status: 'APPROVED' }, false), false);
});

test('the limit box: the printed limit, else the household\'s own (Apple)', () => {
  assert.deepEqual(statementCreditLine({ credit_limit_cents: 2100000, available_credit_cents: 2000000, closing_cents: 100000, credit_limit_manual_cents: 900000 }),
    { credit_limit_cents: 2100000, available_credit_cents: 2000000, closing_balance_cents: 100000, as_of: null }, 'printed wins');
  assert.deepEqual(statementCreditLine({ credit_limit_cents: null, closing_cents: 12269, credit_limit_manual_cents: 1150000 }),
    { credit_limit_cents: 1150000, available_credit_cents: null, closing_balance_cents: 12269, as_of: null, source: 'manual' });
  assert.equal(statementCreditLine({ closing_cents: 5 }), null);
  assert.equal(statementCreditLine(null), null);
});
