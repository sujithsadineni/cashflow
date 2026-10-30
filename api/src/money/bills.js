/**
 * Recurring bills, rebuilt from scratch (D185). Pure: no database. Three
 * jobs, each small:
 *
 *   detect(transactions, bills, opts)  what looks like a bill (suggestions only;
 *                                      a person confirms)
 *   matchBill(transaction, bills)      which bill a new charge belongs to
 *   billStatus(bill, charges, today)   where a bill stands: next date, state,
 *                                      the last six cycles paid or missed
 *
 * A bill is a merchant + a rhythm + a price. One merchant can have
 * several (Planet Fitness: $25.05 monthly and $49 yearly), so charges
 * are split by price before any rhythm is read.
 *
 * Dates are 'YYYY-MM-DD' strings; amounts are integer cents, negative
 * (money out). Transactions passed in are spending (spend.js's rule:
 * no card payments, transfers or savings moves) plus loan payments,
 * which are bills too (a car loan) even though they aren't spending.
 */

export const CADENCES = {
  WEEKLY: { days: 7, grace: 2, label: 'Weekly' },
  BIWEEKLY: { days: 14, grace: 3, label: 'Every 2 weeks' },
  MONTHLY: { days: 30.44, grace: 5, label: 'Monthly' },
  QUARTERLY: { days: 91.3, grace: 10, label: 'Quarterly' },
  ANNUAL: { days: 365.25, grace: 21, label: 'Yearly' },
};
const ORDER = ['ANNUAL', 'QUARTERLY', 'MONTHLY', 'BIWEEKLY', 'WEEKLY'];

const DAY = 86_400_000;
const utc = (iso) => Date.parse(`${iso}T00:00:00Z`);
export const daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / DAY);
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const dayOf = (iso_) => Number(iso_.slice(8, 10));
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const key = (s) => (s ?? '').trim().toLowerCase();

/* ------------------------------------------------------------------ dates */

/** One cycle from `date`. Monthly-ish cadences land on `day` (clamped to the month's length). */
export function step(date, cadence, n = 1, day = null) {
  const d = new Date(utc(date));
  if (cadence === 'WEEKLY' || cadence === 'BIWEEKLY') {
    d.setUTCDate(d.getUTCDate() + n * (cadence === 'WEEKLY' ? 7 : 14));
    return iso(d);
  }
  const months = { MONTHLY: 1, QUARTERLY: 3, ANNUAL: 12 }[cadence] * n;
  const target = day ?? d.getUTCDate();
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return iso(Date.UTC(y, m, Math.min(target, last)));
}

/* ------------------------------------------------------------------ rhythm */

/**
 * The rhythm a run of dates keeps, or null. Each gap must be about one
 * cycle, or a whole number of them (a skipped month is still monthly).
 * At least 75% of gaps must fit, and the typical gap must be a single
 * cycle, so a monthly bill isn't read as "weekly, mostly skipped".
 */
export function rhythmOf(dates) {
  const sorted = [...dates].sort();
  const gaps = sorted.slice(1).map((d, i) => daysBetween(sorted[i], d));
  if (gaps.length === 0) return null;
  for (const cadence of ORDER) {
    const { days } = CADENCES[cadence];
    const tol = Math.max(2, days * 0.1);
    const steps = gaps.map((g) => {
      const k = Math.max(1, Math.round(g / days));
      return Math.abs(g - k * days) <= tol * Math.sqrt(k) ? k : null;
    });
    const fits = steps.filter((k) => k !== null);
    if (fits.length / gaps.length >= 0.75 && median(fits) === 1) return cadence;
  }
  return null;
}

/* ------------------------------------------------------------------ matching */

/** The amounts a bill accepts: its fixed price ±3% (at least $1), or its variable range. */
export function acceptsAmount(bill, cents) {
  if (bill.amount_varies && bill.match_amount_min_cents != null && bill.match_amount_max_cents != null) {
    return cents >= bill.match_amount_min_cents && cents <= bill.match_amount_max_cents;
  }
  const tol = Math.max(100, Math.round(Math.abs(bill.expected_amount_cents) * 0.03));
  return Math.abs(cents - bill.expected_amount_cents) <= tol;
}

const live = (b) => b.status === 'ACTIVE' || b.status === 'PAUSED';

