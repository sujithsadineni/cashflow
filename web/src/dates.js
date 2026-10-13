/**
 * Calendar-date helpers for the date pickers (D230). Dates travel as ISO
 * strings ('2026-09-30'), the same shape the API and the old <input
 * type="date"> used; Date objects are only built locally, at midnight,
 * so no time zone can shift a day.
 */

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const pad = (n) => String(n).padStart(2, '0');
export const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function fromISO(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export const todayISO = () => toISO(new Date());
/** The first of the month `n` months from `d`'s month. */
export const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);
const lastOfMonth = (y, m) => new Date(y, m + 1, 0);

/** A month's days for a Sunday-first grid: how many blanks lead, then each day's ISO. */
export function monthDays(first) {
  const y = first.getFullYear();
  const m = first.getMonth();
  const count = lastOfMonth(y, m).getDate();
  return { lead: new Date(y, m, 1).getDay(), days: Array.from({ length: count }, (_, i) => toISO(new Date(y, m, i + 1))) };
}

/** The range shortcuts, relative to today. "All time" clears both ends. */
export function rangePresets(today = todayISO()) {
  const t = fromISO(today);
  const y = t.getFullYear();
  const m = t.getMonth();
  const prev = addMonths(t, -1);
  return [
    { label: 'This month', from: toISO(new Date(y, m, 1)), to: today, hint: MONTHS_SHORT[m] },
    { label: 'Last month', from: toISO(prev), to: toISO(lastOfMonth(prev.getFullYear(), prev.getMonth())), hint: MONTHS_SHORT[prev.getMonth()] },
    { label: 'Last 3 months', from: toISO(addMonths(t, -2)), to: today, hint: `${MONTHS_SHORT[addMonths(t, -2).getMonth()]}–${MONTHS_SHORT[m]}` },
    { label: 'This year', from: `${y}-01-01`, to: today, hint: String(y) },
    { label: 'Last year', from: `${y - 1}-01-01`, to: `${y - 1}-12-31`, hint: String(y - 1) },
    { label: 'All time', from: '', to: '', hint: '' },
  ];
}

/** The shortcut whose range this is exactly, if any. */
export const presetFor = (from, to, today) => rangePresets(today).find((p) => p.from === (from ?? '') && p.to === (to ?? '') && p.from) ?? null;

/** "Sep 1", or "Sep 1, 2025" outside the current year. */
export function shortDate(iso, today = todayISO()) {
  const d = fromISO(iso);
  const sameYear = iso.slice(0, 4) === today.slice(0, 4);
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}${sameYear ? '' : `, ${d.getFullYear()}`}`;
}

/** What a range reads as: its shortcut's name, "Sep 1 – Sep 30", an open end, or "Any date". */
export function rangeLabel(from, to, today = todayISO()) {
  const preset = presetFor(from, to, today);
  if (preset) return preset.label;
  if (from && to) return from === to ? shortDate(from, today) : `${shortDate(from, today)} – ${shortDate(to, today)}`;
  if (from) return `From ${shortDate(from, today)}`;
  if (to) return `Until ${shortDate(to, today)}`;
  return 'Any date';
}

/** The days a range covers, compactly: "Sep 1–30", "Aug 14 – Oct 12", "Jan 1 – Dec 31, 2025". */
export function rangeDays(from, to, today = todayISO()) {
  if (!from || !to) return '';
  const a = fromISO(from);
  const b = fromISO(to);
  const yearTail = from.slice(0, 4) === to.slice(0, 4) && from.slice(0, 4) !== today.slice(0, 4) ? `, ${a.getFullYear()}` : '';
  if (from.slice(0, 7) === to.slice(0, 7)) return `${MONTHS_SHORT[a.getMonth()]} ${a.getDate()}–${b.getDate()}${yearTail}`;
  if (yearTail) return `${MONTHS_SHORT[a.getMonth()]} ${a.getDate()} – ${MONTHS_SHORT[b.getMonth()]} ${b.getDate()}${yearTail}`;
  return `${shortDate(from, today)} – ${shortDate(to, today)}`;
}

/** Days in a range, both ends counted. */
export const dayCount = (from, to) => Math.round((fromISO(to) - fromISO(from)) / 864e5) + 1;

/** "Sun, March 15, 2025". */
export function longDate(iso) {
  const d = fromISO(iso);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' });
}
