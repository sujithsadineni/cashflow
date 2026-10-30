/**
 * How a statement plays as it's read into rows (D335): four styles, picked
 * in Settings → Animation, per browser like the design. C is the default,
 * at the owner's request. Each style is a component in
 * components/review/reveal/; this file holds what they share and what can be
 * tested without a browser.
 */

export const READING_STYLES = [
  {
    value: 'decode',
    letter: 'A',
    label: 'Decode',
    description: 'Each printed line decodes into its row, from top to bottom: the logo pops, the name resolves out of noise, the rest settles in.',
  },
  {
    value: 'highlight',
    letter: 'B',
    label: 'Highlighter',
    description: 'A marker picks out the date, the merchant and the amount on each printed line, then those pieces slide into their columns.',
  },
  {
    value: 'paper',
    letter: 'C',
    label: 'Paper to ledger',
    description: 'The statement page sits beside the rows. A scan line reads it line by line, and each line lifts off the page and drops into its row.',
  },
  {
    value: 'tape',
    letter: 'D',
    label: 'Adding-machine tape',
    description: 'Rows print in one at a time while a running total counts up to what the statement says the balances moved by, then the check stamps in.',
  },
];
export const DEFAULT_READING_STYLE = 'paper';
export const READING_STYLE_KEY = 'cashflow_reading_style';
export const isReadingStyle = (value) => READING_STYLES.some((s) => s.value === value);

/**
 * How long each line gets: about 10.5 seconds for the whole statement,
 * whatever its length, 180–1050 ms a line (D171's pacing, half as slow again).
 * A style that does more per line asks for a higher floor.
 */
// Half as slow again as it first was, at the owner's request (D335): about 10.5 seconds a
// statement, 180–1050 ms a line, none past about 18 seconds.
export const PACE_SCALE = 1.5;
export const lineStep = (count, floor = 120) => {
  const n = Math.max(count, 1);
  const k = PACE_SCALE;
  // A style's floor gives way on a long statement, so none plays past about 18 seconds.
  const slowest = Math.min(floor * k, Math.max(120 * k, (12000 * k) / n));
  return Math.max(slowest, Math.min(700 * k, (7000 * k) / n));
};

// A printed date: 09/16, 09/16/26, 09/16/2026, or "Sep 16"; a line can print two (sold and posted).
const DATE = String.raw`(?:\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|[A-Z][a-z]{2}\.? \d{1,2}(?!\d))`;
const DATES = new RegExp(String.raw`^\s*(${DATE})(?:\s+${DATE})?`);
const AMOUNT = /-?\$?-?\d{1,3}(?:,\d{3})*\.\d{2}(?!\d)/g;

/**
 * The printed line cut into what the parser read off it, for the
 * highlighter: the date(s) at the start, the merchant (the row's own
 * description where the line prints it, else the words after the date up to
 * a wide gap), and the last amount on the line. The rest is unmarked.
 * Returns [{ text, mark: 'date' | 'merchant' | 'amount' | null }], which
 * joined give back the line exactly.
 */
export function markLine(raw, description) {
  const line = raw ?? '';
  const spans = [];
  const date = DATES.exec(line);
  if (date) spans.push({ start: date.index + date[0].indexOf(date[0].trim()), end: date.index + date[0].length, mark: 'date' });
  const amounts = [...line.matchAll(AMOUNT)];
  const amount = amounts.at(-1);
  if (amount && !(date && amount.index < spans[0].end)) spans.push({ start: amount.index, end: amount.index + amount[0].length, mark: 'amount' });

  const after = date ? spans[0].end : 0;
  const limit = amount ? amount.index : line.length;
  const at = description ? line.toLowerCase().indexOf(description.toLowerCase().trim(), after) : -1;
  if (at !== -1 && at + description.trim().length <= limit) {
    spans.push({ start: at, end: at + description.trim().length, mark: 'merchant' });
  } else {
    const rest = line.slice(after, limit);
    const lead = rest.length - rest.trimStart().length;
    const words = rest.trimStart().split(/\s{3,}/)[0].trimEnd();
    if (words) spans.push({ start: after + lead, end: after + lead + words.length, mark: 'merchant' });
  }

  spans.sort((a, b) => a.start - b.start);
  const out = [];
  let i = 0;
  for (const s of spans) {
    if (s.start < i) continue;
    if (s.start > i) out.push({ text: line.slice(i, s.start), mark: null });
    out.push({ text: line.slice(s.start, s.end), mark: s.mark });
    i = s.end;
  }
  if (i < line.length) out.push({ text: line.slice(i), mark: null });
  return out;
}

/** The tape's running total after each row, in cents. */
export function runningTotals(rows) {
  let sum = 0;
  return rows.map((r) => (sum += r.amount_cents ?? 0));
}

/**
 * What the tape ends on, from the statement's tally (statements/tally.js):
 * 'match' stamps "Adds up to the cent", 'off' leaves the gap in amber, and
 * 'unknown' says it can't be checked.
 */
export function tapeEnding(tally) {
  if (!tally || tally.status === 'unknown') return { kind: 'unknown' };
  if (tally.status === 'match') return { kind: 'match', cents: tally.rows_cents };
  return { kind: 'off', cents: tally.rows_cents, expected: tally.expected_cents, gap: tally.diff_cents };
}

/** A made-up statement for Settings' preview: no household data. */
export const SAMPLE_ROWS = [
  ['2026-09-14', '09/14  CASH REWARDS STATEMENT CREDIT              -92.57', 'CASH REWARDS STATEMENT CREDIT', 'Cash rewards credit', 'cashback', 'Cashback', 9257],
  ['2026-09-16', '09/16  TRADER JOE S #552  SAN JOSE CA            48.12', 'TRADER JOE S #552', "Trader Joe's", 'purchase', 'Groceries', -4812],
  ['2026-09-19', '09/19  SHELL OIL 57444219  SUNNYVALE CA           39.60', 'SHELL OIL 57444219', 'Shell', 'purchase', 'Gas', -3960],
  ['2026-09-22', '09/22  NETFLIX.COM  LOS GATOS CA                   15.49', 'NETFLIX.COM', 'Netflix', 'purchase', 'Subscriptions', -1549],
  ['2026-09-30', '09/30  CHIPOTLE 1932  MOUNTAIN VIEW CA              13.85', 'CHIPOTLE 1932', 'Chipotle', 'purchase', 'Dining', -1385],
  ['2026-10-05', '10/05  ONLINE PAYMENT - THANK YOU                 -284.00', 'ONLINE PAYMENT - THANK YOU', 'Payment, thank you', 'payment', 'Card Payment', 28400],
].map(([posted_date, raw_text, description, merchant, txn_type, suggested_category, amount_cents], i) => ({
  id: -1 - i, posted_date, raw_text, description, merchant, txn_type, suggested_category, amount_cents, review_status: 'PENDING',
}));
export const SAMPLE_TALLY = { status: 'match', rows_cents: SAMPLE_ROWS.reduce((s, r) => s + r.amount_cents, 0) };