/** The day of the month a bill is due, from its set day or its dates. */
const billDay = (b) => b.match_days_of_month?.[0] ?? (b.next_expected_date ? dayOf(b.next_expected_date) : b.last_seen_date ? dayOf(b.last_seen_date) : null);

/** Days apart on a month's clock (the 30th and the 1st are two days apart). */
const dayGap = (a, b) => { const d = Math.abs(a - b); return Math.min(d, 31 - d); };

/**
 * Would this charge be a fixed bill at a new price (D364)? Same merchant, half
 * to double the price, on the bill's day (±3), and — when `taken` is given, the
 * bill's linked dates — that cycle not paid yet, so a ticket on the 21st isn't
 * taken for the membership charged on the 20th.
 */
export function priceChanged(t, bill, taken = null) {
  if (bill.amount_varies || !['MONTHLY', 'QUARTERLY', 'ANNUAL'].includes(bill.cadence)) return false;
  const was = Math.abs(bill.expected_amount_cents);
  const now = Math.abs(t.amount_cents);
  if (now > was * 2 || now < was / 2) return false;
  const day = billDay(bill);
  if (day == null || dayGap(day, dayOf(t.posted_date)) > 3) return false;
  const half = CADENCES[bill.cadence].days / 2;
  return !taken?.some((d) => Math.abs(daysBetween(d, t.posted_date)) < half);
}

const DAY_SLACK = 5;

/**
 * Days past its date before a bill is late. A bill paid by hand (amount varies)
 * gets ten: it's paid when it's paid, around the day its owner aims for (D365).
 */
export const graceOf = (bill) => (bill.amount_varies ? Math.max(10, CADENCES[bill.cadence].grace) : CADENCES[bill.cadence].grace);

/**
 * A fixed bill is charged on its day and once a cycle (D365): that's how a
 * membership is told from tickets bought at the same counter. Every fixed bill
 * on the real data had all its charges within five days of its day. A variable
 * bill (paid by hand, any day) and a weekly one aren't held to a day.
 */
export function onItsDay(t, b) {
  const day = billDay(b);
  return b.amount_varies || !['MONTHLY', 'QUARTERLY', 'ANNUAL'].includes(b.cadence) || day == null || dayGap(day, dayOf(t.posted_date)) <= DAY_SLACK;
}

/** No charge already linked to this fixed bill within half a cycle. Without `taken` (detection), not checked. */
function cycleFree(t, b, taken) {
  if (!taken || b.amount_varies) return true;
  const half = CADENCES[b.cadence].days / 2;
  return !(taken.get(b.id) ?? []).some((d) => Math.abs(daysBetween(d, t.posted_date)) < half);
}

/**
 * The live bill (active or paused) a charge belongs to: same merchant, an
 * accepted amount, on its day and once a cycle for a fixed bill, the closest
 * price; failing that, a fixed bill whose price changed (priceChanged).
 * `taken`: bill id → its linked dates. `pass` lets a caller link in rounds so
 * a cycle's real charge wins over a ticket near it: 'cents' (the exact price),
 * 'close' (within tolerance), then 'any' (also a new price).
 */
export const PASSES = ['cents', 'close', 'any'];
export function matchBill(t, bills, taken = null, { pass = 'any' } = {}) {
  if (!t.merchant || t.amount_cents >= 0) return null;
  const mine = bills.filter((b) => live(b) && key(b.match_name_contains) === key(t.merchant));
  const closest = (xs) => xs.sort((a, b) => Math.abs(a.expected_amount_cents - t.amount_cents) - Math.abs(b.expected_amount_cents - t.amount_cents))[0] ?? null;
  const fits = (b) => (pass === 'cents' ? b.amount_varies || t.amount_cents === b.expected_amount_cents : acceptsAmount(b, t.amount_cents));
  const found = closest(mine.filter((b) => fits(b) && onItsDay(t, b) && cycleFree(t, b, taken)));
  if (found || pass !== 'any') return found;
  return closest(mine.filter((b) => priceChanged(t, b, taken ? taken.get(b.id) ?? [] : null)));
}

/* ------------------------------------------------------------------ detection */

