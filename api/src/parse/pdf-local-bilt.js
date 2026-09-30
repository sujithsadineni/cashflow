/**
 * Local (no API call) parser for Bilt Blue Card statements — built
 * and verified against this household's own real statements
 * (`api/scripts/verify-local-bilt.mjs`).
 *
 * Same sign convention as BofA's credit-card layout (pdf-local-bofa.js):
 * the statement prints from "what you owe" (a charge positive, a
 * payment/credit negative), the opposite of this app's own "money in
 * my pocket" convention, so every transaction-line amount gets negated
 * on the way in.
 *
 * Bilt's own rent mechanic (parse/bilt-rent.js, wired in from
 * routes/imports.js) overrides category/txn_type for the specific
 * "BPS*BILT HOUSING" / "BILT RENT CHARGE ADJUSTMENT" description
 * prefixes regardless of what this file assigns them — this parser
 * only needs to get the description text, date, and amount right for
 * those; it doesn't need its own rent-specific logic.
 *
 * A transaction's full address wraps onto a second physical line with
 * no date, reference, or amount of its own ("BPS*BILT HOUSING 100 Sample
 * Ave New York 10001 NY $900.00\nUSA") — real, confirmed against
 * every real statement, not an edge case. Never silently drops a
 * line: anything that isn't a header, a TOTAL line, or a continuation
 * of the row just added fails the whole parse — same rule the CSV
 * parser already follows (D12).
 */

import { parseMoney, extractAmountAfterLabel, mergeContinuation } from './pdf-local-helpers.js';

// Bilt prints abbreviated month names ("May 11 – Jun 11, 2026"),
// unlike BofA's full names ("August 14 - September 13") — both forms
// keyed here rather than truncating every lookup to 3 letters, so the
// object stays a direct, readable name-to-number map either way.
const MONTHS = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
  may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8,
  september: 9, sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};

function extractHolderName(text) {
  const lines = text.split('\n');
  return lines[0]?.trim() || null; // the cardholder's name is always the statement's very first line
}

// There's no account number anywhere on a Bilt statement (real,
// confirmed — searched every page), so auto-matching to an existing
// account (routes/imports.js) has to go by name instead of mask, the
// same fallback path a mask-less statement from any issuer takes.
// The product name ("Bilt Blue Card") is always the statement's
// second line, right under the cardholder's name.
function extractProductName(text) {
  const m = text.match(/^Bilt .*Card$/im);
  return m ? m[0].trim() : null;
}

/** "May 11 – Jun 11, 2026" -> { period_start, period_end } — an en dash, not a hyphen, confirmed against real text. */
function extractPeriod(text) {
  const m = text.match(/([A-Z][a-z]+)\s+(\d{1,2})\s*[–-]\s*([A-Z][a-z]+)\s+(\d{1,2}),\s*(\d{4})/);
  if (!m) return null;
  const [, startMonthName, startDay, endMonthName, endDay, endYearStr] = m;
  const startMonth = MONTHS[startMonthName.toLowerCase()];
  const endMonth = MONTHS[endMonthName.toLowerCase()];
  if (!startMonth || !endMonth) return null;
  const endYear = Number(endYearStr);
  const startYear = startMonth > endMonth ? endYear - 1 : endYear;
  const pad = (n) => String(n).padStart(2, '0');
  return {
    period_start: `${startYear}-${pad(startMonth)}-${pad(startDay)}`,
    period_end: `${endYear}-${pad(endMonth)}-${pad(endDay)}`,
  };
}

const SECTION_HEADERS = [
  [/^Payments and credits$/i, 'payments'],
  [/^Transactions$/i, 'purchases'],
  [/^Fees$/i, 'fees'],
  [/^Interest charged$/i, 'interest'],
];

const STOP_PHRASES = [/^Year-to-date summary/i];

// A column-header repeat, or the "-   $0.00" placeholder row Bilt
// prints for an empty Fees/Interest section — neither is a real
// transaction, and the placeholder doesn't even have a real date.
const SKIP_LINE_PATTERNS = [/^Date\s+Description\s+Amount$/i, /^-\s+\$0\.00$/, /^Page \d+ of \d+$/i];

// A real TOTAL line closes out whichever section was open.
const SECTION_END_PATTERNS = [/^Total (payments and credits|new charges|fees charged|interest) /i];

// "Month DD, YYYY   Description   $Amount" — the amount is always the
// LAST thing on the line; the address/merchant-location text that
// follows on a second physical line has no date and no dollar sign,
// so it can never be mistaken for a new transaction (mirrors BofA's
// own TXN_LINE_FULL / continuation-merge design).
const TXN_LINE = /^([A-Z][a-z]+ \d{1,2}, \d{4})\s+(.+?)\s+(-?\$[\d,]+\.\d{2})$/;

