/**
 * Recurring expense detection.
 *
 * Detection proposes, the user confirms — same principle as
 * staged_transaction for imports (see db/013_recurring.sql). Every
 * function below is pure (no db access) so the classifier can be unit
 * tested against real transaction data without a database.
 *
 * Grouping and matching both key off `transaction.merchant`, not the
 * raw statement description. merchant is already cleaned by the LLM
 * parse step (parse/categorize.js, parse/pdf.js) — "AplPay DOLLARTREE
 * 000008508 ANYTOWN GA VARIETY STORES" already comes out as "Dollar
 * Tree" before this module ever sees it. Writing a second normalizer
 * here would duplicate logic that's already running in production
 * against real statements, for no benefit.
 *
 * Detection only looks at spend (amount_cents < 0). A recurring BILL
 * is something you pay — a same-amount incoming credit next to a
 * subscription charge (e.g. a "$5.39 Disney Streaming Credit" line
 * next to the Disney+ charge) is a different thing, not a second
 * recurring series to review.
 */

const MIN_OCCURRENCES = 3;

const CADENCE_DAYS = {
  WEEKLY: 7,
  BIWEEKLY: 14,
  MONTHLY: 30, // approximate — MONTHLY dates actually advance by calendar month, see addCadence()
  QUARTERLY: 91,
  ANNUAL: 365,
};

// Gap-median bands from the spec. Nothing outside these is treated as
// a recognizable cadence — that's what keeps a frequently-visited but
// irregular merchant (a grocery store, an EV charger) out of the
// results, rather than force-fitting it into the nearest band.
const CADENCE_BANDS = [
  { cadence: 'WEEKLY', min: 5, max: 9 },
  { cadence: 'BIWEEKLY', min: 11, max: 17 },
  { cadence: 'MONTHLY', min: 28, max: 32 },
  { cadence: 'QUARTERLY', min: 88, max: 95 },
  { cadence: 'ANNUAL', min: 350, max: 380 },
];

// "Low gap variance" / "loose timing" from the spec's confidence rules
// aren't given exact numbers — these are the judgment calls that stand
// in for them, chosen so real fixtures (Disney+ vs. Costco) land where
// they obviously should.
const LOW_GAP_VARIANCE = 0.3;

// Above this, gaps are too chaotic to trust the median at all, even
// when it happens to land inside a band — this is what keeps a
// coincidental slice of a continuously-priced merchant's amounts
// (a chunk of Costco runs that median out to "every 6 days" by luck)
// from reading as a real cadence. Real recurring bills, including
// variable-amount utilities, come in well under this in practice.
const MAX_GAP_VARIANCE_FOR_CADENCE = 0.5;

// A day-of-month cluster is trusted over the raw gap median once
// enough occurrences fall within DAY_OF_MONTH_TOLERANCE days of the
// cluster's median day-of-month. A small sample needs a much higher
// bar than a large one — a 4-occurrence Costco sub-cluster (itself
// already a coincidence of the amount clustering above, on a merchant
// with genuinely continuous prices) can hit 70%-of-4 by pure chance,
// where a real recurring bill's occasional weekend/holiday shift
// still clears 100% at n=9. Only a large-enough sample can afford to
// tolerate one outlier day.
const DAY_OF_MONTH_TOLERANCE = 3;
const dayOfMonthClusterFraction = (n) => (n <= 4 ? 1 : 0.7);

// Splitting one merchant's amounts into separate subscriptions — e.g.
// Cinemark's $12.86 MoviePass-style monthly charge, mixed in the same
// merchant group with occasional full-price ticket purchases at
// $6.97/$10.59/$12.20. A real fixed-price subscription repeats at
// (near enough) the exact same cents every cycle — tighter than any
// two genuinely different one-off purchases happen to land, in
// practice — so pulling out the largest tight cluster first, before
// falling back to cadence analysis on the remainder, is what tells
// them apart.
const TIGHT_CLUSTER_TOLERANCE_RATIO = 0.03; // 3%
const TIGHT_CLUSTER_TOLERANCE_MIN_CENTS = 50;

const median = (nums) => {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

const mean = (nums) => nums.reduce((a, b) => a + b, 0) / nums.length;

const stddev = (nums) => {
  const m = mean(nums);
  return Math.sqrt(mean(nums.map((n) => (n - m) ** 2)));
};

const coefficientOfVariation = (nums) => {
  const m = mean(nums);
  return m === 0 ? Infinity : stddev(nums) / Math.abs(m);
};

const toDate = (d) => (d instanceof Date ? d : new Date(`${d}T00:00:00`));
const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / 86400000);
const isoDate = (d) => toDate(d).toISOString().slice(0, 10);

