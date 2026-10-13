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

/* ------------------------------------------------------------------ price */

/**
 * Split one merchant's charges into prices. Exact repeats first (to the
 * cent, even twice); then, if three or more charges are left, they're
 * one variable bill (a utility, rent that changes); otherwise one-offs.
 */
export function splitByPrice(charges) {
  const byCents = new Map();
  for (const c of charges) byCents.set(c.amount_cents, [...(byCents.get(c.amount_cents) ?? []), c]);
  const groups = [];
  const rest = [];
  for (const same of byCents.values()) (same.length >= 2 ? groups.push(same) : rest.push(...same));
  if (rest.length >= 3) groups.push(rest);
  else rest.forEach((c) => groups.push([c]));
  return groups;
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

/** The live bill (active or paused) a charge belongs to: same merchant, an accepted amount, the closest price. */
export function matchBill(t, bills) {
  if (!t.merchant || t.amount_cents >= 0) return null;
  const fits = bills.filter(
    (b) => (b.status === 'ACTIVE' || b.status === 'PAUSED') && key(b.match_name_contains) === key(t.merchant) && acceptsAmount(b, t.amount_cents)
  );
  fits.sort((a, b) => Math.abs(a.expected_amount_cents - t.amount_cents) - Math.abs(b.expected_amount_cents - t.amount_cents));
  return fits[0] ?? null;
}

/* ------------------------------------------------------------------ detection */

/** A suggestion's identity, for "ignore this one": merchant, rhythm, price. */
export const suggestionKey = (s) => `${key(s.merchant)}|${s.cadence}|${s.expected_amount_cents}`;

function suggestion(merchant, charges, cadence) {
  const dates = charges.map((c) => c.posted_date).sort();
  const amounts = charges.map((c) => c.amount_cents);
  const varies = new Set(amounts).size > 1;
  const abs = amounts.map(Math.abs);
  const day = ['MONTHLY', 'QUARTERLY', 'ANNUAL'].includes(cadence) ? Math.round(median(dates.map(dayOf))) : null;
  const pad = varies ? Math.max(500, Math.round((Math.max(...abs) - Math.min(...abs)) * 0.25)) : 0;
  return {
    merchant,
    name: merchant,
    cadence,
    day,
    expected_amount_cents: -Math.round(median(abs)),
    amount_varies: varies,
    match_amount_min_cents: varies ? -(Math.max(...abs) + pad) : null,
    match_amount_max_cents: varies ? -Math.max(0, Math.min(...abs) - pad) : null,
    count: charges.length,
    first_date: dates[0],
    last_date: dates[dates.length - 1],
    charges: [...charges].sort((a, b) => a.posted_date.localeCompare(b.posted_date)),
  };
}

/**
 * @param transactions spending rows: { id, posted_date, amount_cents, merchant, description, account_id }
 * @param bills existing bills (any status); charges a live bill already accepts aren't re-suggested
 * @param opts.today 'YYYY-MM-DD'; opts.ignored Set of suggestionKey / bare merchant keys
 */
export function detect(transactions, bills = [], { today, ignored = new Set() } = {}) {
  const byMerchant = new Map();
  for (const t of transactions) {
    if (!t.merchant || t.amount_cents >= 0 || matchBill(t, bills)) continue;
    const k = key(t.merchant);
    if (!byMerchant.has(k)) byMerchant.set(k, { name: t.merchant, charges: [] });
    byMerchant.get(k).charges.push(t);
  }

  const out = [];
  for (const [k, { name, charges }] of byMerchant) {
    if (ignored.has(k)) continue;
    const found = [];
    const singles = [];
    for (const group of splitByPrice(charges)) {
      if (group.length === 1) { singles.push(group[0]); continue; }
      const exact = new Set(group.map((c) => c.amount_cents)).size === 1;
      const cadence = rhythmOf(group.map((c) => c.posted_date));
      if (!cadence) continue;
      // Two charges are enough only at one exact price, a month or more apart,
      // on the same day of the month (two coffees on Mar 2 and Mar 30 aren't a bill).
      if (group.length === 2) {
        if (!exact || (cadence !== 'MONTHLY' && cadence !== 'ANNUAL')) continue;
        const [a, b] = group.map((c) => dayOf(c.posted_date));
        if (Math.abs(a - b) > 3) continue;
      }
      const s = suggestion(name, group, cadence);
      // A bill that stopped (no charge for two cycles) isn't worth suggesting.
      if (today && daysBetween(s.last_date, today) > 2 * CADENCES[cadence].days + CADENCES[cadence].grace) continue;
      found.push(s);
    }

    // A yearly fee beside a monthly bill: exactly one larger odd charge in
    // the last 13 months, next to a live monthly bill or suggestion.
    const monthly = [
      ...bills.filter((b) => b.status !== 'ENDED' && b.status !== 'ARCHIVED' && b.cadence === 'MONTHLY' && key(b.match_name_contains) === k),
      ...found.filter((s) => s.cadence === 'MONTHLY'),
    ].map((b) => Math.abs(b.expected_amount_cents));
    const latest = charges.reduce((m, c) => (c.posted_date > m ? c.posted_date : m), '');
    const recent = singles.filter((c) => daysBetween(c.posted_date, latest) <= 395);
    if (monthly.length > 0 && recent.length === 1 && Math.abs(recent[0].amount_cents) > Math.min(...monthly)) {
      found.push({ ...suggestion(name, recent, 'ANNUAL'), name: `${name} yearly fee` });
    }

    // Ignored keys are stored lowercased (routes/recurring.js); the cadence here is upper case.
    for (const s of found) if (!ignored.has(suggestionKey(s).toLowerCase())) out.push(s);
  }
  return out.sort((a, b) => b.count - a.count || a.merchant.localeCompare(b.merchant));
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
  const { days, grace } = CADENCES[bill.cadence];
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
  const { days, grace } = CADENCES[bill.cadence];
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
        return { date: at, state: 'paid', charge: { date: hit.posted_date, amount_cents: hit.amount_cents } };
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
