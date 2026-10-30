/**
 * A question in words → what to look up (D332 step 3). Pure: the
 * vocabulary (vocab.js) and today's date come in.
 *
 *   "rent this year"                    → total,    Rent,      2026 so far
 *   "utilities this month vs last"      → compare,  Utilities, Oct so far vs Sep to the 23rd
 *   "groceries by month"                → by_month, Groceries, 2026 so far
 *   "top 10 merchants last month"       → top merchants, everything, Sep
 *
 * Not understood when it names nothing to look up and doesn't ask about
 * spending as a whole; a word that fits several names comes back as
 * choices, each a rewritten question to ask instead.
 */

import { findPeriods, previousPeriod, yearToDate } from './periods.js';
import { findSubjects, normalize } from './vocab.js';

const COMPARE = /\b(vs|versus|compared?|against)\b/;
const BY_MONTH = /\b(by month|monthly|each month|per month|month by month|every month|trend|over time|breakdown|average|avg)\b/;
const TOP = /\b(top|biggest|largest|highest|most expensive|most)\b/;
const OVERALL = /\b(spend|spent|spending|expenses?|expenditure|cost|costs|paid|pay)\b/;

function topOf(t, subjects) {
  if (/\b(categor(y|ies))\b/.test(t)) return 'categories';
  if (/\b(purchases?|transactions?|charges?|expenses?|payments?|buys?)\b/.test(t)) return 'purchases';
  if (/\b(merchants?|stores?|shops?|places?|vendors?)\b/.test(t)) return 'merchants';
  if (subjects.length === 0) return 'categories';
  return subjects.some((s) => s.kind === 'merchant') ? 'purchases' : 'merchants';
}

export function parseQuestion(question, vocab, today) {
  const t = normalize(question);
  const { subjects, choices } = findSubjects(question, vocab);
  let periods = findPeriods(t, today);

  let intent = 'total';
  if (COMPARE.test(t) || periods.length >= 2) intent = 'compare';
  else if (TOP.test(t)) intent = 'top';
  else if (BY_MONTH.test(t)) intent = 'by_month';

  if (choices && subjects.length === 0) {
    return {
      understood: false,
      reason: 'choose',
      message: `"${choices.word}" could be several things. Which one?`,
      choices: choices.options.map((o) => ({
        label: o.name,
        kind: o.kind,
        question: question.replace(new RegExp(`\\b${choices.word}\\b`, 'i'), o.name),
      })),
    };
  }
  // A name found from one word alone ("hello" in "Hello India") needs the rest to look like a
  // money question: a time, "spend", "vs", "top". Otherwise it's offered, not assumed.
  const asksAboutMoney = periods.length > 0 || intent !== 'total' || OVERALL.test(t);
  if (subjects.length > 0 && subjects.every((s) => s.partial) && !asksAboutMoney) {
    return {
      understood: false,
      reason: 'choose',
      message: 'Did you mean this?',
      choices: subjects.map((o) => ({ label: o.name, kind: o.kind, question: `${o.name} this year` })),
    };
  }
  if (subjects.length === 0 && intent !== 'top' && intent !== 'compare' && intent !== 'by_month' && !OVERALL.test(t)) {
    return {
      understood: false,
      reason: 'nothing',
      message: 'I couldn’t tell what to look up. Name a category, a merchant or a card, and a time: “rent this year”, “Costco last month”.',
    };
  }

  if (intent === 'compare') {
    // "Compare utilities" with no time in it: this month against the last.
    if (periods.length === 0) periods = findPeriods('this month', today);
    if (periods.length === 1) periods = [periods[0], previousPeriod(periods[0], today)];
    periods = periods.slice(0, 2);
  } else if (periods.length === 0) {
    periods = [yearToDate(today)];
  } else {
    periods = periods.slice(0, 1);
  }

  const top = intent === 'top' ? { of: topOf(t, subjects), n: Math.min(Number(t.match(/\btop (\d+)\b/)?.[1] ?? 5), 25) } : null;
  return { understood: true, intent, subjects, periods, ...(top && { top }), ...(choices && { also: choices }) };
}