/**
 * Finding bills (D364). Two kinds, read differently:
 *
 *   fixed     one price on a steady rhythm (a subscription, a membership).
 *             Found from exact repeats in any category, so a membership is
 *             found among a cinema's tickets. Runs at different prices that
 *             follow one another on the same day are one bill whose price changed.
 *   variable  an amount that changes, often paid by hand and from any card
 *             (power, internet, phone). Only in bill-like categories. Charges
 *             a few days apart are one payment (a bill paid in two parts), and
 *             the rhythm is read from the calendar months it covers: a bill
 *             paid by hand moves around, skips a month or pays two at once.
 *
 * Charges under $1 (card checks, rounding) and money in are never bills.
 * Everything found is a suggestion with its confidence and evidence; a
 * person reviews it and adds it, or not.
 */

/** Categories whose merchants are bills by nature: two payments a month apart are enough to ask. */
export const BILL_CATEGORIES = new Set(['utilities', 'rent', 'insurance', 'phone', 'subscriptions', 'loan', 'fitness']);
const MICRO_CENTS = 100;
const SPLIT_DAYS = 3;

/** A suggestion's identity, for "ignore this one": merchant, rhythm, and the price (a variable bill has none). */
export const suggestionKey = (s) => `${key(s.merchant)}|${s.cadence}|${s.kind === 'variable' ? 'variable' : s.expected_amount_cents}`;

const monthsSpan = (a, b) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7)) + 1;
const byDate = (a, b) => a.posted_date.localeCompare(b.posted_date);

/** Charges a few days apart become one payment: a bill paid in two parts, or on two cards. */
export function paymentsOf(charges) {
  const out = [];
  for (const c of [...charges].sort(byDate)) {
    const last = out.at(-1);
    if (last && daysBetween(last.posted_date, c.posted_date) <= SPLIT_DAYS) {
      last.amount_cents += c.amount_cents;
      last.parts.push(c);
    } else out.push({ posted_date: c.posted_date, amount_cents: c.amount_cents, parts: [c] });
  }
  return out;
}

/** Exact-price runs that keep a rhythm. Weekly and fortnightly only for bill-like merchants (not a weekly coffee). */
export function fixedRuns(charges, billLike) {
  const byCents = new Map();
  for (const c of charges) byCents.set(c.amount_cents, [...(byCents.get(c.amount_cents) ?? []), c]);
  const runs = [];
  for (const [cents, same] of byCents) {
    if (same.length < 2) continue;
    const sorted = [...same].sort(byDate);
    const cadence = rhythmOf(sorted.map((c) => c.posted_date));
    if (!cadence) continue;
    if (!billLike && (cadence === 'WEEKLY' || cadence === 'BIWEEKLY')) continue;
    // Two charges are enough only a month or a year apart, on the same day of the month.
    if (sorted.length === 2) {
      if (cadence !== 'MONTHLY' && cadence !== 'ANNUAL') continue;
      if (Math.abs(dayOf(sorted[0].posted_date) - dayOf(sorted[1].posted_date)) > 3) continue;
    }
    runs.push({ cents, cadence, charges: sorted, first: sorted[0].posted_date, last: sorted.at(-1).posted_date });
  }
  return runs;
}

const runDay = (r) => Math.round(median(r.charges.map((c) => dayOf(c.posted_date))));

/** Runs that follow one another on the same rhythm and day, at a price within half or double, are one bill that changed price. */
export function chainPrices(runs) {
  const bills = [];
  for (const r of [...runs].sort((a, b) => a.first.localeCompare(b.first))) {
    const { days, grace } = CADENCES[r.cadence];
    const prev = bills.find((b) => b.cadence === r.cadence && b.last < r.first
      && daysBetween(b.last, r.first) <= days * 1.5 + grace
      && (r.cadence === 'WEEKLY' || r.cadence === 'BIWEEKLY' || Math.abs(runDay(b) - runDay(r)) <= 3)
      && Math.abs(r.cents) <= Math.abs(b.cents) * 2 && Math.abs(r.cents) >= Math.abs(b.cents) / 2);
    if (prev) {
      prev.charges.push(...r.charges);
      prev.last = r.last;
      prev.cents = r.cents;
      prev.prices.push({ from: r.first, cents: r.cents });
    } else bills.push({ ...r, charges: [...r.charges], prices: [{ from: r.first, cents: r.cents }] });
  }
  return bills;
}

/**
 * A variable monthly bill from a bill-like merchant's payments, or null. The
 * bill is each month's largest payment (rent paid in parts, a small extra
 * beside the bill): three or more months, covering at least 60% of the months
 * they span, each within a third to three times the typical one. Or just two
 * payments, 20 to 70 days apart (a bill that has only just started).
 * Returns the payments that are the bill, and the months they cover.
 */
