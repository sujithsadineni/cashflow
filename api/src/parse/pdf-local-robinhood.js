/**
 * Local (no API call) parser for Robinhood Gold Card statements (D181).
 * Built and verified against this household's own statement
 * (`api/scripts/verify-local-robinhood.mjs`).
 *
 * Layout, confirmed against real text:
 *   - Page 1 summary: "Previous Balance $X", "- Payments & Credits $X",
 *     "+ Purchases & Other Charges $X", "= New Balance $X",
 *     "Statement Closing Date September 24, 2026", "Days in Billing Cycle 22".
 *   - Transactions: "MM/DD  MM/DD  REFERENCE  DESCRIPTION  AMOUNT", where
 *     a credit prints with a trailing minus ("127.96-"). The statement
 *     counts from what you owe, so every amount is negated on the way in
 *     (same as the BofA and Bilt card layouts).
 *   - An airline ticket's itinerary wraps onto extra lines with no
 *     amount ("09/26/26 1 F9 R  ATLANTA  FORT WORTH"). It's kept in the
 *     raw line but not in the description.
 *   - "INTEREST CHARGED" lines have no reference number.
 *
 * Never silently drops a line: anything inside a section that isn't a
 * transaction, a header, or a continuation of the row above fails the
 * parse, same rule as the CSV parser (D12).
 */

import { parseMoney, extractAmountAfterLabel } from './pdf-local-helpers.js';

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function extractClosingDate(text) {
  const m = text.match(/Statement Closing Date\s+([A-Z][a-z]+)\s+(\d{1,2}),\s*(\d{4})/);
  if (!m || !MONTHS[m[1].toLowerCase()]) return null;
  return { year: Number(m[3]), month: MONTHS[m[1].toLowerCase()], day: Number(m[2]) };
}

/** The cycle runs back from the closing date: "Days in Billing Cycle 22" closing Sep 24 starts Sep 3. */
function extractPeriod(text) {
  const close = extractClosingDate(text);
  const days = Number(text.match(/Days in Billing Cycle\s+(\d+)/)?.[1]);
  if (!close || !days) return null;
  const end = new Date(Date.UTC(close.year, close.month - 1, close.day));
  const start = new Date(end.getTime() - (days - 1) * 86_400_000);
  return { period_start: start.toISOString().slice(0, 10), period_end: end.toISOString().slice(0, 10), close };
}

// Date, date, an optional reference number (letters and digits, at
// least one digit), the description, the amount with an optional
// trailing minus for a credit.
const TXN_LINE = /^(\d{2})\/(\d{2})\s+(\d{2})\/(\d{2})\s+(?:([A-Z0-9]*\d[A-Z0-9]*)\s+)?(.+?)\s+([\d,]*\.\d{2})(-)?$/;

const SKIP = [
  /^Tran Post$/i,
  /^Date Date\s/i,
  /Account Number:/i,
  /^Transactions continued/i,
  /\bPAGE\s+\d+\s+of\s+\d+\b/i,
];

