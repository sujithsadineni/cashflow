import { formatMoney, formatShortDate } from '../../api.js';

/** Short display text for a statement-gap fact, with the original reason as fallback. */
export function formatGapFact(fact, sentence = '') {
  switch (fact?.kind) {
    case 'paid':
      return `Paid ${formatMoney(fact.cents)} · ${formatShortDate(fact.date)} · ${fact.from}`;
    case 'held_bill':
      return `Bill paid ${formatShortDate(fact.date)}`;
    case 'due':
      return `Due ~${formatShortDate(fact.date)}`;
    case 'carried':
      return `Carried in ${formatMoney(fact.cents)}`;
    case 'next_opens':
      return `Next opens at ${formatMoney(fact.cents)}`;
    case 'unmatched':
      return `Unmatched ${formatMoney(fact.cents)} · ${formatShortDate(fact.date)} · ${fact.from}`;
    case 'maybe_owed':
      return `Maybe still owed ${formatMoney(fact.cents)}`;
    default:
      return sentence;
  }
}