export function variableBill(payments) {
  if (payments.length < 2) return null;
  const largest = new Map();
  for (const p of payments) {
    const m = p.posted_date.slice(0, 7);
    if (!largest.has(m) || p.amount_cents < largest.get(m).amount_cents) largest.set(m, p);
  }
  const picked = [...largest.values()].sort(byDate);
  const span = monthsSpan(picked[0].posted_date, picked.at(-1).posted_date);
  if (picked.length === 1) return null;
  if (payments.length === 2) {
    const gap = daysBetween(payments[0].posted_date, payments[1].posted_date);
    return gap >= 20 && gap <= 70 ? { payments, months: { covered: largest.size, span } } : null;
  }
  if (picked.length < 3 || picked.length / span < 0.6) return null;
  const typical = median(picked.map((p) => Math.abs(p.amount_cents)));
  if (picked.some((p) => Math.abs(p.amount_cents) > typical * 3 || Math.abs(p.amount_cents) < typical / 3)) return null;
  return { payments: picked, months: { covered: largest.size, span } };
}

function confidenceOf(kind, cadence, count) {
  if (kind === 'fixed') return count >= 4 || (cadence === 'ANNUAL' && count >= 3) ? 'high' : count >= 3 || cadence === 'ANNUAL' ? 'medium' : 'low';
  return count >= 6 ? 'high' : count >= 3 ? 'medium' : 'low';
}

function suggestion(merchant, { kind, cadence, charges, payments = null, prices = null, months = null }) {
  const sorted = [...charges].sort(byDate);
  const amounts = (payments ?? sorted).map((c) => Math.abs(c.amount_cents));
  const varies = kind === 'variable' || (prices?.length ?? 0) > 1 ? new Set(amounts).size > 1 : false;
  const day = ['MONTHLY', 'QUARTERLY', 'ANNUAL'].includes(cadence) ? Math.round(median((payments ?? sorted).map((c) => dayOf(c.posted_date)))) : null;
  // A variable bill accepts any of its parts (half paid on one card) up to its largest payment.
  const low = Math.min(...sorted.map((c) => Math.abs(c.amount_cents)));
  const high = Math.max(...amounts);
  const pad = Math.max(500, Math.round((high - low) * 0.25));
  // What to expect: a fixed bill's latest price; a variable one's average a month since it was
  // first seen (D368) — no fixed amount, and not just its last payment.
  const spanMonths = monthsSpan(sorted[0].posted_date, sorted.at(-1).posted_date);
  const expected = kind === 'fixed' ? prices.at(-1).cents : -Math.round(sorted.reduce((n, c) => n + Math.abs(c.amount_cents), 0) / spanMonths);
  const count = (payments ?? sorted).length;
  return {
    merchant,
    name: merchant,
    kind,
    cadence,
    day,
    expected_amount_cents: expected,
    amount_varies: kind === 'variable',
    match_amount_min_cents: kind === 'variable' ? -(high + pad) : null,
    match_amount_max_cents: kind === 'variable' ? -Math.max(0, low - pad) : null,
    count,
    confidence: confidenceOf(kind, cadence, count),
    prices: kind === 'fixed' && prices.length > 1 ? prices : [],
    accounts: new Set(sorted.map((c) => c.account_id).filter(Boolean)).size,
    split_payments: payments ? payments.filter((p) => p.parts.length > 1).length : 0,
    months,
    amounts_vary: varies,
    first_date: sorted[0].posted_date,
    last_date: sorted.at(-1).posted_date,
    charges: sorted,
  };
}

const stopped = (cadence, last, today, slack = 0) => today && daysBetween(last, today) > 2 * CADENCES[cadence].days + CADENCES[cadence].grace + slack;

/**
 * @param transactions spending rows: { id, posted_date, amount_cents, merchant, description, account_id, category }
 * @param bills existing bills (any status); charges a live bill already accepts aren't re-suggested
 * @param opts.today 'YYYY-MM-DD'; opts.ignored Set of suggestionKey / bare merchant keys
 */
