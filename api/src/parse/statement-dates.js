/**
 * A card statement's payment due date and minimum payment (D270), read
 * the same way for every issuer, like promos.js reads promotions.
 *
 * Every card statement prints both, each in its own place:
 *   "Payment Due Date 10/19/26"                    Amex, Bank of America
 *   "Payment Due Date: 11/02/26" / "11/02/26 Payment Due Date:"   Barclays
 *   "Payment Due Date October 17, 2026"            Robinhood
 *   "Payment due by" … two lines on … "Oct 6, 2026" Bilt (columns)
 *   "Payment Due Due By" then "$122.69 $25.00 Oct 31, 2026"  Apple (a table)
 *   "Minimum Payment Due Payment Due Date" then "$7.75 $7.75 09/14/2026"  Zolve
 *   "Payments $1,300.00 New Balance Payment Due Date Minimum Payment Due"
 *     then "Other Credits $0.00" then "$700.00 11/10/2025 $90.00"        Zolve (to June 2026)
 *
 * So each label is looked for, then a value on its own line (after the
 * label, or just before it) or on the next few lines. What makes this
 * safe across layouts is checking the value against the statement:
 *   - a due date comes 10 to 40 days after the statement closes, which
 *     rules out the period's own dates and "autopay scheduled on …"
 *   - a minimum payment is at most what the statement says is owed
 * Nothing found is null, never a guess.
 *
 * Pure: pages in, { payment_due_date, minimum_payment_cents } out.
 * Tested in statement-dates.test.js.
 */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DATE = /\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b|\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),\s*(\d{4})\b/gi;
// Some PDFs print "$" as a control character (Zolve): read it as a dollar sign.
const MONEY = /(-?)\s*\$\s*(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})\b/g;

const DUE_LABEL = /payment\s+due\s+date|payment\s+due\s+by|\bdue\s+by\b/i;
const MIN_LABEL = /minimum\s+payment(?:\s+due)?/i;
const LOOK_AHEAD = 3;
const DAY = 86_400_000;

const pad = (n) => String(n).padStart(2, '0');
function datesIn(text) {
  const out = [];
  for (const m of text.matchAll(DATE)) {
    let y, mo, d;
    if (m[1]) {
      mo = Number(m[1]);
      d = Number(m[2]);
      y = Number(m[3].length === 2 ? `20${m[3]}` : m[3]);
    } else {
      mo = MONTHS.indexOf(m[4].slice(0, 3).toLowerCase()) + 1;
      d = Number(m[5]);
      y = Number(m[6]);
    }
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) out.push({ iso: `${y}-${pad(mo)}-${pad(d)}`, at: m.index });
  }
  return out;
}
function moneyIn(text) {
  return [...text.matchAll(MONEY)].map((m) => ({ cents: Number(`${m[2].replace(/,/g, '')}${m[3]}`) * (m[1] ? -1 : 1), at: m.index, end: m.index + m[0].length }));
}
// A table row's own values: amounts with no words just before them. "Other Credits $0.00"
// and "- Payments $7.75" are summary lines that share the row, not cells in it.
function cellsIn(text) {
  let from = 0;
  const out = [];
  for (const m of moneyIn(text)) {
    if (!/[a-z]/i.test(text.slice(from, m.at))) out.push(m.cents);
    from = m.end;
  }
  return out;
}
const daysAfter = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / DAY);

/**
 * @param pages [{ text }] the statement's pages; only the first two are read
 * @param periodEnd 'YYYY-MM-DD' the statement's closing date
 * @param owedCents what the statement says is owed (closing balance), to check a minimum against
 */
export function extractStatementDates(pages, { periodEnd, owedCents = null } = {}) {
  const lines = (pages ?? []).slice(0, 2)
    .flatMap((p) => (p.text ?? '').replace(/\u0000/g, '$').split('\n'))
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const dueOk = (iso) => periodEnd && daysAfter(periodEnd, iso) >= 10 && daysAfter(periodEnd, iso) <= 40;
  let payment_due_date = null;
  for (let i = 0; i < lines.length && !payment_due_date; i++) {
    const label = lines[i].match(DUE_LABEL);
    if (!label) continue;
    const after = datesIn(lines[i].slice(label.index)).map((d) => d.iso);
    const before = datesIn(lines[i].slice(0, label.index)).map((d) => d.iso).reverse();
    const ahead = lines.slice(i + 1, i + 1 + LOOK_AHEAD).flatMap((l) => datesIn(l).map((d) => d.iso));
    payment_due_date = [...after, ...before, ...ahead].find(dueOk) ?? null;
  }

  const owed = owedCents == null ? null : Math.max(0, owedCents);
  const minOk = (c) => c >= 0 && (owed == null || c <= owed);
  let minimum_payment_cents = null;
  for (let i = 0; i < lines.length && minimum_payment_cents == null; i++) {
    const label = lines[i].match(MIN_LABEL);
    if (!label) continue;
    const line = lines[i];
    const after = moneyIn(line.slice(label.index + label[0].length)).map((m) => m.cents);
    // "$ 284.00 Total Minimum Payment Due": the amount just before the label. Only
    // right before it: in "Payments $1,300.00 New Balance … Minimum Payment Due" the
    // amount is the payments total, and other labels sit between them.
    const header = line.slice(0, label.index);
    const last = moneyIn(header).at(-1);
    const before = last && /^\s*(total\s*)?$/i.test(header.slice(last.end)) ? [last.cents] : [];
    // A header row ("Balance … Minimum Payment …") whose values are on a later line: take the
    // value in the minimum's column, else the first that fits. The column comes first: a
    // line in between ("Other Credits $0.00") isn't the minimum just because it fits.
    // Columns are counted after the header's last amount: "Previous Balance $299.99" before
    // them is a summary line with its value, not a column.
    const column = (header.slice(last?.end ?? 0).match(/balance/gi) ?? []).length;
    const inColumn = [];
    const ahead = [];
    for (const l of lines.slice(i + 1, i + 1 + LOOK_AHEAD)) {
      const cells = cellsIn(l);
      if (cells.length > column && column > 0) inColumn.push(cells[column]);
      ahead.push(...moneyIn(l).map((m) => m.cents));
    }
    const found = [...after.slice(0, 1), ...before, ...inColumn, ...ahead].find(minOk);
    minimum_payment_cents = found ?? null;
  }

  return { payment_due_date, minimum_payment_cents };
}
