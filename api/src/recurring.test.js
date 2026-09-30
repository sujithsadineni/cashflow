import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyCadence,
  classifyAmount,
  scoreConfidence,
  splitAmountClusters,
  matchesRule,
  isLapsed,
  addCadence,
  projectOccurrences,
  detectCandidates,
  buildCandidate,
} from './recurring.js';

/* ------------------------------------------------------------------
   Real fixtures — posted_date/amount_cents pulled directly from the
   dev database (see docs/DECISIONS.md for the session this was built
   in). These are the actual numbers the classifier has to get right:
   Disney+ is an obvious true positive, Costco and ChargePoint are the
   spec's "frequently-visited but not a bill" false positives.
   ------------------------------------------------------------------ */

let nextId = 1;
const txn = (posted_date, amount_cents, merchant, description = merchant, account_id = 1) => ({
  id: nextId++,
  posted_date,
  amount_cents,
  merchant,
  description,
  account_id,
});

const DISNEY_PLUS = [
  ['2025-12-25', -539], ['2026-01-25', -539], ['2026-02-25', -539], ['2026-03-25', -539],
  ['2026-04-25', -539], ['2026-05-25', -539], ['2026-06-25', -539],
].map(([d, c]) => txn(d, c, 'Disney+', 'DISNEYPLUS 888-905-7888 CA'));

// Real Cinemark evidence: a $12.86/month MoviePass-style subscription
// mixed into the same merchant group as three full-price one-off
// ticket purchases ($12.20, $6.97, $10.59) — exactly the case flagged
// as under-split from a live review of detected candidates.
const CINEMARK = [
  ['2025-12-16', -1220], ['2025-12-22', -1286], ['2026-01-14', -697], ['2026-01-21', -1286],
  ['2026-02-21', -1286], ['2026-03-21', -1286], ['2026-04-21', -1286], ['2026-05-21', -1286],
  ['2026-06-19', -1059], ['2026-06-22', -1286], ['2026-07-11', -1286], ['2026-08-21', -1286],
].map(([d, c]) => txn(d, c, 'Cinemark'));

const COSTCO = [
  ['2025-12-18', -50000], ['2025-12-22', -214], ['2026-01-30', -1219], ['2026-01-30', -1070],
  ['2026-02-09', -25000], ['2026-02-10', -10212], ['2026-02-20', -3999], ['2026-03-03', -94999],
  ['2026-03-06', -9205], ['2026-03-23', -106382], ['2026-03-24', -79999], ['2026-03-31', -151998],
  ['2026-04-04', -431], ['2026-04-04', -2794], ['2026-04-27', -9971], ['2026-04-27', -25000],
  ['2026-05-18', -25568], ['2026-05-25', -10000], ['2026-05-25', -10000], ['2026-05-30', -6276],
  ['2026-06-08', -7999], ['2026-06-10', -5775], ['2026-06-10', -3264], ['2026-06-11', -593],
  ['2026-06-18', -13000], ['2026-06-24', -28067], ['2026-06-25', -9520], ['2026-06-26', -4513],
  ['2026-06-30', -121899], ['2026-07-03', -32438], ['2026-07-03', -11332], ['2026-07-06', -6999],
  ['2026-07-09', -1480], ['2026-07-27', -10774],
].map(([d, c]) => txn(d, c, 'Costco', 'COSTCO WHSE #0187 ANYTOWN GA'));

const CHARGEPOINT = [
  ['2026-04-08', -716], ['2026-04-14', -339], ['2026-04-14', -278], ['2026-04-27', -1],
  ['2026-04-28', -285], ['2026-04-28', -287], ['2026-05-08', -217], ['2026-05-08', -289],
  ['2026-05-15', -379], ['2026-05-16', -753], ['2026-05-16', -291], ['2026-06-02', -313],
  ['2026-06-02', -294], ['2026-06-08', -305], ['2026-06-09', -332], ['2026-06-15', -365],
  ['2026-06-22', -344], ['2026-07-14', -109], ['2026-07-17', -118], ['2026-08-06', -125],
  ['2026-08-07', -124], ['2026-08-11', -125], ['2026-08-12', -120],
].map(([d, c]) => txn(d, c, 'ChargePoint', 'CHARGEPOINT INC 800-465-1490 CA'));