export function detect(transactions, bills = [], { today, ignored = new Set() } = {}) {
  const byMerchant = new Map();
  for (const t of transactions) {
    if (!t.merchant || t.amount_cents > -MICRO_CENTS || matchBill(t, bills)) continue;
    const k = key(t.merchant);
    if (!byMerchant.has(k)) byMerchant.set(k, { name: t.merchant, charges: [] });
    byMerchant.get(k).charges.push(t);
  }

  const out = [];
  for (const [k, { name, charges }] of byMerchant) {
    if (ignored.has(k)) continue;
    const cats = new Map();
    for (const c of charges) cats.set(key(c.category), (cats.get(key(c.category)) ?? 0) + 1);
    const billLike = [...cats.entries()].some(([cat, n]) => BILL_CATEGORIES.has(cat) && n * 2 >= charges.length);

    const found = [];
    const used = new Set();
    for (const run of chainPrices(fixedRuns(charges, billLike))) {
      if (stopped(run.cadence, run.last, today)) continue;
      run.charges.forEach((c) => used.add(c));
      found.push(suggestion(name, { kind: 'fixed', cadence: run.cadence, charges: run.charges, prices: run.prices }));
    }

    const rest = charges.filter((c) => !used.has(c));
    if (billLike && (found.length === 0 || rest.length >= 3)) {
      const bill = variableBill(paymentsOf(rest));
      if (bill && !stopped('MONTHLY', bill.payments.at(-1).posted_date, today, 10)) {
        const { payments, months } = bill;
        payments.forEach((p) => p.parts.forEach((c) => used.add(c)));
        found.push(suggestion(name, { kind: 'variable', cadence: 'MONTHLY', charges: payments.flatMap((p) => p.parts), payments, months }));
      }
    }

    // A yearly fee beside a monthly bill: exactly one larger odd charge in
    // the last 13 months, next to a live monthly bill or suggestion.
    const monthly = [
      ...bills.filter((b) => b.status !== 'ENDED' && b.status !== 'ARCHIVED' && b.cadence === 'MONTHLY' && key(b.match_name_contains) === k),
      ...found.filter((s) => s.cadence === 'MONTHLY'),
    ].map((b) => Math.abs(b.expected_amount_cents));
    const latest = charges.reduce((m, c) => (c.posted_date > m ? c.posted_date : m), '');
    const singles = charges.filter((c) => !used.has(c) && daysBetween(c.posted_date, latest) <= 395);
    if (monthly.length > 0 && singles.length === 1 && Math.abs(singles[0].amount_cents) > Math.min(...monthly)) {
      found.push({ ...suggestion(name, { kind: 'fixed', cadence: 'ANNUAL', charges: singles, prices: [{ from: singles[0].posted_date, cents: singles[0].amount_cents }] }), name: `${name} yearly fee`, confidence: 'low' });
    }

    // Ignored keys are stored lowercased (routes/recurring.js); the cadence here is upper case.
    for (const s of found) if (!ignored.has(suggestionKey(s).toLowerCase())) out.push(s);
  }
  const rank = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => rank[a.confidence] - rank[b.confidence] || b.count - a.count || a.merchant.localeCompare(b.merchant));
}

/* ------------------------------------------------------------------ status */

/**
 * Where a bill stands today, from its own charges.
 *   due      — within 7 days
 *   upcoming — further out
 *   late     — past its date by more than the cadence's grace (5 days for monthly)
 *   stopped  — no charge for two whole cycles: probably cancelled, offer to end it
 *   paused / ended
 * `history` is the last six settled cycles, oldest first: paid, missed,
 * or null (before the bill's first charge).
 */
export function billStatus(bill, charges, today) {
  const { days } = CADENCES[bill.cadence];
  const grace = graceOf(bill);
  const dates = charges.map((c) => c.posted_date).sort();
  const last = dates[dates.length - 1] ?? bill.last_seen_date ?? null;
  const day = bill.match_days_of_month?.[0] ?? null;
  const next = last ? step(last, bill.cadence, 1, day) : bill.next_expected_date ?? null;
  const monthly_cents = Math.round(Math.abs(bill.expected_amount_cents) * (30.44 / days));

  let state;
  if (bill.status === 'ENDED' || bill.status === 'ARCHIVED') state = 'ended';
  else if (bill.status === 'PAUSED') state = 'paused';
  else if (!next) state = 'upcoming';
  else {
    const until = daysBetween(today, next);
    if (until < -(2 * days)) state = 'stopped';
    else if (until < -grace) state = 'late';
    else if (until <= 7) state = 'due';
    else state = 'upcoming';
  }

  // The six settled cycles (their grace has passed), each a window of
  // ± half a cycle around its expected date. A cycle still inside its
  // grace isn't "missed" yet, so it isn't shown at all.
  const history = [];
  if (next) {
    let expected = next;
    while (daysBetween(expected, today) <= grace) expected = step(expected, bill.cadence, -1, day);
    for (let i = 5; i >= 0; i--) {
      const at = step(expected, bill.cadence, -i, day);
      const half = days / 2;
      const hit = dates.some((d) => Math.abs(daysBetween(at, d)) <= half);
      const before = dates.length > 0 && daysBetween(dates[0], at) < -half;
      history.push({ date: at, paid: before ? null : hit });
    }
  }

  return { state, next_date: next, last_date: last, monthly_cents, history, until: next ? daysBetween(today, next) : null };
}