function parseTransactionLines(text, { issuer, cleanMerchantName }) {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l !== '');
  const rows = [];
  let section = null;
  let lastRow = null;

  for (const line of lines) {
    if (SKIP_LINE_PATTERNS.some((p) => p.test(line))) continue;
    if (SECTION_END_PATTERNS.some((p) => p.test(line))) {
      section = null;
      lastRow = null;
      continue;
    }
    if (STOP_PHRASES.some((p) => p.test(line))) break;

    const headerMatch = SECTION_HEADERS.find(([p]) => p.test(line));
    if (headerMatch) {
      section = headerMatch[1];
      lastRow = null;
      continue;
    }
    if (section === null) continue;

    const m = line.match(TXN_LINE);
    if (!m) {
      if (lastRow) {
        mergeContinuation(lastRow, line);
        continue;
      }
      throw new Error(`Couldn't parse a ${section} line: "${line}"`);
    }

    const [, dateStr, description, amountStr] = m;
    const [monthName, dayStr, yearStr] = dateStr.replace(',', '').split(/\s+/);
    const pad = (n) => String(n).padStart(2, '0');
    const posted_date = `${yearStr}-${pad(MONTHS[monthName.toLowerCase()])}-${pad(Number(dayStr))}`;
    const printedCents = parseMoney(amountStr);
    const amount_cents = -printedCents; // BofA-style inversion — see this file's own header comment

    if (section === 'purchases') {
      rows.push({
        posted_date,
        description,
        merchant: cleanMerchantName(description),
        amount_cents,
        txn_type: 'purchase',
        suggested_category: null,
        confidence: 'HIGH',
        raw_text: line,
      });
    } else if (section === 'payments') {
      // A rent reversal ("BPS*BILT HOUSING"/"BILT RENT CHARGE
      // ADJUSTMENT") is overridden regardless by bilt-rent.js — its
      // default here doesn't matter. A genuine bill payment
      // ("PAYMENT", "AUTOPAY PAYMENT") isn't touched by that rule, so
      // it needs its own classification, same as BofA's
      // GENERIC_PAYMENT_PATTERNS; anything else falls back to
      // 'refund', the same safe, reviewable default BofA's own
      // classifier uses for a credit it doesn't recognize.
      const isBillPayment = /^(AUTOPAY )?PAYMENT$/i.test(description);
      rows.push({
        posted_date,
        description,
        merchant: isBillPayment ? null : cleanMerchantName(description),
        amount_cents,
        txn_type: isBillPayment ? 'payment' : 'refund',
        suggested_category: isBillPayment ? 'Card Payment' : null,
        confidence: 'HIGH',
        raw_text: line,
      });
    } else {
      rows.push({
        posted_date,
        description,
        merchant: issuer,
        amount_cents,
        txn_type: section === 'interest' ? 'interest' : 'fee',
        suggested_category: section === 'interest' ? 'Interest' : null,
        confidence: 'HIGH',
        raw_text: line,
      });
    }
    lastRow = rows[rows.length - 1];
  }

  return rows;
}

/**
 * @param pages - all pages ({ pageNumber, text }), stage-1 output
 * @param classifications - stage-2 output (role per page)
 * @param cleanMerchantName - shared local merchant lookup
 * Returns { account, statement, rows, reconciliation } or throws with a specific message.
 */
export function extractBiltLocally(pages, classifications, cleanMerchantName) {
  const pageOne = pages[0]?.text ?? '';
  const holder_name = extractHolderName(pageOne);
  const productName = extractProductName(pageOne);
  const period = extractPeriod(pageOne);
  if (!period) throw new Error('Could not find the statement period on page 1');

  // Page 1's balance summary is a genuinely ambiguous 2-column
  // flatten ("New balance   as of Jun 11, 2026   Balance breakdown" /
  // " Previous balance   $0.00" / " $1,512.40" on its own line) —
  // real, confirmed against captured text, and not confidently
  // separable into "previous" vs. "new" without guessing. Skipped
  // rather than risking a wrong balances_reconcile signal; the two
  // section totals below (printed unambiguously on the transactions
  // pages) are this parser's real confidence check, same as Amex's
  // own reconciliation having no balances_reconcile at all.
  const opening_balance_cents = null;
  const closing_balance_cents = null;

  const txnPages = classifications
    .filter((c) => c.role === 'TRANSACTIONS')
    .sort((a, b) => a.pageNumber - b.pageNumber);
  if (txnPages.length === 0) throw new Error('No transactions page found');

  const txnText = txnPages.map((c) => pages[c.pageNumber - 1].text).join('\n');
  const rows = parseTransactionLines(txnText, { issuer: 'Bilt', cleanMerchantName });
  if (rows.length === 0) throw new Error('No transaction lines matched on the transactions page');

  const totalPayments = extractAmountAfterLabel(txnText, 'Total payments and credits in this period');
  const totalPurchases = extractAmountAfterLabel(txnText, 'Total new charges in this period');
  const summedPayments = rows.filter((r) => r.txn_type === 'payment' || r.txn_type === 'refund' || r.txn_type === 'cashback')
    .reduce((sum, r) => sum + r.amount_cents, 0);
  const summedPurchases = rows.filter((r) => r.txn_type === 'purchase').reduce((sum, r) => sum + r.amount_cents, 0);

  const netOfAllRows = rows.reduce((sum, r) => sum + r.amount_cents, 0);
  const balances_reconcile =
    opening_balance_cents === null || closing_balance_cents === null
      ? null
      : opening_balance_cents - netOfAllRows === closing_balance_cents;

  const reconciliation = {
    payments_match: totalPayments === null || -totalPayments === summedPayments,
    purchases_match: totalPurchases === null || -totalPurchases === summedPurchases,
    balances_reconcile,
  };

  return {
    account: {
      // Every other issuer here sets this to null ("the statement's
      // own product name isn't authoritative for matching; mask is")
      // — Bilt is the one exception, because it has no mask at all to
      // be authoritative instead. Without a name to match on, a Bilt
      // statement could never auto-suggest its account.
      name: productName,
      issuer: 'Bilt',
      mask: null,
      account_type: 'CREDIT_CARD',
      holder_name,
    },
    statement: {
      period_start: period.period_start,
      period_end: period.period_end,
      opening_balance_cents,
      closing_balance_cents,
      total_spend_cents: totalPurchases === null ? null : -totalPurchases,
      total_payments_cents: totalPayments === null ? null : -totalPayments,
      cashback_earned_cents: null, // Bilt has no cashback program on this card
      cashback_balance_cents: null,
    },
    rows,
    reconciliation,
  };
}
