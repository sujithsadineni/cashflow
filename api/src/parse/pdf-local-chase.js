/**
 * Local (no API call) parser for Chase Total Checking statements —
 * built and verified against this household's own real statements
 * (`api/scripts/verify-local-chase.mjs`).
 *
 * The cleanest of this app's local layouts: pdf.js's text extraction
 * picks up Chase's own hidden structural markers
 * ("*start*transaction detail" / "*end*transaction detail"), so the
 * transaction block's boundaries are exact rather than inferred from
 * section headers the way every other issuer here needs. There's also
 * only one flat list — no Payments/Purchases/Fees split — since a
 * checking account doesn't distinguish those the way a card does.
 *
 * Chase already prints in this app's own sign convention (a deposit
 * positive, a withdrawal already negative) — the same as BofA's
 * checking layout and unlike a credit card, which prints from "what
 * you owe." No inversion needed.
 *
 * Real statement text runs multiple internal spaces between words
 * (a column-layout artifact — "June   23,   2026") that every regex
 * below has to tolerate; lines are collapsed to single-space-separated
 * before any pattern match runs.
 */

import { parseMoney, extractAmountAfterLabel, classifyCheckingInflow, classifyCheckingOutflow, mergeContinuation } from './pdf-local-helpers.js';

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function extractMask(text) {
  const m = text.match(/Account Number:\s*(\d+)/i);
  if (!m) return null;
  return m[1].length >= 4 ? m[1].slice(-4) : null;
}

/** "June 23, 2026 through July 21, 2026" -> { period_start, period_end } — both years always printed. */
function extractPeriod(text) {
  const m = text.match(
    /([A-Z][a-z]+)\s+(\d{1,2}),\s*(\d{4})\s+through\s+([A-Z][a-z]+)\s+(\d{1,2}),\s*(\d{4})/
  );
  if (!m) return null;
  const [, startMonthName, startDay, startYear, endMonthName, endDay, endYear] = m;
  const startMonth = MONTHS[startMonthName.toLowerCase()];
  const endMonth = MONTHS[endMonthName.toLowerCase()];
  if (!startMonth || !endMonth) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return {
    period_start: `${startYear}-${pad(startMonth)}-${pad(startDay)}`,
    period_end: `${endYear}-${pad(endMonth)}-${pad(endDay)}`,
  };
}

