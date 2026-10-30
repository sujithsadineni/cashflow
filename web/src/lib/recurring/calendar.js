/**
 * The Recurring calendar (D321): the month as a grid, each recurring charge
 * on its day with where it stands, and the bills sorted into the four tabs
 * under it. Pure; tested in calendar.test.js.
 */

const pad = (n) => String(n).padStart(2, '0');
const lastDay = (ym) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();

/** The month's days in weeks, Sunday first: null before the 1st and after the last. */
export function monthGrid(ym) {
  const first = new Date(`${ym}-01T00:00:00`).getDay();
  const days = Array.from({ length: lastDay(ym) }, (_, i) => `${ym}-${pad(i + 1)}`);
  const cells = [...Array(first).fill(null), ...days];
  while (cells.length % 7) cells.push(null);
  return cells;
}

/** The month on either side: '2026-10' → '2026-09' / '2026-11'. */
export function shiftMonth(ym, n) {
  const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

/**
 * Each recurring charge of the month on its day (D186's occurrences):
 *   paid      charged (on the day it was charged)
 *   upcoming  its day hasn't come
 *   waiting   its day has passed and no charge is seen yet (it blinks)
 *   missed    the month is over without it
 * @returns Map<'YYYY-MM-DD', [{ bill_id, name, merchant, glyph, state, cents }]>
 */
export function billMarks(bills, today) {
  const out = new Map();
  for (const b of bills) {
    if (b.state === 'paused' || b.state === 'ended') continue;
    for (const o of b.month?.occurrences ?? []) {
      const date = o.state === 'paid' ? o.charge?.date ?? o.date : o.date;
      const state = o.state === 'paid' ? 'paid' : o.state === 'missed' ? 'missed' : date >= today ? 'upcoming' : 'waiting';
      const cents = Math.abs(o.charge?.amount_cents ?? b.expected_amount_cents ?? 0);
      (out.get(date) ?? out.set(date, []).get(date)).push({ bill_id: b.id, name: b.name, merchant: b.match_name_contains, glyph: b.glyph, state, cents });
    }
  }
  return out;
}

/**
 * The four tabs under the calendar, for the month on screen:
 *   due     due this month and not yet charged (or not due this month: later)
 *   paid    charged this month
 *   late    past their day with no charge seen, or late on their rhythm
 *   off     paused or ended
 */
export function billTabs(bills, month, thisMonth) {
  const tabs = { due: [], later: [], paid: [], late: [], off: [] };
  for (const b of bills) {
    if (b.state === 'paused' || b.state === 'ended') { tabs.off.push(b); continue; }
    const status = b.month?.status ?? 'none';
    const late = (month === thisMonth && (b.state === 'late' || b.state === 'stopped')) || status === 'missed';
    if (late) tabs.late.push(b);
    else if (status === 'paid') tabs.paid.push(b);
    else if (status === 'due') tabs.due.push(b);
    else tabs.later.push(b);
  }
  const byDate = (a, b) => (a.next_date ?? '9999').localeCompare(b.next_date ?? '9999') || a.name.localeCompare(b.name);
  for (const k of Object.keys(tabs)) tabs[k].sort(byDate);
  return tabs;
}