/* ------------------------------------------------------------------
   Cadence classification
   ------------------------------------------------------------------ */

test('classifyCadence: weekly', () => {
  const result = classifyCadence(['2026-01-01', '2026-01-08', '2026-01-15', '2026-01-22']);
  assert.equal(result.cadence, 'WEEKLY');
});

test('classifyCadence: biweekly', () => {
  const result = classifyCadence(['2026-01-01', '2026-01-15', '2026-01-29', '2026-02-12']);
  assert.equal(result.cadence, 'BIWEEKLY');
});

test('classifyCadence: monthly, by gap median', () => {
  const result = classifyCadence(['2026-01-03', '2026-02-02', '2026-03-04', '2026-04-03']);
  assert.equal(result.cadence, 'MONTHLY');
});

test('classifyCadence: quarterly', () => {
  const result = classifyCadence(['2026-01-01', '2026-04-02', '2026-07-02', '2026-10-01']);
  assert.equal(result.cadence, 'QUARTERLY');
});

test('classifyCadence: annual', () => {
  const result = classifyCadence(['2024-03-15', '2025-03-14', '2026-03-16']);
  assert.equal(result.cadence, 'ANNUAL');
});

test('classifyCadence: monthly day-of-month clustering wraps across a month boundary', () => {
  // Days of month here are 31, 30, 1, 31 - a plain (non-circular)
  // distance from day 1 to the median would read as ~29 apart and
  // wrongly exclude it. Wrapped, day 1 is right next to day 31.
  const result = classifyCadence(['2025-12-31', '2026-01-30', '2026-03-01', '2026-03-31']);
  assert.equal(result.cadence, 'MONTHLY');
  assert.deepEqual(result.matchDaysOfMonth, [1, 30, 31]);
});

test('classifyCadence: no band fits -> not recurring', () => {
  const dates = COSTCO.map((t) => t.posted_date);
  assert.equal(classifyCadence(dates), null);
});

/* ------------------------------------------------------------------
   Amount classification
   ------------------------------------------------------------------ */

test('classifyAmount: fixed amount (subscription)', () => {
  const result = classifyAmount([-539, -539, -539, -539]);
  assert.equal(result.amountVaries, false);
  assert.equal(result.matchAmountMinCents, -539);
  assert.equal(result.matchAmountMaxCents, -539);
});

test('classifyAmount: variable amount (utility)', () => {
  // Real Duke Energy amounts.
  const result = classifyAmount([-20000, -14047, -11143, -10515, -9180, -8020, -7870, -1691, -1000]);
  assert.equal(result.amountVaries, true);
  assert.ok(result.matchAmountMinCents < -20000);
  assert.ok(result.matchAmountMaxCents > -1000);
});

/* ------------------------------------------------------------------
   Confidence
   ------------------------------------------------------------------ */

test('scoreConfidence: HIGH needs 5+ occurrences, low gap variance, fixed amount', () => {
  assert.equal(scoreConfidence({ occurrenceCount: 7, gapCoV: 0.05, amountVaries: false }), 'HIGH');
  assert.equal(scoreConfidence({ occurrenceCount: 7, gapCoV: 0.05, amountVaries: true }), 'MEDIUM');
  assert.equal(scoreConfidence({ occurrenceCount: 4, gapCoV: 0.05, amountVaries: false }), 'MEDIUM');
});

test('scoreConfidence: LOW is 3 occurrences with loose timing', () => {
  assert.equal(scoreConfidence({ occurrenceCount: 3, gapCoV: 0.5, amountVaries: false }), 'LOW');
  assert.equal(scoreConfidence({ occurrenceCount: 3, gapCoV: 0.1, amountVaries: false }), 'MEDIUM');
});

/* ------------------------------------------------------------------
   Amount clustering — separating two subscriptions from one merchant
   ------------------------------------------------------------------ */