/* ------------------------------------------------------------------ month */

/**
 * One bill in one calendar month (D186): every date it was expected in
 * that month, each paid (the charge that covered it), missed (past its
 * grace, no charge), or due (still to come, or inside its grace). Dates
 * from before the bill's first charge aren't expected at all.
 *
 * @param month 'YYYY-MM'
 * @returns { occurrences: [{ date, state, charge }], status: 'missed'|'due'|'paid'|'none', paid_cents, due_cents }
 */
export function monthView(bill, charges, month, today) {
  const { days } = CADENCES[bill.cadence];
  const grace = graceOf(bill);
  const start = `${month}-01`;
  const [y, m] = month.split('-').map(Number);
  const end = iso(Date.UTC(y, m, 0));
  const day = bill.match_days_of_month?.[0] ?? null;
  const sorted = [...charges].sort((a, b) => a.posted_date.localeCompare(b.posted_date));
  const last = sorted.at(-1)?.posted_date ?? bill.next_expected_date;
  if (!last) return { occurrences: [], status: 'none', paid_cents: 0, due_cents: 0 };
  // Expected dates sit on the bill's own day (Netflix is due the 4th even when it charged the 3rd).
  const anchor = day ? step(last, bill.cadence, 0, day) : last;

  // Every expected date in the month, walking from the last real charge both ways.
  const expected = new Set();
  let e = anchor;
  while (e > end) e = step(e, bill.cadence, -1, day);
  while (e >= start) { expected.add(e); e = step(e, bill.cadence, -1, day); }
  e = step(anchor, bill.cadence, 1, day);
  while (e <= end) { if (e >= start) expected.add(e); e = step(e, bill.cadence, 1, day); }

  const first = sorted[0]?.posted_date;
  const half = days / 2;
  const used = new Set();
  const occurrences = [...expected]
    .sort()
    .filter((at) => !first || daysBetween(first, at) >= -half)
    .map((at) => {
      const hit = sorted
        .filter((c) => !used.has(c.id ?? c.posted_date) && Math.abs(daysBetween(at, c.posted_date)) <= half)
        .sort((a, b) => Math.abs(daysBetween(at, a.posted_date)) - Math.abs(daysBetween(at, b.posted_date)))[0];
      if (hit) {
        used.add(hit.id ?? hit.posted_date);
        // A variable bill paid in parts (two cards, two charges) counts whole (D364).
        const parts = bill.amount_varies
          ? sorted.filter((c) => !used.has(c.id ?? c.posted_date) && Math.abs(daysBetween(hit.posted_date, c.posted_date)) <= SPLIT_DAYS)
          : [];
        parts.forEach((c) => used.add(c.id ?? c.posted_date));
        return { date: at, state: 'paid', charge: { date: hit.posted_date, amount_cents: hit.amount_cents + parts.reduce((n, c) => n + c.amount_cents, 0) } };
      }
      return { date: at, state: daysBetween(at, today) > grace ? 'missed' : 'due', charge: null };
    });

  const status = occurrences.some((o) => o.state === 'missed') ? 'missed'
    : occurrences.some((o) => o.state === 'due') ? 'due'
    : occurrences.length > 0 ? 'paid' : 'none';
  return {
    occurrences,
    status,
    paid_cents: occurrences.filter((o) => o.charge).reduce((s, o) => s + o.charge.amount_cents, 0),
    due_cents: occurrences.filter((o) => o.state === 'due').length * bill.expected_amount_cents,
  };
}