/** The account holder's printed name — an all-caps line, tolerant of the multi-space column artifact. */
// Chase never puts the holder's name alone on its own line — it's
// flattened onto the end of "International Calls: <phone> NAME" (real,
// confirmed against captured text, same kind of anchor
// pdf-local-amex.js needs for its own "Customer Care:" line) — so this
// looks for that specific anchor first. A whole-line scan alone would
// match "CUSTOMER SERVICE INFORMATION" instead, a real false positive
// this exact statement text produces (it's also all-caps, letters and
// spaces only, five words or fewer, and appears earlier in the page).
function extractHolderName(text) {
  for (const line of text.split('\n')) {
    const collapsed = line.trim().replace(/\s+/g, ' ');
    const afterInternationalCalls = collapsed.match(/International Calls:\s*[\d-]+\s+([A-Z][A-Z\s]+)$/);
    if (afterInternationalCalls) return afterInternationalCalls[1].trim();
  }
  for (const line of text.split('\n')) {
    const collapsed = line.trim().replace(/\s+/g, ' ');
    if (/^[A-Z][A-Z'.\s-]{3,40}$/.test(collapsed) && collapsed.split(' ').length <= 5) {
      return collapsed;
    }
  }
  return null;
}

function resolveYear(month, periodStart, periodEnd) {
  const startYear = Number(periodStart.slice(0, 4));
  const endYear = Number(periodEnd.slice(0, 4));
  if (startYear === endYear) return startYear;
  return month === 12 ? startYear : endYear;
}

// Date, description, amount (signed, no $), running balance (always
// unsigned) — the balance column is what tells this apart from a line
// with no trailing running total; without it, an ordinary "$50.00
// value 2,000.00" description fragment could be mistaken for one.
//
// `-?\s?` before the digits, not a bare `-?` — a real statement line
// ("Zolve   Zolve   Bill   ...   - 7.75   512.40") prints a space
// between the minus and the amount for some small-dollar rows, a
// pdf.js glyph-positioning artifact that survives the earlier
// whitespace collapse as a single space. Confirmed as a real,
// silent bug, not hypothetical: without the `\s?`, the minus wasn't
// captured as part of the amount at all, so a real $7.75 payment
// landed in the ledger as a positive $7.75 deposit — caught by the
// balance-reconciliation check disagreeing with the statement's own
// printed running balance, not by a thrown error.
const TXN_LINE = /^(\d{2}\/\d{2})\s+(.+?)\s+(-?\s?[\d,]+\.\d{2})\s+([\d,]+\.\d{2})$/;

/**
 * Everything between Chase's own "*start*transaction detail" /
 * "*end*transaction detail" markers — real structural markup in the
 * PDF's text layer, not something this parser is inferring. Multiple
 * TRANSACTIONS-classified pages (a statement spanning 2+ pages of
 * activity) each carry their own start/end pair, concatenated in page
 * order by the caller, so this scans for every occurrence rather than
 * assuming exactly one.
 */
function parseTransactionLines(text, { periodStart, periodEnd, cleanMerchantName }) {
  const lines = text.split('\n').map((l) => l.trim().replace(/\s+/g, ' ')).filter((l) => l !== '');
  const rows = [];
  let inBlock = false;
  let lastRow = null;

  for (const line of lines) {
    if (/^\*start\*transaction detail$/i.test(line)) {
      inBlock = true;
      lastRow = null;
      continue;
    }
    if (/^\*end\*transaction detail$/i.test(line)) {
      inBlock = false;
      lastRow = null;
      continue;
    }
    if (!inBlock) continue;

    if (/^TRANSACTION DETAIL$/i.test(line)) continue;
    if (/^\(continued\)$/i.test(line)) continue; // printed atop a continuation page's own transaction detail block
    if (/^DATE DESCRIPTION AMOUNT BALANCE$/i.test(line)) continue;
    // The running-balance carry-forward line, not a real transaction —
    // appears both at the start and, on a statement spanning multiple
    // pages, again at the top of each continuation page.
    if (/^Beginning Balance /i.test(line)) continue;
    if (/^Ending Balance /i.test(line)) continue;

    const m = line.match(TXN_LINE);
    if (!m) {
      // A real Chase line can wrap a card's last 4 digits onto their
      // own physical line ("...TX Card 930.00 1,930.00" / next line
      // just "1789") — confirmed against a real statement, not
      // hypothetical. Same continuation-merge every other local
      // parser here already needs (see mergeContinuation's own docs).
      if (lastRow) {
        mergeContinuation(lastRow, line);
        continue;
      }
      throw new Error(`Couldn't parse a transaction detail line: "${line}"`);
    }

    const [, dateStr, description, amountStr] = m;
    const [mm, dd] = dateStr.split('/').map(Number);
    const year = resolveYear(mm, periodStart, periodEnd);
    const pad = (n) => String(n).padStart(2, '0');
    const posted_date = `${year}-${pad(mm)}-${pad(dd)}`;
    const amount_cents = parseMoney(amountStr); // already this app's own sign convention

    const { txn_type, category } = amount_cents >= 0
      ? classifyCheckingInflow(description)
      : classifyCheckingOutflow(description);

    rows.push({
      posted_date,
      description,
      merchant: cleanMerchantName(description),
      amount_cents,
      txn_type,
      suggested_category: category,
      confidence: 'HIGH',
      raw_text: line,
    });
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
export function extractChaseLocally(pages, classifications, cleanMerchantName) {
  const pageOne = pages[0]?.text ?? '';
  const holder_name = extractHolderName(pageOne);
  const mask = extractMask(pageOne);
  const period = extractPeriod(pageOne);
  if (!mask) throw new Error('Could not find the Account Number on page 1');
  if (!period) throw new Error('Could not find the statement period on page 1');

  // Collapsed whitespace, not the raw page text — "Beginning   Balance"
  // (real, multi-space column artifact) doesn't match a literal
  // "Beginning Balance" label otherwise.
  const pageOneCollapsed = pageOne.split('\n').map((l) => l.trim().replace(/\s+/g, ' ')).join('\n');
  const opening_balance_cents = extractAmountAfterLabel(pageOneCollapsed, 'Beginning Balance');
  const closing_balance_cents = extractAmountAfterLabel(pageOneCollapsed, 'Ending Balance');

  // Every page, not just the ones classify.js (stage 2, shared with
  // the AI path) scored as TRANSACTIONS — confirmed against a real
  // statement: a continuation page with only 3 real transaction lines
  // buried in a page of boilerplate disclosure text scored as
  // BOILERPLATE instead, and the classifier's own thresholds are
  // shared/tuned against every issuer, not something to loosen here
  // (same reasoning pdf-local-amex.js already used for its own
  // page-classification workaround). Chase's own "*start*transaction
  // detail" / "*end*transaction detail" markers are a far more
  // reliable, issuer-specific bound than the shared heuristic, so
  // parseTransactionLines does its own filtering from the full text
  // instead of trusting `classifications` to have found every page.
  if (!pages.some((p) => /\*start\*transaction detail/i.test(p.text))) {
    throw new Error('No transactions page found');
  }
  const txnText = pages.map((p) => p.text).join('\n');
  const rows = parseTransactionLines(txnText, {
    periodStart: period.period_start,
    periodEnd: period.period_end,
    cleanMerchantName,
  });
  if (rows.length === 0) throw new Error('No transaction lines matched on the transactions page');

  // The strongest confidence signal available: opening balance plus
  // the net of every row, in this app's own sign convention (no
  // inversion needed here, unlike a credit card), should land exactly
  // on the printed closing balance.
  const netOfAllRows = rows.reduce((sum, r) => sum + r.amount_cents, 0);
  const balances_reconcile =
    opening_balance_cents === null || closing_balance_cents === null
      ? null
      : opening_balance_cents + netOfAllRows === closing_balance_cents;

  const reconciliation = { balances_reconcile };

  return {
    account: {
      name: null,
      issuer: 'Chase',
      mask,
      account_type: 'CHECKING',
      holder_name,
    },
    statement: {
      period_start: period.period_start,
      period_end: period.period_end,
      opening_balance_cents,
      closing_balance_cents,
      total_spend_cents: null, // a checking account has no single "spend" figure the way a card does
      total_payments_cents: null,
      cashback_earned_cents: null,
      cashback_balance_cents: null,
    },
    rows,
    reconciliation,
  };
}
