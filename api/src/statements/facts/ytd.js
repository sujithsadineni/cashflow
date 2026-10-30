/**
 * The year-to-date fees and interest box (D346, statement-extraction step 1),
 * in each bank's words. Pure; tested in ytd.test.js.
 *
 *   Amex:      "Total Fees in 2026 $N" / "Total Interest in 2026 $N"
 *   BofA, Barclays, Bilt, Robinhood: "Total fees charged in 2026 $N" / "Total interest charged in 2026 $N"
 *   Zolve:     "Total Fees Charged in 2026 Total Interest Charged in 2026", the two figures on the next line
 *   Apple:     "$N – Total interest charged in 2026" (no fees line: Apple charges none)
 *
 * Returns { ytd_year, ytd_fees_cents, ytd_interest_cents }, nulls when not printed.
 */
import { parseMoney } from '../../parse/pdf-local-helpers.js';

const AMT = '\\$?\\s?[\\d,]+\\.\\d{2}';
const FEES = new RegExp(`Total Fees? (?:Charged )?in (\\d{4})[:\\s]{1,6}(${AMT})`, 'i');
const INTEREST = new RegExp(`Total Interest (?:Charged )?in (\\d{4})[:\\s]{1,6}(${AMT})`, 'i');
const INTEREST_BEFORE = new RegExp(`(${AMT})\\s*[–-]\\s*Total interest charged in (\\d{4})`, 'i');
const BOTH_LABELS = /Total Fees? (?:Charged )?in (\d{4})\s+Total Interest (?:Charged )?in \d{4}\s*$/i;
const TWO_FIGURES = new RegExp(`^(${AMT})\\s+(${AMT})$`);

export function readYtd(text) {
  const lines = (text ?? '').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const out = { ytd_year: null, ytd_fees_cents: null, ytd_interest_cents: null };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Zolve: both labels on one line, both figures on the next.
    const both = line.match(BOTH_LABELS);
    if (both && out.ytd_fees_cents === null) {
      const figures = (lines[i + 1] ?? '').match(TWO_FIGURES);
      if (figures) Object.assign(out, { ytd_year: Number(both[1]), ytd_fees_cents: parseMoney(figures[1]), ytd_interest_cents: parseMoney(figures[2]) });
      continue;
    }
    const fees = line.match(FEES);
    if (fees && out.ytd_fees_cents === null) Object.assign(out, { ytd_year: Number(fees[1]), ytd_fees_cents: parseMoney(fees[2]) });
    const interest = line.match(INTEREST);
    if (interest && out.ytd_interest_cents === null) Object.assign(out, { ytd_year: out.ytd_year ?? Number(interest[1]), ytd_interest_cents: parseMoney(interest[2]) });
    const before = line.match(INTEREST_BEFORE);
    if (before && out.ytd_interest_cents === null) Object.assign(out, { ytd_year: out.ytd_year ?? Number(before[2]), ytd_interest_cents: parseMoney(before[1]) });
  }
  return out;
}

/**
 * What a statement's own rows charged in fees and interest, both net of what
 * the bank gave back and as charged before that, since banks count it either
 * way in their year-to-date box: Amex nets a reversed fee out, Zolve's "fees
 * charged" keeps a reversed annual fee. A reversed fee or interest charge is
 * saved as a refund (Zolve's "Reversal Transaction [Financial Charges -
 * Interest", BofA's "DISPUTE INTEREST CHARG ADJ", Amex's "Credit Adjustment
 * for Returned Payment Fee"); the words decide which, before the category,
 * which can be either.
 * rows: [{ txn_type, amount_cents, description, category_name }]
 */
const FEE_WORDS = /\bFEES?\b|SERVICE CHARGE/i;
const INTEREST_WORDS = /\bINTEREST\b|FINANCE CHARGE/i;
export function periodCharges(rows) {
  const out = { fees_cents: 0, interest_cents: 0, fees_charged_cents: 0, interest_charged_cents: 0 };
  for (const r of rows) {
    const cents = Number(r.amount_cents);
    if (r.txn_type === 'fee') { out.fees_cents -= cents; out.fees_charged_cents -= cents; }
    else if (r.txn_type === 'interest' && cents <= 0) { out.interest_cents -= cents; out.interest_charged_cents -= cents; }
    else if (r.txn_type === 'refund') {
      const text = r.description ?? '';
      if (FEE_WORDS.test(text) || (!INTEREST_WORDS.test(text) && ['Bank Fees', 'Annual Fee'].includes(r.category_name))) out.fees_cents -= cents;
      else if (INTEREST_WORDS.test(text) || r.category_name === 'Interest') out.interest_cents -= cents;
    }
  }
  return out;
}

/**
 * The check (D346): within one year, this statement's year-to-date less the
 * previous statement's is what this period charged (periodCharges). The year
 * is the statement's closing year (`year`), which is what the banks say they
 * use ("statements with closing dates in 2026"); the printed label can be
 * wrong (Zolve's July and August 2026 statements say 2025). The first
 * statement of a year compares with zero.
 * current, previous: { year, ytd_fees_cents, ytd_interest_cents }, previous null when there's none.
 * Returns { fees, interest } each true / false / null (not printed), or null
 * when nothing can be checked (no box, or no previous statement in the same year).
 */
export function ytdAddsUp(current, previous, period) {
  if (current?.ytd_interest_cents == null && current?.ytd_fees_cents == null) return null;
  const firstOfYear = previous != null && previous.year !== current.year;
  if (previous == null) return null;
  const was = (key) => (firstOfYear ? 0 : previous[key]);
  // Either way of counting reversals (periodCharges) is the bank's.
  const check = (key, ...charged) => (current[key] == null || was(key) == null ? null
    : charged.filter((c) => c != null).includes(Number(current[key]) - Number(was(key))));
  return {
    fees: check('ytd_fees_cents', period.fees_cents, period.fees_charged_cents),
    interest: check('ytd_interest_cents', period.interest_cents, period.interest_charged_cents),
  };
}
