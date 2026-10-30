/**
 * A card's usual closing day and payment due day (D270), and the dates
 * they fall on. Pure: tested in card-dates.test.js.
 *
 * Learned from its statements: the day of the month each closed on, and
 * the due date each printed. Only the newest few count, because a card
 * can move its dates (a Zolve card's due day went from the 10th to the
 * 14th in July), and the answer says how many agreed so the edit form
 * can show "9 of 9 statements" or "2 of 3".
 *
 * Day 31 means the month's last day: Apple closes on the 28th in
 * February and the 31st in March, and that's one rule, not two.
 */

const RECENT = 6;

const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const dayOf = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  // The month's last day reads as 31: "the last day", whatever the month's length.
  return d === lastDay(y, m) && d >= 28 ? 31 : d;
};

function usual(dates) {
  const recent = dates.filter(Boolean).sort().slice(-RECENT);
  if (recent.length === 0) return null;
  const counts = new Map();
  for (const d of recent) counts.set(dayOf(d), (counts.get(dayOf(d)) ?? 0) + 1);
  const latest = dayOf(recent.at(-1));
  // Most common; a tie goes to the newest statement's day.
  const [day, agree] = [...counts.entries()].sort((a, b) => b[1] - a[1] || (b[0] === latest) - (a[0] === latest))[0];
  return { day, agree, of: recent.length };
}

/**
 * @param statements [{ period_end, payment_due_date }]
 * @returns { closing: { day, agree, of } | null, due: { day, agree, of } | null }
 */
export function suggestCardDays(statements) {
  return {
    closing: usual(statements.map((s) => s.period_end)),
    due: usual(statements.map((s) => s.payment_due_date)),
  };
}

/** The date `day` falls on in a month: day 31, or any day past the month's end, is its last day. */
export function dateInMonth(year, month, day) {
  const d = Math.min(day, lastDay(year, month));
  return `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** The first date on or after `from` ('YYYY-MM-DD') that falls on `day` of its month. */
export function nextOnDay(day, from) {
  let [y, m] = from.split('-').map(Number);
  for (let i = 0; i < 3; i++) {
    const date = dateInMonth(y, m, day);
    if (date >= from) return date;
    if (m === 12) { y += 1; m = 1; } else m += 1;
  }
  return null;
}

/** "5th", "1st", "22nd", and "last day" for 31. */
export function dayWords(day) {
  if (day == null) return null;
  if (day === 31) return 'last day';
  const suffix = day % 10 === 1 && day !== 11 ? 'st' : day % 10 === 2 && day !== 12 ? 'nd' : day % 10 === 3 && day !== 13 ? 'rd' : 'th';
  return `${day}${suffix}`;
}

const DAY = 86_400_000;
const daysFrom = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
export const DUE_SOON_DAYS = 5;

/**
 * Where a card stands on its newest statement's bill (D270).
 *
 * @param statement { period_end, payment_due_date, closing_balance_cents, minimum_payment_cents } its newest statement
 * @param paidCents payments that posted on the card after the statement closed
 * @param dueDay    the card's due day, for a statement whose date wasn't read
 * @returns null without a statement; else { due_date, owed_cents, minimum_cents, paid_cents,
 *          remaining_cents, minimum_remaining_cents, days_left, status }, status one of:
 *          nothing_due  the statement owed nothing
 *          paid         the statement balance is paid
 *          due          not paid yet, more than DUE_SOON_DAYS away
 *          due_soon     not paid yet, due within DUE_SOON_DAYS
 *          overdue      past its date with the minimum not paid
 *          minimum_paid past its date, the minimum paid but not the balance (interest starts)
 *          unconfirmed  past its date and nothing paid seen, but the statements that would
 *                       show a payment don't reach the due date yet: never called overdue
 *          unknown      something's owed but there's no due date to judge by
 * @param seenUntil the last day the app can see payments to this card on (its own and its
 *                  paying banks' statements); null when it can't tell
 */
export function cardDue({ statement, paidCents = 0, dueDay = null, today, seenUntil = null }) {
  if (!statement) return null;
  const owed = Math.max(0, statement.closing_balance_cents ?? 0);
  const due_date = statement.payment_due_date ?? (dueDay ? nextOnDay(dueDay, statementAfter(statement.period_end)) : null);
  const minimum = statement.minimum_payment_cents ?? null;
  const remaining = Math.max(0, owed - paidCents);
  const minimumRemaining = minimum == null ? remaining : Math.max(0, minimum - paidCents);
  const days_left = due_date ? daysFrom(today, due_date) : null;
  let status;
  if (owed === 0) status = 'nothing_due';
  else if (remaining === 0) status = 'paid';
  else if (!due_date) status = 'unknown';
  else if (days_left < 0 && (!seenUntil || seenUntil < due_date)) status = 'unconfirmed';
  else if (days_left < 0) status = minimumRemaining > 0 ? 'overdue' : 'minimum_paid';
  else if (days_left <= DUE_SOON_DAYS) status = 'due_soon';
  else status = 'due';
  return {
    due_date,
    owed_cents: owed,
    minimum_cents: minimum,
    paid_cents: paidCents,
    remaining_cents: remaining,
    minimum_remaining_cents: minimumRemaining,
    days_left,
    seen_until: seenUntil,
    status,
  };
}
// A due day counts from the day after the statement closed: a bill is never due the day it's issued.
const statementAfter = (periodEnd) => new Date(Date.parse(periodEnd) + DAY).toISOString().slice(0, 10);

/** The close after one on `lastClose` (D270): the next `closingDay` at least three weeks later, since a cycle is a month. */
export function nextClose(lastClose, closingDay) {
  const after = new Date(Date.parse(lastClose) + 20 * DAY).toISOString().slice(0, 10);
  return nextOnDay(closingDay, after);
}
