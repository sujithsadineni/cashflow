import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeStatementGaps, addMonths } from './statement-gaps.js';

const card = { id: 1, name: 'Test Card', issuer: 'American Express' };
const st = (period_start, period_end, opening, closing, account_id = 1) => ({ account_id, period_start, period_end, opening_balance_cents: opening, closing_balance_cents: closing });
const pay = (posted_date, amount_cents, o = {}) => ({ id: posted_date, posted_date, amount_cents, description: 'AMEX EPAYMENT ACH PMT', account_name: 'Test Checking', issuer_key: 'American Express', explained_by_card_id: null, ...o });
const run = (o) => judgeStatementGaps({ cards: [card], today: '2026-10-17', ...o });
const cyclesOf = (out, i = 0) => out[0].gaps[i].cycles.map((c) => [c.start, c.end, c.verdict]);

test('addMonths keeps the day, and the 31st becomes the month\'s last day', () => {
  assert.equal(addMonths('2026-05-08', 1), '2026-06-08');
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
});

test('$0 before and after, nothing paid: each cycle in between is quiet', () => {
  const out = run({ statements: [st('2025-05-07', '2025-06-06', 0, 0), st('2025-07-17', '2025-08-08', 0, 2538)] });
  assert.deepEqual(out[0].gaps[0].cycles.map((c) => c.verdict), ['quiet']);
});

test('a balance paid off in the first cycle: that statement is missing, the cycles after it were quiet', () => {
  const out = run({
    statements: [st('2026-04-14', '2026-05-08', 13928, 10848), st('2026-08-08', '2026-09-07', 0, 100)],
    payments: [pay('2026-06-02', 10848)],
  });
  assert.deepEqual(cyclesOf(out), [
    ['2026-05-09', '2026-06-08', 'missing'],
    ['2026-06-09', '2026-07-08', 'quiet'],
    ['2026-07-09', '2026-08-07', 'quiet'],
  ]);
  assert.match(out[0].gaps[0].cycles[0].reasons.join(' '), /\$108\.48 was paid to it on Jun 2, 2026/);
});

test('statement gap facts retain structured details for each reason', () => {
  const combined = run({
    statements: [st('2026-05-06', '2026-06-05', 29187, 65644), st('2026-09-06', '2026-10-05', 900, 1000)],
    payments: [pay('2026-07-02', 65644), pay('2026-08-20', 5555)],
    expected: [{ account_id: 1, date: '2026-08-01', label: 'Internet bill' }],
  });
  const combinedCycles = combined[0].gaps[0].cycles;
  const combinedFacts = combinedCycles.flatMap((cycle) => {
    assert.equal(cycle.facts.length, cycle.reasons.length);
    return cycle.facts;
  });
  for (const kind of ['paid', 'held_bill', 'due', 'carried', 'next_opens']) {
    assert.ok(combinedFacts.some((fact) => fact.kind === kind), `expected a ${kind} fact`);
  }

  const otherCard = { id: 2, name: 'Other Test Card', issuer: card.issuer };
  const ambiguous = judgeStatementGaps({
    cards: [card, otherCard],
    statements: [
      st('2026-04-14', '2026-05-08', 0, 0),
      st('2026-08-08', '2026-09-07', 0, 0),
      st('2026-04-14', '2026-05-08', 0, 0, otherCard.id),
      st('2026-08-08', '2026-09-07', 0, 0, otherCard.id),
    ],
    payments: [pay('2026-06-02', 1234)],
    today: '2026-10-17',
  });
  const unmatched = ambiguous[0].gaps[0].cycles[0];
  assert.ok(unmatched.facts.some((fact) => fact.kind === 'unmatched'));
  assert.equal(unmatched.facts.length, unmatched.reasons.length);

  const owed = run({ statements: [st('2026-04-14', '2026-05-08', 13928, 10848), st('2026-08-08', '2026-09-07', 0, 100)] });
  const maybeOwed = owed[0].gaps[0].cycles[1];
  assert.ok(maybeOwed.facts.some((fact) => fact.kind === 'maybe_owed'));
  assert.equal(maybeOwed.facts.length, maybeOwed.reasons.length);

  const uncertainOpening = run({
    statements: [st('2026-04-14', '2026-05-08', 0, 0), st('2026-08-08', '2026-09-07', 1000, 1200)],
  })[0].gaps[0].cycles[0];
  assert.equal(uncertainOpening.facts[0].kind, 'text');
  assert.match(uncertainOpening.reasons[0], /may have started building up here/);
});

test('a later payment in the gap means its cycle and the bill before it both had statements', () => {
  const out = run({
    statements: [st('2026-05-06', '2026-06-05', 29187, 65644), st('2026-09-06', '2026-10-05', 0, 1000)],
    payments: [pay('2026-07-02', 65644), pay('2026-09-03', 9900)],
  });
  assert.deepEqual(out[0].gaps[0].cycles.map((c) => c.verdict), ['missing', 'missing', 'missing']);
  assert.match(out[0].gaps[0].cycles[1].reasons.join(' '), /held the bill paid on Sep 3, 2026/);
});

