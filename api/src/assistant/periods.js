/**
 * The time a question asks about (D332 step 3), read from its words:
 * "this month", "last month", "YTD", "2025", "March", "since March", "last 3
 * months", "last 30 days", "same month last year". Pure: every phrase is
 * read against the `today` given, so tests pin it. A period is
 * { from, to, label } with ISO dates, both ends included; one that reaches
 * today is labelled "so far".
 */

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const SHORT = MONTHS.map((m) => m.slice(0, 3));
const NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const MONTH_WORD = `(${MONTHS.join('|')}|${SHORT.join('|')}|sept)`;

const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const parts = (s) => s.split('-').map(Number);
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const addDays = (s, n) => {
  const [y, m, d] = parts(s);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
/** Month `m` (1-12) of `y` shifted by `k` months: [year, month]. */
const shiftMonth = (y, m, k) => {
  const i = y * 12 + (m - 1) + k;
  return [Math.floor(i / 12), (i % 12) + 1];
};
const monthIndex = (word) => {
  const w = word === 'sept' ? 'sep' : word;
  return SHORT.indexOf(w.slice(0, 3)) + 1;
};
const short = (m) => MONTHS[m - 1][0].toUpperCase() + MONTHS[m - 1].slice(1, 3);
const fmt = (s) => {
  const [y, m, d] = parts(s);
  return { y, m, d };
};

/** Clip a period to today and label it; null when it starts after today. */
function make(from, to, today, label) {
  if (from > today) return null;
  const end = to > today ? today : to;
  return { from, to: end, label: end < to ? `${label} so far` : label };
}
const monthPeriod = (y, m, today) => make(iso(y, m, 1), iso(y, m, daysIn(y, m)), today, `${short(m)} ${y}`);
const yearPeriod = (y, today) => make(iso(y, 1, 1), iso(y, 12, 31), today, String(y));
function spanLabel(from, to) {
  const a = fmt(from);
  const b = fmt(to);
  if (a.d === 1 && b.d === daysIn(b.y, b.m)) {
    if (a.y === b.y && a.m === b.m) return `${short(a.m)} ${a.y}`;
    return a.y === b.y ? `${short(a.m)}–${short(b.m)} ${b.y}` : `${short(a.m)} ${a.y} – ${short(b.m)} ${b.y}`;
  }
  return a.y === b.y ? `${short(a.m)} ${a.d} – ${short(b.m)} ${b.d}, ${b.y}` : `${short(a.m)} ${a.d}, ${a.y} – ${short(b.m)} ${b.d}, ${b.y}`;
}

/**
 * Every period named in `text` (lower-cased), in the order written, each with
 * the span of text it came from. Overlapping phrases are read once: the
 * longer, earlier rule wins ("same month last year" isn't also "last year").
 */
export function findPeriods(text, today) {
  const t = ` ${text.toLowerCase()} `;
  const { y, m } = fmt(today);
  const found = [];
  const taken = [];
  const free = (a, b) => taken.every(([x, z]) => b <= x || a >= z);
  const rule = (re, build) => {
    for (const match of t.matchAll(re)) {
      const a = match.index;
      const b = a + match[0].length;
      if (!free(a, b)) continue;
      const p = build(match);
      taken.push([a, b]);
      if (p) found.push({ ...p, at: a });
    }
  };
  const count = (w) => Number(w) || NUMBERS[w];

  rule(/\bsame month last year\b/g, () => monthPeriod(y - 1, m, today));
  rule(/\b(?:last|past|previous) (\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve) months\b/g, (mt) => {
    const n = count(mt[1]);
    const [fy, fm] = shiftMonth(y, m, -n);
    const [ty, tm] = shiftMonth(y, m, -1);
    const from = iso(fy, fm, 1);
    const to = iso(ty, tm, daysIn(ty, tm));
    return { from, to, label: spanLabel(from, to) };
  });
  rule(/\b(?:last|past) (\d+) days\b/g, (mt) => {
    const from = addDays(today, -(Number(mt[1]) - 1));
    return { from, to: today, label: `last ${mt[1]} days` };
  });
  rule(new RegExp(`\\bsince ${MONTH_WORD}(?: (\\d{4}))?\\b`, 'g'), (mt) => {
    const mi = monthIndex(mt[1]);
    const yy = mt[2] ? Number(mt[2]) : mi > m ? y - 1 : y;
    const from = iso(yy, mi, 1);
    return make(from, today, today, `since ${short(mi)} ${yy}`);
  });
  rule(/\b(?:this|current) month\b|\bmonth to date\b|\bmtd\b/g, () => monthPeriod(y, m, today));
  rule(/\b(?:last|previous|past) month\b/g, () => monthPeriod(...shiftMonth(y, m, -1), today));
  rule(/\b(?:this|current) year\b|\bytd\b|\byear to date\b/g, () => yearPeriod(y, today));
  rule(/\b(?:last|previous|past) year\b/g, () => yearPeriod(y - 1, today));
  rule(/\b(?:this|current) week\b/g, () => {
    const day = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday is 0
    return { from: addDays(today, -day), to: today, label: 'this week so far' };
  });
  rule(/\b(?:last|previous) week\b/g, () => {
    const day = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
    const from = addDays(today, -day - 7);
    return { from, to: addDays(from, 6), label: 'last week' };
  });
  rule(new RegExp(`\\b${MONTH_WORD}(?: (\\d{4}))?\\b`, 'g'), (mt) => {
    // "may" is also a verb: only as a month with a year, or after in/for/of/during/since.
    if (mt[1] === 'may' && !mt[2] && !/\b(?:in|for|of|during|from|to|vs|and) $/.test(t.slice(0, mt.index))) return null;
    const mi = monthIndex(mt[1]);
    const yy = mt[2] ? Number(mt[2]) : mi > m ? y - 1 : y;
    return monthPeriod(yy, mi, today);
  });
  rule(/\b(20[0-3]\d)\b/g, (mt) => yearPeriod(Number(mt[1]), today));

  const seen = new Set();
  return found
    .sort((a, b) => a.at - b.at)
    .filter((p) => !seen.has(`${p.from}|${p.to}`) && seen.add(`${p.from}|${p.to}`))
    .map(({ at, ...p }) => p);
}

/**
 * The period just before `p`, the same length, for "compare" with one period
 * named: a month → the month before, a year so far → last year to the same
 * day, a full year → the year before, anything else → the same number of
 * days just before it.
 */
export function previousPeriod(p, today) {
  const a = fmt(p.from);
  const b = fmt(p.to);
  if (a.d === 1 && a.y === b.y && a.m === b.m) {
    const [py, pm] = shiftMonth(a.y, a.m, -1);
    if (p.to === today && b.d < daysIn(b.y, b.m)) {
      // This month so far: last month to the same day, so the two are like for like.
      const to = iso(py, pm, Math.min(b.d, daysIn(py, pm)));
      return { from: iso(py, pm, 1), to, label: `${short(pm)} ${py} to the ${ordinal(Math.min(b.d, daysIn(py, pm)))}` };
    }
    return monthPeriod(py, pm, today);
  }
  if (a.m === 1 && a.d === 1 && a.y === b.y) {
    if (b.m === 12 && b.d === 31) return yearPeriod(a.y - 1, today);
    const to = iso(a.y - 1, b.m, Math.min(b.d, daysIn(a.y - 1, b.m)));
    return { from: iso(a.y - 1, 1, 1), to, label: `${a.y - 1} to ${short(b.m)} ${Math.min(b.d, daysIn(a.y - 1, b.m))}` };
  }
  const len = (Date.parse(p.to) - Date.parse(p.from)) / 86_400_000;
  const to = addDays(p.from, -1);
  const from = addDays(to, -len);
  return { from, to, label: spanLabel(from, to) };
}

function ordinal(n) {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th');
  return `${n}${s}`;
}

/**
 * A period from two dates (Ask Claude's tools pick them): a whole year or
 * month gets its usual label, anything else its span; clipped to today
 * ("so far"); null when it starts after today.
 */
export function periodBetween(from, to, today) {
  if (from > to) [from, to] = [to, from];
  const a = fmt(from);
  const b = fmt(to);
  if (a.y === b.y && a.m === 1 && a.d === 1 && b.m === 12 && b.d === 31) return yearPeriod(a.y, today);
  if (a.y === b.y && a.m === b.m && a.d === 1 && b.d === daysIn(b.y, b.m)) return monthPeriod(a.y, a.m, today);
  // From the start of this year or month up to today: "2026 so far", as Answer here says it.
  const t = fmt(today);
  if (to >= today && a.d === 1 && a.y === t.y && a.m === 1) return yearPeriod(a.y, today);
  if (to >= today && a.d === 1 && a.y === t.y && a.m === t.m) return monthPeriod(a.y, a.m, today);
  if (from > today) return null;
  const end = to > today ? today : to;
  return { from, to: end, label: `${spanLabel(from, end)}${end < to ? ' so far' : ''}` };
}

/** Jan 1 of today's year to today: what a question with no time in it means. */
export const yearToDate = (today) => yearPeriod(fmt(today).y, today);

/** Every month a period touches, as 'YYYY-MM'. */
export function monthsIn(p) {
  const a = fmt(p.from);
  const b = fmt(p.to);
  const out = [];
  for (let [yy, mm] = [a.y, a.m]; yy < b.y || (yy === b.y && mm <= b.m); [yy, mm] = shiftMonth(yy, mm, 1)) out.push(`${yy}-${pad(mm)}`);
  return out;
}
