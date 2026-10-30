/**
 * Words for a card's dates (D270): "the 5th", and where its newest bill
 * stands, for the accounts list, the Cards page and the alerts. The API
 * sends `payment_due` (card-dates.js cardDue). Pure: tested in card-days.test.js.
 */

import { formatMoney } from '../../api.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (iso) => {
  const [, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
};

/** "5th", "1st", "22nd", and "last day" for 31 (the month's last day). */
export function dayWords(day) {
  if (day == null) return null;
  if (Number(day) === 31) return 'last day';
  const n = Number(day);
  const suffix = n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th';
  return `${n}${suffix}`;
}

/** "Closes on the 5th · due on the 2nd", from the card's own days, else what its statements suggest. */
export function cycleWords(account) {
  const closing = account.closing_day ?? account.date_suggestion?.closing?.day;
  const due = account.due_day ?? account.date_suggestion?.due?.day;
  const on = (d) => (Number(d) === 31 ? 'the last day' : `the ${dayWords(d)}`);
  const parts = [closing && `Closes on ${on(closing)}`, due && `due on ${on(due)}`].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

/** The short form for a list row: "Closes 5th · due 2nd" ("last day" for 31). */
export function cycleShort(account) {
  const closing = account.closing_day ?? account.date_suggestion?.closing?.day;
  const due = account.due_day ?? account.date_suggestion?.due?.day;
  const parts = [closing && `Closes ${dayWords(closing)}`, due && `due ${dayWords(due)}`].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

/** "From your statements: the 5th (6 of 6)", or null. */
export function suggestionWords(s) {
  if (!s) return null;
  return `From your statements: ${Number(s.day) === 31 ? 'the last day' : `the ${dayWords(s.day)}`} (${s.agree} of ${s.of})`;
}

const days = (n) => `${n} day${n === 1 ? '' : 's'}`;
const TONE = { overdue: 'spend', due_soon: 'warn', unconfirmed: 'warn', minimum_paid: 'warn', due: 'muted', paid: 'earn', nothing_due: 'muted', unknown: 'muted' };

/**
 * One line on a card's newest bill, and a tone: { text, tone } or null.
 *   "$19,880.00 due Nov 2 · in 16 days"      "$854.09 due today"
 *   "Paid · $627.87 was due Sep 10"          "$28,432.01 was due Oct 10 · paid? Statements run to Sep 14"
 */
export function dueLine(due) {
  if (!due) return null;
  const owed = formatMoney(due.remaining_cents);
  const when = due.due_date ? shortDate(due.due_date) : null;
  switch (due.status) {
    case 'nothing_due': return { text: 'Nothing due', tone: TONE.nothing_due };
    case 'paid': return { text: `Paid${when ? ` · ${formatMoney(due.owed_cents)} was due ${when}` : ''}`, tone: TONE.paid };
    case 'due': return { text: `${owed} due ${when} · in ${days(due.days_left)}`, tone: TONE.due };
    case 'due_soon': return { text: due.days_left === 0 ? `${owed} due today` : `${owed} due ${when} · in ${days(due.days_left)}`, tone: TONE.due_soon };
    case 'overdue': return { text: `${owed} was due ${when} · ${days(-due.days_left)} late`, tone: TONE.overdue };
    case 'minimum_paid': return { text: `Minimum paid · ${owed} left from ${when}, interest may apply`, tone: TONE.minimum_paid };
    case 'unconfirmed': return { text: `${owed} was due ${when} · paid? Statements run to ${due.seen_until ? shortDate(due.seen_until) : 'an earlier date'}`, tone: TONE.unconfirmed };
    default: return { text: `${owed} owed · due date not known`, tone: TONE.unknown };
  }
}