test('the next statement opening with a balance: the cycle before it is missing, earlier ones can\'t be told', () => {
  const out = run({ statements: [st('2025-08-14', '2025-09-07', 2538, 0), st('2025-12-12', '2026-01-08', 22887, 61273)] });
  const verdicts = out[0].gaps[0].cycles.map((c) => c.verdict);
  assert.equal(verdicts.at(-1), 'missing');
  assert.ok(verdicts.slice(0, -1).every((v) => v === 'unknown'));
});

test('statements a couple of weeks apart with the balance carrying over are not a gap', () => {
  const out = run({ statements: [st('2026-05-25', '2026-06-24', 0, 102906), st('2026-07-06', '2026-07-24', 102906, 18681)] });
  assert.equal(out[0].gaps.filter((g) => !g.trailing).length, 0);
});

test('a missing balance means the cycles can\'t be told', () => {
  const out = run({ statements: [st('2025-02-10', '2025-03-07', 26, null), st('2025-06-06', '2025-06-06', null, 0)] });
  assert.ok(out[0].gaps[0].cycles.every((c) => c.verdict === 'unknown'));
});

test('a payment matched to another card\'s statement is not evidence', () => {
  const out = run({ statements: [st('2026-04-14', '2026-05-08', 0, 0), st('2026-08-08', '2026-09-07', 0, 0)], payments: [pay('2026-06-02', 5000, { explained_by_card_id: 9 })] });
  assert.ok(out[0].gaps[0].cycles.every((c) => c.verdict === 'quiet'));
});

test('two cards of one issuer without a statement that day: the payment can\'t be pinned unless it pays one\'s balance', () => {
  const other = { id: 2, name: 'Other Card', issuer: 'American Express' };
  const statements = [st('2026-04-14', '2026-05-08', 0, 0), st('2026-08-08', '2026-09-07', 0, 0), st('2026-04-20', '2026-05-19', 0, 4000, 2), st('2026-08-20', '2026-09-19', 0, 0, 2)];
  const both = judgeStatementGaps({ cards: [card, other], statements, payments: [pay('2026-06-02', 1234)], today: '2026-10-17' });
  assert.deepEqual(both[0].gaps[0].cycles.map((c) => c.verdict), ['unknown', 'quiet', 'quiet']);
  assert.match(both[0].gaps[0].cycles[0].reasons[0], /may be for this one/);

  const pinned = judgeStatementGaps({ cards: [card, other], statements, payments: [pay('2026-06-02', 4000)], today: '2026-10-17' });
  assert.ok(pinned[0].gaps[0].cycles.every((c) => c.verdict === 'quiet'), 'the $40 pays the other card\'s balance');
  assert.equal(pinned[1].gaps[0].cycles[0].verdict, 'missing');
});

test('a card of the same issuer opened later is no candidate: the payment is this card\'s evidence (D306)', () => {
  const later = { id: 2, name: 'Later Card', issuer: 'American Express' };
  // The later card's first statement opens at $0 in July: it didn't exist in June.
  const statements = [st('2026-04-14', '2026-05-08', 0, 0), st('2026-08-08', '2026-09-07', 0, 0), st('2026-07-01', '2026-07-31', 0, 0, 2), st('2026-08-01', '2026-08-31', 0, 0, 2)];
  const out = judgeStatementGaps({ cards: [card, later], statements, payments: [pay('2026-06-02', 1234)], today: '2026-10-17' });
  assert.equal(out[0].gaps[0].cycles[0].verdict, 'missing');
});

test('after the newest statement: $0 and nothing since is likely quiet, and your answer makes it quiet', () => {
  const statements = [st('2026-06-08', '2026-07-07', 500, 0)];
  const out = run({ statements });
  const trailing = out[0].gaps.find((g) => g.trailing);
  assert.deepEqual(trailing.cycles.map((c) => [c.end, c.verdict]), [['2026-08-07', 'likely_quiet'], ['2026-09-07', 'likely_quiet'], ['2026-10-07', 'likely_quiet']]);
  const answered = run({ statements, answers: [{ account_id: 1, cycle_end: '2026-08-07' }] });
  assert.equal(answered[0].gaps.find((g) => g.trailing).cycles[0].verdict, 'quiet');
});

test('after the newest statement with a balance, the next statement is missing; a cycle not closed a week ago isn\'t asked about', () => {
  const out = run({ statements: [st('2026-08-08', '2026-09-07', 0, 100)], payments: [pay('2026-09-11', 100)] });
  const trailing = out[0].gaps.find((g) => g.trailing);
  assert.deepEqual(trailing.cycles.map((c) => [c.end, c.verdict]), [['2026-10-07', 'missing']]);
});

test('your "no statement" answer doesn\'t hide evidence that there was one', () => {
  const out = run({
    statements: [st('2026-04-14', '2026-05-08', 0, 0), st('2026-08-08', '2026-09-07', 0, 0)],
    payments: [pay('2026-07-20', 5000)],
    answers: [{ account_id: 1, cycle_end: '2026-07-08' }],
  });
  const cycle = out[0].gaps[0].cycles[1];
  assert.equal(cycle.verdict, 'missing');
  assert.match(cycle.reasons[0], /You said there was no statement/);
});

