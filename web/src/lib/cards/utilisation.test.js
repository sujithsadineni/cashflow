import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardUtilisation, householdUtilisation, utilisationTone, statementUtilisation, backLimit, aprText, otherAprs, earnedLine, creditMonths } from './utilisation.js';

// Invented cards with the real shapes.
const card = (id, limit, owed, over = {}) => ({
  id, name: `Card ${id}`, account_type: 'CREDIT_CARD', is_active: true,
  credit_line: limit == null ? null : { credit_limit_cents: String(limit), available_credit_cents: String(limit - Math.max(owed, 0)), closing_balance_cents: String(owed), as_of: '2026-09-24' },
  ...over,
});

test('a card\'s share of its limit, from the same statement', () => {
  assert.deepEqual(cardUtilisation(card(1, 1000000, 250000)), { used: 250000, limit: 1000000, pct: 25, tone: 'muted', asOf: '2026-09-24', available: 750000, availableEstimated: false, manual: false });
});

test('a credit balance owes nothing; no limit printed is no figure, not zero', () => {
  assert.equal(cardUtilisation(card(1, 1000000, -5000)).pct, 0);
  assert.equal(cardUtilisation(card(2, null, 0)), null);
  assert.equal(cardUtilisation(card(3, 0, 0)), null);
});

test('quiet under 30%, amber from 30%, red from 70%', () => {
  assert.deepEqual([29, 30, 69, 70].map(utilisationTone), ['muted', 'warn', 'warn', 'spend']);
});

test('the household sums open cards with a limit and names the ones left out', () => {
  const h = householdUtilisation([card(1, 1000000, 250000), card(2, 500000, 500000), card(3, null, 9000, { name: 'Apple Card' }),
    card(4, 900000, 900000, { is_active: false }), { id: 5, account_type: 'CHECKING', is_active: true }]);
  assert.deepEqual(h, { used: 750000, limit: 1500000, pct: 50, tone: 'warn', cards: 2, without: ['Apple Card'] });
  assert.equal(householdUtilisation([card(3, null, 0)]), null);
});

test('a statement\'s own utilisation, dated by its closing day', () => {
  const u = statementUtilisation({ credit_limit_cents: '800000', available_credit_cents: '780000', closing_balance_cents: '20000', period_end: '2033-03-05' });
  assert.deepEqual([u.pct, u.limit, u.asOf], [3, 800000, '2033-03-05']);
  assert.equal(statementUtilisation({ credit_limit_cents: null, closing_balance_cents: '100' }), null, 'Apple');
  assert.equal(statementUtilisation(null), null);
});

test('the back says where its limit came from, or why there is none', () => {
  const s = { credit_limit_cents: null, available_credit_cents: null, closing_balance_cents: '40000', period_end: '2026-08-17' };
  const last = backLimit({ statement: s, limit_note: 'not_printed', last_limit: { credit_limit_cents: '400000', as_of: '2026-06-14' } });
  assert.deepEqual([last.u.pct, last.u.available, last.u.availableEstimated, last.note, last.lastPrinted], [10, 360000, true, 'of the limit last printed, Jun 2026', true]);
  assert.equal(backLimit({ statement: s, limit_note: 'locked', last_limit: null }).note, 'locked PDF: open it once on Import with its password');
  assert.equal(backLimit({ statement: s, limit_note: 'not_printed', last_limit: null }).note, 'this statement prints no limit');
  assert.equal(backLimit({ statement: { ...s, credit_limit_cents: '100000' } }).u.pct, 40);
  assert.deepEqual(backLimit(null), { u: null, note: null, lastPrinted: false });
});

test('APRs in words, from basis points', () => {
  assert.equal(aprText(2874), '28.74%');
  assert.equal(aprText(0), '0.00%');
  assert.equal(aprText(null), null);
  assert.equal(otherAprs({ apr_balance_transfer_bps: null, apr_cash_advance_bps: 2949, apr_penalty_bps: 2999 }), 'Cash advances 29.49% · Penalty 29.99%');
  assert.equal(otherAprs(null), '');
});

test('what a statement earned, in its own unit', () => {
  const money = (c) => `$${(c / 100).toFixed(2)}`;
  assert.equal(earnedLine({ cashback_earned_cents: '633', rewards: { available_cents: 633 } }, money), 'Earned $6.33 cash back · $6.33 available');
  assert.equal(earnedLine({ cashback_earned_cents: -3, rewards: null, cashback_balance_cents: '196' }, money), 'Gave back $0.03 cash back · $1.96 available');
  assert.equal(earnedLine({ cashback_earned_cents: '181' }, money), 'Earned $1.81 cash back');
  assert.equal(earnedLine({ rewards: { miles: 1966, miles_to: 'Frontier Airlines' } }, money), '1,966 miles sent to Frontier Airlines');
  assert.equal(earnedLine({ cashback_earned_cents: null, cashback_balance_cents: '20896' }, money), '$208.96 in rewards waiting');
  assert.equal(earnedLine({}, money), null);
});

test('a limit the household set is used only where none was printed, and says so (D354)', () => {
  const s = { credit_limit_cents: null, available_credit_cents: null, closing_balance_cents: '50000', period_end: '2026-09-30' };
  const own = backLimit({ statement: s, limit_note: 'not_printed', last_limit: null, manual_limit_cents: '1000000' });
  assert.deepEqual([own.u.pct, own.u.manual, own.note, own.lastPrinted], [5, true, 'of the limit you set', true]);
  assert.equal(backLimit({ statement: s, last_limit: { credit_limit_cents: '400000', as_of: '2026-06-14' }, manual_limit_cents: '1000000' }).note, 'of the limit last printed, Jun 2026', 'printed wins');
  assert.equal(cardUtilisation({ credit_line: { credit_limit_cents: 100, closing_balance_cents: 10, source: 'manual' } }).manual, true);
});

test('against a limit the household set, what\'s available is the rest of it, marked as an estimate (D357)', () => {
  const s = { credit_limit_cents: null, available_credit_cents: null, closing_balance_cents: '12269', period_end: '2026-09-30' };
  const own = backLimit({ statement: s, limit_note: 'not_printed', last_limit: null, manual_limit_cents: '1150000' });
  assert.deepEqual([own.u.available, own.u.availableEstimated], [1137731, true]);
  const credit = backLimit({ statement: { ...s, closing_balance_cents: '-500' }, manual_limit_cents: '1150000' });
  assert.equal(credit.u.available, 1150000, 'a credit balance owes nothing');
  const printed = cardUtilisation({ credit_line: { credit_limit_cents: 100000, available_credit_cents: 90000, closing_balance_cents: 10000 } });
  assert.deepEqual([printed.available, printed.availableEstimated], [90000, false], 'a printed figure is never replaced');
});

test('credit used month by month: the household each month, nothing for months still to come (D358)', () => {
  const line = (limit, owed) => ({ credit_limit_cents: limit, available_credit_cents: null, closing_balance_cents: owed, as_of: '2026-01-05' });
  const data = { through_month: 2, months: [
    { month: '2026-01', cards: [card(1, null, 0, { credit_line: line(1000000, 100000) }), card(2, null, 0, { credit_line: line(1000000, 300000) })] },
    { month: '2026-02', cards: [card(1, null, 0, { credit_line: line(1000000, 500000) })] },
    { month: '2026-03', cards: [card(1, null, 0, { credit_line: line(1000000, 900000) })] },
  ] };
  assert.deepEqual(creditMonths(data).map((m) => m.household?.pct ?? null), [20, 50, null]);
});
