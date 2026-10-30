/**
 * A suggested bill in plain words (D364 step 4): how sure the app is, and the
 * evidence behind it, one line each, for the review on Recurring. The finding
 * itself lives in api/src/money/bills.js (detect); this only words it.
 * Pure; tested in suggestion-view.test.js.
 */
import { formatMoney } from '../../api.js';
import { monthShort } from '../app/dates.js';

const ordinal = (n) => `${n}${[11, 12, 13].includes(n % 100) ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
const money = (cents) => formatMoney(Math.abs(cents));
const EVERY = { WEEKLY: 'every week', BIWEEKLY: 'every two weeks', MONTHLY: 'every month', QUARTERLY: 'every three months', ANNUAL: 'every year' };

export const CONFIDENCE = {
  high: { label: 'Very likely', tone: 'text-info bg-info/10' },
  medium: { label: 'Likely', tone: 'text-ink bg-band' },
  low: { label: 'Possible', tone: 'text-muted bg-band' },
};

/** "Fixed price" or "Amount varies", with the cadence: "Monthly · amount varies". */
export function kindLine(s) {
  const cadence = { WEEKLY: 'Weekly', BIWEEKLY: 'Every 2 weeks', MONTHLY: 'Monthly', QUARTERLY: 'Quarterly', ANNUAL: 'Yearly' }[s.cadence] ?? s.cadence;
  return `${cadence} · ${s.kind === 'variable' ? 'amount varies' : 'fixed price'}`;
}

/** The reasons, most telling first. */
export function evidence(s) {
  const since = monthShort(s.first_date.slice(0, 7));
  const lines = [];
  if (s.kind === 'variable') {
    lines.push(s.months && s.count > 2
      ? `Paid in ${s.months.covered} of the ${s.months.span} months since ${since}`
      : `Paid ${s.count} times since ${since}, about a month apart`);
    const amounts = s.charges.map((c) => Math.abs(c.amount_cents));
    if (s.amounts_vary) lines.push(`Usually about ${money(s.expected_amount_cents)}; it has been ${money(Math.min(...amounts))} to ${money(Math.max(...amounts))}`);
  } else {
    const day = s.day && s.cadence !== 'WEEKLY' && s.cadence !== 'BIWEEKLY' ? ` around the ${ordinal(s.day)}` : '';
    lines.push(`Charged ${EVERY[s.cadence] ?? s.cadence.toLowerCase()}${day}, ${s.count} times since ${since}`);
    if (s.prices?.length > 1) {
      lines.push(`Price changed: ${s.prices.map((p) => money(p.cents)).join(' → ')} (latest from ${monthShort(s.prices.at(-1).from.slice(0, 7))})`);
    }
  }
  if (s.accounts > 1) lines.push(`Paid from ${s.accounts} different cards or accounts`);
  if (s.split_payments > 0) lines.push(`${s.split_payments === 1 ? 'Once' : `${s.split_payments} times`} paid in two parts`);
  if (s.confidence === 'low') lines.push('Only a couple of payments so far: add it if it’s a real bill');
  return lines;
}

/** An ignored key in words: "cinema|monthly|-1286" → "cinema · monthly · $12.86"; "…|variable" → "… · monthly · amount varies". */
export function ignoredLabel(k) {
  const [merchant, cadence, price] = k.split('|');
  if (!cadence) return `${merchant} · every bill`;
  const amount = price === 'variable' ? 'amount varies' : /^-?\d+$/.test(price ?? '') ? money(Number(price)) : price;
  return [merchant, cadence.toLowerCase(), amount].filter(Boolean).join(' · ');
}