/* ------------------------------------------------------------------
   Grouping
   ------------------------------------------------------------------ */

/**
 * Group spend transactions by merchant. Drops NULL-merchant rows
 * (interest lines, Zelle, ACH transfers — none of which look like
 * bill candidates) and groups smaller than MIN_OCCURRENCES.
 */
export function groupByMerchant(transactions) {
  const groups = new Map();
  for (const t of transactions) {
    if (!t.merchant || t.amount_cents >= 0) continue;
    if (!groups.has(t.merchant)) groups.set(t.merchant, []);
    groups.get(t.merchant).push(t);
  }
  for (const [merchant, group] of groups) {
    if (group.length < MIN_OCCURRENCES) groups.delete(merchant);
  }
  return groups;
}

const tightTolerance = (amountCents) =>
  Math.max(TIGHT_CLUSTER_TOLERANCE_MIN_CENTS, Math.round(Math.abs(amountCents) * TIGHT_CLUSTER_TOLERANCE_RATIO));

/**
 * Split one merchant's transactions into amount-based clusters.
 * Repeatedly pulls out the largest "same price every time" cluster —
 * catching both a fixed subscription mixed in with one-off purchases
 * at the same merchant (Cinemark's $12.86 MoviePass-style charge vs.
 * occasional full-price tickets) and two distinct subscriptions at
 * different fixed prices (two Apple charges on the same day). Once no
 * cluster of MIN_OCCURRENCES or more remains, whatever's left is
 * pushed through as one group — this is what keeps a genuinely
 * variable-amount bill (a utility, never the same cents twice) intact
 * instead of shattering it into unusable singletons.
 */
export function splitAmountClusters(transactions) {
  let remaining = [...transactions];
  const clusters = [];

  while (remaining.length >= MIN_OCCURRENCES) {
    let best = null;
    for (const t of remaining) {
      const tol = tightTolerance(t.amount_cents);
      const near = remaining.filter((o) => Math.abs(o.amount_cents - t.amount_cents) <= tol);
      if (!best || near.length > best.length) best = near;
    }
    if (best.length < MIN_OCCURRENCES) break;

    clusters.push(best);
    const pulled = new Set(best.map((t) => t.id));
    remaining = remaining.filter((t) => !pulled.has(t.id));
  }

  if (remaining.length > 0) clusters.push(remaining);
  return clusters;
}

/* ------------------------------------------------------------------
   Cadence classification
   ------------------------------------------------------------------ */

function classifyByDayOfMonth(dates) {
  const days = dates.map((d) => toDate(d).getDate());
  const medianDay = median(days);

  // Circular-ish distance so day 30 and day 2 (wrapped across a
  // month boundary) read as close, not 28 apart. 30 is an
  // approximation of month length — good enough for a ±3 day check.
  const circDist = (a, b) => Math.min(Math.abs(a - b), 30 - Math.abs(a - b));
  const clustered = days.filter((d) => circDist(d, medianDay) <= DAY_OF_MONTH_TOLERANCE);

  if (clustered.length / days.length < dayOfMonthClusterFraction(days.length)) return null;

  return {
    matchDaysOfMonth: [...new Set(clustered)].sort((a, b) => a - b),
  };
}

/**
 * Classify the cadence of a sorted-by-date set of occurrences.
 * Returns null when nothing recognizable fits — the caller's signal
 * that this group is not a recurring bill.
 */
export function classifyCadence(dates) {
  const sorted = [...dates].sort((a, b) => toDate(a) - toDate(b));
  const gaps = [];
  for (let i = 1; i < sorted.length; i++) gaps.push(daysBetween(sorted[i - 1], sorted[i]));

  const medianGap = median(gaps);
  const gapCoV = coefficientOfVariation(gaps);

  // Day-of-month clustering is checked first and, when it fires,
  // overrides the raw gap median — a stronger signal per the spec.
  // Only sensible to check when the overall spacing is roughly
  // monthly-ish; otherwise a coincidental cluster (e.g. within a
  // weekly pattern) could misfire.
  if (medianGap >= 20 && medianGap <= 40) {
    const dayCluster = classifyByDayOfMonth(sorted);
    if (dayCluster) {
      return { cadence: 'MONTHLY', cadenceInterval: 1, gapCoV, matchDaysOfMonth: dayCluster.matchDaysOfMonth };
    }
  }

  const band = CADENCE_BANDS.find((b) => medianGap >= b.min && medianGap <= b.max);
  if (!band || gapCoV >= MAX_GAP_VARIANCE_FOR_CADENCE) return null;

  return { cadence: band.cadence, cadenceInterval: 1, gapCoV, matchDaysOfMonth: null };
}