function parseTransactionLines(text, { year, closeMonth, cleanMerchantName }) {
  const rows = [];
  let section = null;
  let lastRow = null;

  for (const line of text.split('\n').map((l) => l.trim()).filter(Boolean)) {
    if (/^Totals \d{4} Year-to-Date/i.test(line) || /^INTEREST CHARGE CALCULATION/i.test(line)) break;
    if (/^TRANSACTIONS( \(continued\))?$/i.test(line)) { section = 'transactions'; lastRow = null; continue; }
    if (/^FEES( CHARGED)?$/i.test(line)) { section = 'fees'; lastRow = null; continue; }
    if (/^INTEREST CHARGED$/i.test(line)) { section = 'interest'; lastRow = null; continue; }
    if (/^TOTAL (FEES|INTEREST) FOR THIS PERIOD/i.test(line)) { section = null; lastRow = null; continue; }
    if (section === null || SKIP.some((p) => p.test(line))) continue;

    const m = line.match(TXN_LINE);
    if (!m) {
      // An itinerary or other wrapped detail: kept on the raw line only.
      if (lastRow) { lastRow.raw_text += ` | ${line}`; continue; }
      throw new Error(`Couldn't parse a ${section} line: "${line}"`);
    }

    const [, , , postMonth, postDay, , description, amountStr, minus] = m;
    // A January statement can carry December rows: those belong to last year.
    const rowYear = Number(postMonth) > closeMonth ? year - 1 : year;
    const posted_date = `${rowYear}-${postMonth}-${postDay}`;
    const owed = parseMoney(amountStr) * (minus ? -1 : 1);
    const amount_cents = -owed || 0; // never -0 for a $0.00 line

    let txn_type;
    let merchant = null;
    let suggested_category = null;
    if (section === 'interest') {
      txn_type = 'interest';
      suggested_category = 'Interest';
    } else if (section === 'fees') {
      txn_type = 'fee';
      merchant = 'Robinhood';
    } else if (minus) {
      const isPayment = /payment/i.test(description) && !/credit$/i.test(description);
      txn_type = isPayment ? 'payment' : 'refund';
      suggested_category = isPayment ? 'Card Payment' : null;
      merchant = isPayment ? null : cleanMerchantName(description);
    } else {
      txn_type = 'purchase';
      // The Gold membership itself, billed by Robinhood on its own card.
      merchant = /^GOLD ANNUAL/i.test(description) ? 'Robinhood' : cleanMerchantName(description);
    }

    rows.push({ posted_date, description, merchant, amount_cents, txn_type, suggested_category, confidence: 'HIGH', raw_text: line });
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
export function extractRobinhoodLocally(pages, classifications, cleanMerchantName) {
  const pageOne = pages[0]?.text ?? '';
  const period = extractPeriod(pageOne);
  if (!period) throw new Error('Could not find the closing date and billing-cycle length on page 1');

  const mask = pageOne.match(/Account Number:\s*(?:X{4}\s*){3}(\d{4})/)?.[1] ?? null;
  const holder_name = pageOne.split('\n')[0]?.replace(/\s+Account Number:.*$/i, '').trim() || null;

  const txnPages = classifications.filter((c) => c.role === 'TRANSACTIONS').sort((a, b) => a.pageNumber - b.pageNumber);
  if (txnPages.length === 0) throw new Error('No transactions page found');
  const txnText = txnPages.map((c) => pages[c.pageNumber - 1].text).join('\n');

  const rows = parseTransactionLines(txnText, { year: period.close.year, closeMonth: period.close.month, cleanMerchantName });
  if (rows.length === 0) throw new Error('No transaction lines matched on the transactions pages');

  const opening = extractAmountAfterLabel(pageOne, 'Previous Balance');
  const closing = extractAmountAfterLabel(pageOne, 'New Balance');
  const totalCredits = extractAmountAfterLabel(pageOne, 'Payments & Credits');
  const totalPurchases = extractAmountAfterLabel(pageOne, 'Purchases & Other Charges');

  const credits = rows.filter((r) => r.txn_type === 'payment' || r.txn_type === 'refund').reduce((s, r) => s + r.amount_cents, 0);
  const purchases = rows.filter((r) => r.txn_type === 'purchase').reduce((s, r) => s + r.amount_cents, 0);
  const net = rows.reduce((s, r) => s + r.amount_cents, 0);

  return {
    account: { name: 'Robinhood Gold Card', issuer: 'Robinhood', mask, account_type: 'CREDIT_CARD', holder_name },
    statement: {
      period_start: period.period_start,
      period_end: period.period_end,
      opening_balance_cents: opening,
      closing_balance_cents: closing,
      total_spend_cents: totalPurchases === null ? null : -totalPurchases,
      total_payments_cents: totalCredits,
      cashback_earned_cents: null, // Gold Card rewards aren't printed on the statement
      cashback_balance_cents: null,
    },
    rows,
    reconciliation: {
      payments_match: totalCredits === null || totalCredits === credits,
      purchases_match: totalPurchases === null || -totalPurchases === purchases,
      balances_reconcile: opening === null || closing === null ? null : opening - net === closing,
    },
  };
}