test('splitAmountClusters: two same-merchant subscriptions on the same day separate by amount', () => {
  // Constructed fixture (same shape as real Apple billing: iCloud+
  // and Apple Music both charged on the 14th every month) — Apple
  // doesn't happen to show this exact pattern in the current dataset,
  // but the mixed one-time/recurring Apple charges do exercise the
  // same "same merchant, different price points" shape this exists for.
  const rows = [
    txn('2026-01-14', -299, 'Apple'), txn('2026-01-14', -999, 'Apple'),
    txn('2026-02-14', -299, 'Apple'), txn('2026-02-14', -999, 'Apple'),
    txn('2026-03-14', -299, 'Apple'), txn('2026-03-14', -999, 'Apple'),
    txn('2026-04-14', -299, 'Apple'), txn('2026-04-14', -999, 'Apple'),
  ];
  const clusters = splitAmountClusters(rows);
  assert.equal(clusters.length, 2);
  assert.ok(clusters.every((c) => new Set(c.map((t) => t.amount_cents)).size === 1));
});

test('splitAmountClusters: a fixed subscription pulls apart from one-off purchases at the same merchant', () => {
  const clusters = splitAmountClusters(CINEMARK);
  const subscription = clusters.find((c) => c.length === 9);
  assert.ok(subscription, 'expected a 9-transaction cluster of the $12.86 charge');
  assert.ok(subscription.every((t) => t.amount_cents === -1286));

  const leftover = clusters.find((c) => c.length === 3);
  assert.ok(leftover);
  assert.deepEqual(leftover.map((t) => t.amount_cents).sort((a, b) => a - b), [-1220, -1059, -697]);
});

/* ------------------------------------------------------------------
   End to end: real merchant fixtures
   ------------------------------------------------------------------ */

test('buildCandidate: Disney+ is a HIGH-confidence monthly recurring', () => {
  const candidate = buildCandidate('Disney+', DISNEY_PLUS);
  assert.ok(candidate);
  assert.equal(candidate.cadence, 'MONTHLY');
  assert.equal(candidate.confidence, 'HIGH');
  assert.equal(candidate.amount_varies, false);
  assert.equal(candidate.expected_amount_cents, -539);
  assert.equal(candidate.occurrence_count, 7);
  assert.deepEqual(candidate.match_days_of_month, [25]);
});

test('buildCandidate: Costco (frequent, irregular, varying amounts) is NOT recurring', () => {
  assert.equal(buildCandidate('Costco', COSTCO), null);
});

test('buildCandidate: ChargePoint (frequent, irregular, small varying amounts) is NOT recurring', () => {
  assert.equal(buildCandidate('ChargePoint', CHARGEPOINT), null);
});

test('detectCandidates: Cinemark separates the $12.86 subscription from one-off ticket purchases', () => {
  const candidates = detectCandidates(CINEMARK);
  const cinemark = candidates.filter((c) => c.merchant === 'Cinemark');
  assert.equal(cinemark.length, 1, 'the 3 leftover one-off tickets should not also produce a candidate');
  assert.equal(cinemark[0].occurrence_count, 9);
  assert.equal(cinemark[0].expected_amount_cents, -1286);
  assert.equal(cinemark[0].amount_varies, false);
  assert.equal(cinemark[0].cadence, 'MONTHLY');
});

test('detectCandidates: real transaction mix produces Disney+ only, not Costco or ChargePoint', () => {
  const candidates = detectCandidates([...DISNEY_PLUS, ...COSTCO, ...CHARGEPOINT]);
  const merchants = candidates.map((c) => c.merchant);
  assert.ok(merchants.includes('Disney+'));
  assert.ok(!merchants.includes('Costco'));
  assert.ok(!merchants.includes('ChargePoint'));
});

test('detectCandidates: skips a merchant already fully covered by an existing series', () => {
  const existing = [{
    id: 1, status: 'ACTIVE', match_name_contains: 'Disney+',
    match_amount_min_cents: -539, match_amount_max_cents: -539,
    account_id: null, person_id: null,
  }];
  const candidates = detectCandidates(DISNEY_PLUS, existing);
  assert.equal(candidates.length, 0);
});

