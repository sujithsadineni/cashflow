/**
 * Recurring in plain words (D316): which section a bill sits in for the month
 * on screen, the one line that says where it stands, and the month's totals.
 * The rules themselves live in api/src/money/bills.js; this only words them.
 * Pure; tested in bill-view.test.js.
 */
import { formatMoney, formatShortDate } from '../../api.js';
import { MONTHS_LONG } from '../app/dates.js';

export const CADENCES = [
  { value: 'WEEKLY', label: 'Weekly' },
  { value: 'BIWEEKLY', label: 'Every 2 weeks' },
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'QUARTERLY', label: 'Quarterly' },
  { value: 'ANNUAL', label: 'Yearly' },
];
const CADENCE_LABEL = Object.fromEntries(CADENCES.map((c) => [c.value, c.label]));
export const HAS_DAY = new Set(['MONTHLY', 'QUARTERLY', 'ANNUAL']);

const ordinal = (n) => `${n}${[11, 12, 13].includes(n % 100) ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
const monthName = (ym) => MONTHS_LONG[Number(ym.slice(5, 7)) - 1];

/** "Monthly · on the 25th". */
export function cadenceLine(bill) {
  const day = bill.match_days_of_month?.[0];
  return `${CADENCE_LABEL[bill.cadence] ?? bill.cadence}${day && HAS_DAY.has(bill.cadence) ? ` · on the ${ordinal(day)}` : ''}`;
}

/** The section a bill sits in for `month` (D186): late only shows on this month. */
export function sectionOf(bill, month, thisMonth) {
  if (bill.state === 'ended' || bill.state === 'paused') return 'off';
  if (month === thisMonth && (bill.state === 'late' || bill.state === 'stopped')) return 'late';
  return bill.month?.status ?? 'none';
}

/** The sections, in order, each with its bills soonest first; empty ones left out. */
export function sections(bills, month, thisMonth) {
  const name = monthName(month);
  const order = [
    { key: 'late', label: 'Late' },
    { key: 'due', label: `Due in ${name}` },
    { key: 'missed', label: `Missed in ${name}` },
    { key: 'paid', label: `Paid in ${name}` },
    { key: 'none', label: `Not due in ${name}` },
    { key: 'off', label: 'Paused and ended' },
  ];
  const byDate = (a, b) => (a.next_date ?? '9999').localeCompare(b.next_date ?? '9999') || a.name.localeCompare(b.name);
  return order
    .map((s) => ({ ...s, bills: bills.filter((b) => sectionOf(b, month, thisMonth) === s.key).sort(byDate) }))
    .filter((s) => s.bills.length > 0);
}

/**
 * Where a bill stands, in one short line, and whether it's a problem:
 * "Paid Oct 7", "Due Oct 25 · in 7 days", "23 days late", "Paused".
 */
export function statusLine(bill, month) {
  if (bill.state === 'ended') return { text: 'Ended', tone: 'muted' };
  if (bill.state === 'paused') return { text: 'Paused', tone: 'muted' };
  if (bill.state === 'late' || bill.state === 'stopped') {
    const late = bill.until != null && bill.until < 0 ? -bill.until : null;
    return { text: late ? `${late} ${late === 1 ? 'day' : 'days'} late` : 'Late', tone: 'spend' };
  }
  const occ = bill.month?.occurrences ?? [];
  if (occ.length > 1) {
    const paid = occ.filter((o) => o.state === 'paid').length;
    return { text: `${paid} of ${occ.length} paid`, tone: occ.some((o) => o.state === 'missed') ? 'spend' : 'ink' };
  }
  const [o] = occ;
  if (o?.state === 'paid') return { text: `Paid ${formatShortDate(o.charge.date)}`, tone: 'muted' };
  if (o?.state === 'missed') return { text: `Missed ${formatShortDate(o.date)}`, tone: 'spend' };
  if (o?.state === 'due') {
    const n = bill.until;
    const when = n == null ? '' : n === 0 ? ' · today' : n === 1 ? ' · tomorrow' : n > 1 ? ` · in ${n} days` : ' · not charged yet';
    return { text: `Due ${formatShortDate(o.date)}${when}`, tone: 'ink' };
  }
  return { text: bill.next_date ? `Next ${formatShortDate(bill.next_date)}` : `Not due in ${monthName(month)}`, tone: 'muted' };
}

/** "Up $2.50 since Mar 1" when the price changed in the last six months. */
export function priceNote(bill, today) {
  const p = bill.price_change;
  if (!p) return null;
  const sixMonthsAgo = `${Number(today.slice(0, 4)) - (Number(today.slice(5, 7)) <= 6 ? 1 : 0)}-${String(((Number(today.slice(5, 7)) + 5) % 12) + 1).padStart(2, '0')}${today.slice(7)}`;
  if (p.since < sixMonthsAgo) return null;
  const diff = p.to_cents - p.from_cents;
  return { text: `${diff > 0 ? 'Up' : 'Down'} ${formatMoney(Math.abs(diff))} since ${formatShortDate(p.since)}`, up: diff > 0 };
}

/** The month on screen: what the live bills cost a month, and what's paid, due and missed in it. */
export function monthTotals(bills) {
  const live = bills.filter((b) => b.state !== 'paused' && b.state !== 'ended');
  const sum = (f) => live.reduce((s, b) => s + Math.abs(f(b) ?? 0), 0);
  return {
    count: live.length,
    monthly_cents: sum((b) => b.monthly_cents),
    paid_cents: sum((b) => b.month?.paid_cents),
    due_cents: sum((b) => b.month?.due_cents),
    missed: live.filter((b) => b.month?.status === 'missed').length,
  };
}