/* ------------------------------------------------------------------
   Amount classification
   ------------------------------------------------------------------ */

export function classifyAmount(amounts) {
  const cov = coefficientOfVariation(amounts);
  const amountVaries = cov >= 0.05;

  const absAmounts = amounts.map(Math.abs);
  const minAbs = Math.min(...absAmounts);
  const maxAbs = Math.max(...absAmounts);

  let matchAmountMinCents;
  let matchAmountMaxCents;
  if (amountVaries) {
    const pad = Math.max((maxAbs - minAbs) * 0.5, 500);
    matchAmountMinCents = -Math.round(maxAbs + pad);
    matchAmountMaxCents = -Math.max(Math.round(minAbs - pad), 0);
  } else {
    matchAmountMinCents = -maxAbs;
    matchAmountMaxCents = -minAbs;
  }

  return {
    amountVaries,
    coefficientOfVariation: cov,
    expectedAmountCents: -Math.round(median(absAmounts)),
    matchAmountMinCents,
    matchAmountMaxCents,
  };
}

/* ------------------------------------------------------------------
   Confidence
   ------------------------------------------------------------------ */

export function scoreConfidence({ occurrenceCount, gapCoV, amountVaries }) {
  if (occurrenceCount >= 5 && gapCoV < LOW_GAP_VARIANCE && !amountVaries) return 'HIGH';
  if (occurrenceCount === 3 && gapCoV >= LOW_GAP_VARIANCE) return 'LOW';
  return 'MEDIUM';
}

/* ------------------------------------------------------------------
   Scheduling
   ------------------------------------------------------------------ */

/** Advance a date by one cadence step, in calendar terms (not a flat day count). */
export function addCadence(date, cadence, cadenceInterval = 1, matchDaysOfMonth = null) {
  const d = toDate(date);
  const result = new Date(d);

  switch (cadence) {
    case 'WEEKLY':
      result.setDate(result.getDate() + 7 * cadenceInterval);
      break;
    case 'BIWEEKLY':
      result.setDate(result.getDate() + 14 * cadenceInterval);
      break;
    case 'MONTHLY':
      result.setMonth(result.getMonth() + cadenceInterval);
      break;
    case 'QUARTERLY':
      result.setMonth(result.getMonth() + 3 * cadenceInterval);
      break;
    case 'ANNUAL':
      result.setFullYear(result.getFullYear() + cadenceInterval);
      break;
    default:
      throw new Error(`Unknown cadence: ${cadence}`);
  }

  if (matchDaysOfMonth && matchDaysOfMonth.length > 0) {
    const daysInMonth = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
    const targetDay = Math.min(median(matchDaysOfMonth), daysInMonth);
    result.setDate(targetDay);
  }

  return isoDate(result);
}

/**
 * A series is lapsed once today is more than 1.5 cadence cycles past
 * next_expected_date — a cancelled subscription should fall off
 * rather than sit there predicting charges forever. Computed live
 * (like loans.js's EFFECTIVE_BALANCE_SQL) rather than written by a
 * background job.
 */
export function isLapsed(nextExpectedDate, cadence, cadenceInterval = 1, today = new Date()) {
  if (!nextExpectedDate) return false;
  const cycleDays = CADENCE_DAYS[cadence] * cadenceInterval;
  return daysBetween(nextExpectedDate, today) > cycleDays * 1.5;
}

// How far projectOccurrences will step away from next_expected_date
// looking for the edge of a requested range, before giving up — a
// generous cap for a personal app's realistic date ranges (a WEEKLY
// series covers ~a year in 60 steps; ANNUAL covers 60 years).
const MAX_PROJECTION_STEPS = 60;

/**
 * Every date a series is expected to land on within [rangeStart,
 * rangeEnd] (inclusive, both 'YYYY-MM-DD'), walking outward from
 * next_expected_date in both directions — so this works whether the
 * requested range is the series' current month, a past one, or a
 * future one. Used by the calendar view for its predicted/missed
 * chips; never writes anything, purely computed per request.
 */