test('detectCandidates: an ENDED series still counts as coverage - a cancelled subscription is not re-proposed as new', () => {
  const existing = [{
    id: 1, status: 'ENDED', match_name_contains: 'Disney+',
    match_amount_min_cents: -539, match_amount_max_cents: -539,
    account_id: null, person_id: null,
  }];
  const candidates = detectCandidates(DISNEY_PLUS, existing);
  assert.equal(candidates.length, 0, 'confirming this candidate again would only produce an empty duplicate - every real transaction is already claimed by the ended series');
});

/* ------------------------------------------------------------------
   Scheduling
   ------------------------------------------------------------------ */

test('addCadence: monthly snaps to the clustered day-of-month', () => {
  const next = addCadence('2026-01-25', 'MONTHLY', 1, [25]);
  assert.equal(next, '2026-02-25');
});

test('projectOccurrences: monthly series lands once per month within range', () => {
  const series = { next_expected_date: '2026-09-20', cadence: 'MONTHLY', cadence_interval: 1, match_days_of_month: [20] };
  assert.deepEqual(projectOccurrences(series, '2026-09-01', '2026-09-30'), ['2026-09-20']);
  assert.deepEqual(projectOccurrences(series, '2026-11-01', '2026-11-30'), ['2026-11-20']);
  assert.deepEqual(projectOccurrences(series, '2026-06-01', '2026-06-30'), ['2026-06-20']);
});

test('projectOccurrences: weekly series can land more than once in a month', () => {
  const series = { next_expected_date: '2026-09-04', cadence: 'WEEKLY', cadence_interval: 1, match_days_of_month: null };
  const dates = projectOccurrences(series, '2026-09-01', '2026-09-30');
  assert.deepEqual(dates, ['2026-09-04', '2026-09-11', '2026-09-18', '2026-09-25']);
});

test('isLapsed: a monthly series 3 cycles past due is lapsed', () => {
  const today = new Date('2026-09-20T00:00:00');
  assert.equal(isLapsed('2026-06-01', 'MONTHLY', 1, today), true);
});

test('isLapsed: a monthly series due next week is not lapsed', () => {
  const today = new Date('2026-09-20T00:00:00');
  assert.equal(isLapsed('2026-09-27', 'MONTHLY', 1, today), false);
});

/* ------------------------------------------------------------------
   Rule matching
   ------------------------------------------------------------------ */

test('matchesRule: substring, case-insensitive, against merchant', () => {
  const series = { match_name_contains: 'netflix', match_amount_min_cents: null, match_amount_max_cents: null, account_id: null, person_id: null };
  assert.equal(matchesRule({ merchant: 'Netflix', amount_cents: -1699, account_id: 1, person_id: 1 }, series), true);
  assert.equal(matchesRule({ merchant: 'Netflix House', amount_cents: -1699, account_id: 1, person_id: 1 }, series), true);
  assert.equal(matchesRule({ merchant: 'Hulu', amount_cents: -1699, account_id: 1, person_id: 1 }, series), false);
});

test('matchesRule: amount range and account/person pinning', () => {
  const series = {
    match_name_contains: 'Amazon', match_amount_min_cents: -2000, match_amount_max_cents: -500,
    account_id: 3, person_id: 2,
  };
  assert.equal(matchesRule({ merchant: 'Amazon', amount_cents: -1000, account_id: 3, person_id: 2 }, series), true);
  assert.equal(matchesRule({ merchant: 'Amazon', amount_cents: -3000, account_id: 3, person_id: 2 }, series), false, 'outside amount range');
  assert.equal(matchesRule({ merchant: 'Amazon', amount_cents: -1000, account_id: 9, person_id: 2 }, series), false, 'wrong account');
  assert.equal(matchesRule({ merchant: 'Amazon', amount_cents: -1000, account_id: 3, person_id: 9 }, series), false, 'wrong person');
});