test('a payment to a different issuer is not this card\'s evidence', () => {
  const out = run({ statements: [st('2026-04-14', '2026-05-08', 0, 0), st('2026-08-08', '2026-09-07', 0, 0)], payments: [pay('2026-06-02', 5000, { issuer_key: 'Barclays' })] });
  assert.ok(out[0].gaps[0].cycles.every((c) => c.verdict === 'quiet'));
});

test('a cycle an import holds rows for is uploaded, not missing, even without its statement details', () => {
  const out = run({
    statements: [st('2026-07-14', '2026-08-13', 0, 62787)],
    imports: [{ account_id: 1, import_batch_id: 49, first_date: '2026-08-15', last_date: '2026-09-13', has_statement: false }],
  });
  assert.ok(!out[0].gaps.some((g) => g.cycles.some((c) => c.end === '2026-09-13')));
  assert.equal(out[0].problems[0].kind, 'details_missing');
});

test('statement problems: two that overlap, and an import with no statement details', () => {
  const out = run({
    statements: [st('2025-01-06', '2025-02-21', 28277, 9190), st('2025-01-06', '2025-03-25', 9190, 2675)],
    imports: [{ account_id: 1, import_batch_id: 49, first_date: '2026-08-15', last_date: '2026-09-13', has_statement: false }],
  });
  assert.deepEqual(out[0].problems.map((p) => p.kind), ['overlap', 'details_missing']);
});

test('monthOf: a statement or cycle stands for the month whose 15th it holds', async () => {
  const { monthOf } = await import('./statement-gaps.js');
  assert.equal(monthOf({ start: '2026-09-06', end: '2026-10-05' }), '2026-09');
  assert.equal(monthOf({ start: '2026-05-09', end: '2026-06-08' }), '2026-05');
  assert.equal(monthOf({ start: '2024-12-26', end: '2025-01-08' }), '2025-01', 'no 15th inside: the middle day');
  const { monthsOf } = await import('./statement-gaps.js');
  assert.deepEqual(monthsOf({ start: '2025-06-07', end: '2025-07-16' }), ['2025-06', '2025-07'], 'a long cycle stands for both months');
});

test('monthStates: the calendar from statements, imports, gap verdicts, and what came before and after', async () => {
  const { monthStates } = await import('./statement-gaps.js');
  const statements = [st('2026-04-06', '2026-05-05', 0, 100), st('2026-05-06', '2026-06-05', 100, 0), st('2026-09-06', '2026-10-05', 0, 500)];
  const cycles = [
    { start: '2026-06-06', end: '2026-07-05', verdict: 'missing' },
    { start: '2026-07-06', end: '2026-08-05', verdict: 'quiet' },
    { start: '2026-08-06', end: '2026-09-05', verdict: 'likely_quiet' },
  ];
  const months = monthStates({ statements, cycles, today: '2026-10-17' });
  assert.deepEqual(months, { '2026-04': 'uploaded', '2026-05': 'uploaded', '2026-06': 'missing', '2026-07': 'quiet', '2026-08': 'ask', '2026-09': 'uploaded', '2026-10': 'upcoming' });
  assert.equal(monthStates({ statements: [st('2026-03-20', '2026-04-19', 0, 0)], cycles: [], today: '2026-04-30' })['2026-03'], 'before');
  const withImport = monthStates({ statements: [st('2026-07-14', '2026-08-13', 0, 0)], imports: [{ first_date: '2026-08-15', last_date: '2026-09-13' }], cycles: [], today: '2026-09-30' });
  assert.equal(withImport['2026-08'], 'uploaded', 'an import without statement details still covers its month');
  assert.equal(withImport['2026-09'], 'upcoming', 'the next cycle closes Oct 13');
});

test('a short break between statements whose balance carries over is still on file', async () => {
  const { monthStates } = await import('./statement-gaps.js');
  const months = monthStates({ statements: [st('2025-11-13', '2025-12-08', 0, 5266), st('2025-12-26', '2026-01-08', 5266, 1000)], cycles: [], today: '2026-01-31' });
  assert.equal(months['2025-12'], 'uploaded');
});

test('a statement with no activity makes its month grey and is listed as silent (D273)', async () => {
  const { monthStates } = await import('./statement-gaps.js');
  const quiet = { ...st('2025-03-08', '2025-04-07', -249, -249), no_activity: true };
  assert.equal(monthStates({ statements: [st('2025-02-10', '2025-03-07', 26, -249), quiet], cycles: [], today: '2025-04-30' })['2025-03'], 'quiet');
  const out = run({ statements: [st('2025-02-10', '2025-03-07', 26, -249), quiet], today: '2025-04-20' });
  assert.deepEqual(out[0].quiet_statements.map((q) => [q.month, q.verdict, q.statement]), [['2025-03', 'quiet', true]]);
});