export function projectOccurrences(series, rangeStart, rangeEnd) {
  if (!series.next_expected_date) return [];
  const { cadence, cadence_interval: interval, match_days_of_month: days } = series;
  const dates = [];

  let d = series.next_expected_date;
  for (let i = 0; i < MAX_PROJECTION_STEPS && d >= rangeStart; i++) {
    if (d <= rangeEnd) dates.push(d);
    d = addCadence(d, cadence, -interval, days);
  }

  d = addCadence(series.next_expected_date, cadence, interval, days);
  for (let i = 0; i < MAX_PROJECTION_STEPS && d <= rangeEnd; i++) {
    if (d >= rangeStart) dates.push(d);
    d = addCadence(d, cadence, interval, days);
  }

  return [...new Set(dates)].sort();
}

/* ------------------------------------------------------------------
   Rule matching — used by both detection (skip already-covered
   merchants) and the post-import matcher (routes/imports.js).
   `transaction` here is expected to carry `person_id` joined in from
   its account.
   ------------------------------------------------------------------ */

export function matchesRule(transaction, series) {
  if (!transaction.merchant) return false;
  if (!transaction.merchant.toLowerCase().includes(series.match_name_contains.toLowerCase())) return false;

  if (series.match_amount_min_cents != null && transaction.amount_cents < series.match_amount_min_cents) return false;
  if (series.match_amount_max_cents != null && transaction.amount_cents > series.match_amount_max_cents) return false;

  if (series.account_id != null && transaction.account_id !== series.account_id) return false;
  if (series.person_id != null && transaction.person_id !== series.person_id) return false;

  return true;
}

/* ------------------------------------------------------------------
   Candidate construction
   ------------------------------------------------------------------ */

/** Build one candidate from an amount-cluster of one merchant's transactions, or null if it's not recurring. */
export function buildCandidate(merchant, transactions) {
  if (transactions.length < MIN_OCCURRENCES) return null;

  const dates = transactions.map((t) => t.posted_date).sort((a, b) => toDate(a) - toDate(b));
  const cadenceResult = classifyCadence(dates);
  if (!cadenceResult) return null;

  const { cadence, cadenceInterval, gapCoV, matchDaysOfMonth } = cadenceResult;
  const amountResult = classifyAmount(transactions.map((t) => t.amount_cents));
  const confidence = scoreConfidence({ occurrenceCount: transactions.length, gapCoV, amountVaries: amountResult.amountVaries });

  const firstSeenDate = dates[0];
  const lastSeenDate = dates[dates.length - 1];
  const nextExpectedDate = addCadence(lastSeenDate, cadence, cadenceInterval, matchDaysOfMonth);

  return {
    merchant,
    suggested_name: merchant,
    match_name_contains: merchant,
    cadence,
    cadence_interval: cadenceInterval,
    expected_amount_cents: amountResult.expectedAmountCents,
    amount_varies: amountResult.amountVaries,
    match_amount_min_cents: amountResult.matchAmountMinCents,
    match_amount_max_cents: amountResult.matchAmountMaxCents,
    match_days_of_month: matchDaysOfMonth,
    confidence,
    next_expected_date: nextExpectedDate,
    lapsed: isLapsed(nextExpectedDate, cadence, cadenceInterval),
    occurrence_count: transactions.length,
    first_seen_date: firstSeenDate,
    last_seen_date: lastSeenDate,
    evidence: transactions
      .map((t) => ({ id: t.id, posted_date: t.posted_date, amount_cents: t.amount_cents, description: t.description, account_id: t.account_id }))
      .sort((a, b) => toDate(a.posted_date) - toDate(b.posted_date)),
  };
}

/**
 * Full detection pass: group -> split -> classify -> filter out
 * merchants already covered by an existing series, of ANY status —
 * including ENDED. Ending a series is a deliberate decision ("this
 * subscription is cancelled"); re-detecting the exact same merchant
 * as a brand-new candidate the next time detection runs would ignore
 * that decision, and confirming it again can never link any real
 * transactions (they're all already claimed by the ended series),
 * producing nothing but an empty duplicate. Resuming the existing
 * series (see PATCH .../:id) is the only path back — not creating a
 * new one — so the ended series' real history is never orphaned.
 */
export function detectCandidates(transactions, existingSeries = []) {
  const groups = groupByMerchant(transactions);
  const candidates = [];

  for (const [merchant, group] of groups) {
    for (const cluster of splitAmountClusters(group)) {
      const alreadyCovered = cluster.every((t) => existingSeries.some((s) => matchesRule(t, s)));
      if (alreadyCovered) continue;

      const candidate = buildCandidate(merchant, cluster);
      if (candidate) candidates.push(candidate);
    }
  }

  return candidates;
}
