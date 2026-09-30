/**
 * Local (no API call) parser for Bank of America statements — two
 * real layouts, both built and verified against this household's own
 * statements (`api/scripts/verify-local-bofa.mjs`): credit cards
 * (Visa Signature, Customized Cash Rewards) and checking (Adv
 * SafeBalance Banking). The two layouts share almost no label text —
 * "Account#"/"Account number:", "Previous Balance"/"Beginning
 * balance", one date column vs two — so they're handled as two
 * genuinely separate extractors below, dispatched by which mask
 * pattern actually matches page 1. This single file was originally
 * credit-card only; the checking layout was added once it turned out
 * routing every "bank of america" guess through the credit-card-only
 * extractor meant every checking statement failed outright (wrong
 * label text, wrong date format) rather than just failing to
 * auto-suggest an account.
 *
 * Sign convention differs between the two, matching what each
 * account type is actually tracking: a credit card statement prints
 * from "what you owe" (a purchase is positive, a payment negative) —
 * the opposite of this app's "money in my pocket" convention, so
 * every credit-card transaction-line amount gets negated on the way
 * in. A checking statement already prints from the account holder's
 * own perspective (a deposit positive, a withdrawal already negative)
 * — the same convention this app uses — so checking amounts are taken
 * as printed, no inversion.
 *
 * Never silently drops a line: any line inside a recognized section
 * that isn't a header, a TOTAL line, or a continuation of the row
 * just added, and doesn't match the expected column pattern, fails
 * the whole parse rather than quietly losing a transaction — same
 * rule the CSV parser already follows (D12).
 */

import { parseMoney, extractAmountAfterLabel, classifyCheckingInflow, classifyCheckingOutflow, mergeContinuation } from './pdf-local-helpers.js';

/**
 * The money amount tied to a given label, searched one joined line at
 * a time — never across a line break. Page 1 is a flattened 2-column
 * layout: the same figure gets printed both ways in different spots
 * ("$ 2.39  New Balance Total" near the top, "New Balance Total   $
 * 2.39" again in the detail table further down), and a label that
 * happens to sit at the very end of one line, with an UNRELATED
 * amount starting the next, is exactly the trap a whole-text regex
 * with a bare `\s+` (which matches a newline too) falls into — caught
 * against real statement text, see BUILD-LOG.
 */
function extractLabeledAmount(text, label) {
  const money = '(-?\\s*\\$?\\s*(?:\\d{1,3}(?:,\\d{3})*)?\\.\\d{2})';
  const labelFirstRe = new RegExp(`${label}[ \\t]+${money}`, 'i');
  const moneyFirstRe = new RegExp(`${money}[ \\t]*${label}`, 'i');
  for (const line of text.split('\n')) {
    const labelFirst = line.match(labelFirstRe);
    if (labelFirst) return parseMoney(labelFirst[1]);
    const moneyFirst = line.match(moneyFirstRe);
    if (moneyFirst) return parseMoney(moneyFirst[1]);
  }
  return null;
}

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

/** "August 14 - September 13, 2026" -> { period_start: '2026-08-14', period_end: '2026-09-13' } */
function extractPeriod(pageOneText) {
  const m = pageOneText.match(
    /([A-Z][a-z]+)\s+(\d{1,2})\s*-\s*([A-Z][a-z]+)\s+(\d{1,2}),\s*(\d{4})/
  );
  if (!m) return null;
  const [, startMonthName, startDay, endMonthName, endDay, endYearStr] = m;
  const startMonth = MONTHS[startMonthName.toLowerCase()];
  const endMonth = MONTHS[endMonthName.toLowerCase()];
  if (!startMonth || !endMonth) return null;
  const endYear = Number(endYearStr);
  // A period only crosses a year boundary when the start month is
  // numerically after the end month (December 14 - January 13).
  const startYear = startMonth > endMonth ? endYear - 1 : endYear;
  const pad = (n) => String(n).padStart(2, '0');
  return {
    period_start: `${startYear}-${pad(startMonth)}-${pad(startDay)}`,
    period_end: `${endYear}-${pad(endMonth)}-${pad(endDay)}`,
  };
}

/** The account holder's printed name — the first short all-caps line on page 1. */
function extractHolderName(pageOneText) {
  const lines = pageOneText.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^[A-Z][A-Z'.\s-]{3,40}$/.test(trimmed) && trimmed.split(' ').length <= 5) {
      return trimmed;
    }
  }
  return null;
}

function extractMask(pageOneText) {
  const m = pageOneText.match(/Account#\s*([\d\s]{16,19})/);
  if (!m) return null;
  const digits = m[1].replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
}

function resolveYear(month, periodStart, periodEnd) {
  const startYear = Number(periodStart.slice(0, 4));
  const endYear = Number(periodEnd.slice(0, 4));
  if (startYear === endYear) return startYear;
  return month === 12 ? startYear : endYear;
}

const SECTION_HEADERS = [
  [/^Payments and Other Credits$/i, 'payments'],
  [/^Purchases and Adjustments$/i, 'purchases'],
  // A rare promotional feature (confirmed against one real statement,
  // not every card has it): BofA deposits cash straight to a linked
  // bank account, billed to the card like a cash advance. It prints
  // positive same as a purchase, but it isn't spend — the household
  // received real cash, not goods — so unlike every other section in
  // this file it's exempt from the uniform sign inversion below, and
  // gets 'transfer' rather than 'purchase' (matches how this exact
  // transaction was already classified before this section existed).
  [/^Direct Deposit and Check Cash Advances$/i, 'direct_deposit'],
  [/^Fees Charged$/i, 'fees'],
  [/^Fees$/i, 'fees'],
  [/^Interest Charged$/i, 'interest'],
];

const STOP_PHRASES = [
  /^Interest Charge Calculation/i,
  /^APR Type Definitions/i,
  /^\d{4} Totals Year-to-Date/i,
];

// Full form: two dates, description, a reference number, the
// account's last 4, then the amount — used by Payments and Purchases.
// The reference number is usually 4 digits but not always — a real
// dispute/interest adjustment prints an alphanumeric one ("42AJ") —
// while the account's own last-4 (the second group) is always
// numeric, so only the reference group needs the wider character set.
const TXN_LINE_FULL =
  /^(\d{2}\/\d{2})\s+(\d{2}\/\d{2})\s+(.+?)\s+([\dA-Z]{4})\s+(\d{4})\s+(-?\s?[\d,]+\.\d{2})\s*$/;

// Simple form: no reference/mask columns — used by Interest and Fees.
const TXN_LINE_SIMPLE =
  /^(\d{2}\/\d{2})\s+(\d{2}\/\d{2})\s+(.+?)\s+(-?\s?[\d,]+\.\d{2})\s*$/;

const SKIP_LINE_PATTERNS = [
  /^Transaction Posting Reference Account$/i,
  /^Date Date\s+Description/i,
  /^ Transactions$/i,
  // Just `/^TOTAL /i`, not requiring "FOR THIS PERIOD" on the same
  // line — the Direct Deposit section's own total wraps onto a second
  // physical line ("TOTAL DIRECT DEPOSIT AND CHECK CASH ADVANCES" /
  // "FOR THIS PERIOD   $9,500.00"), which the stricter pattern missed
  // entirely (confirmed against a real statement: the second line was
  // then merged into the row above as a bogus continuation instead of
  // being recognized as the section's own close). No real transaction
  // line starts with the literal word "TOTAL", so this is safe to
  // broaden.
  /^TOTAL /i,
  /^Page \d+ of \d+$/i,
];

const GENERIC_PAYMENT_PATTERNS = [/ELECTRONIC PAYMENT/i, /^PAYMENT FROM /i, /MOBILE PAYMENT/i, /ONLINE PAYMENT/i];
const CASHBACK_PATTERNS = [/CASHBACK/i, /CASH REWARDS STATEMENT CREDIT/i];

function classifyPaymentLine(description) {
  if (GENERIC_PAYMENT_PATTERNS.some((p) => p.test(description))) {
    return { txn_type: 'payment', category: 'Card Payment', merchant: null };
  }
  if (CASHBACK_PATTERNS.some((p) => p.test(description))) {
    return { txn_type: 'cashback', category: 'Cashback', merchant: null };
  }
  return { txn_type: 'refund', category: null, merchant: null };
}

/**
 * A transaction description that spills onto a second physical line —
 * confirmed against a real statement, not hypothetical: a travel
 * purchase's itinerary detail ("MORGAN ALE 12/29 AAA/BBB RNDTRP
 * BBB/AAA") prints on its own line right after the transaction line
 * that has the actual date/reference/amount columns. It has none of
 * those columns itself, so it can never be mistaken for a new
 * transaction — only for one that's genuinely unparseable, which is
 * why this is scoped tightly: only ever merged into the row that was
 * just added, in the same still-open section (a header or a skipped
 * TOTAL line clears `lastRow`, so a bad line right after a section
 * change still fails loudly instead of silently joining the wrong row).
 */
/**
 * Parses every "TRANSACTIONS"-classified page's text (already
 * concatenated in page order by the caller) into transaction rows.
 * Throws with a specific, actionable message on any line it can't
 * place — never silently drops one.
 */
function parseTransactionLines(text, { periodStart, periodEnd, issuer, cleanMerchantName }) {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l !== '');
  const rows = [];
  let section = null;
  let lastRow = null;

  for (const line of lines) {
    if (SKIP_LINE_PATTERNS.some((p) => p.test(line))) {
      section = /^TOTAL /i.test(line) ? null : section;
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
    if (section === null) continue; // page header / account-identity banner line

    if (section === 'payments' || section === 'purchases' || section === 'direct_deposit') {
      const m = line.match(TXN_LINE_FULL);
      if (!m) {
        if (lastRow) {
          mergeContinuation(lastRow, line);
          continue;
        }
        throw new Error(`Couldn't parse a ${section} line: "${line}"`);
      }
      const [, , postDate, description, , , amountStr] = m;
      const [mm, dd] = postDate.split('/').map(Number);
      const year = resolveYear(mm, periodStart, periodEnd);
      const pad = (n) => String(n).padStart(2, '0');
      const posted_date = `${year}-${pad(mm)}-${pad(dd)}`;
      const printedCents = parseMoney(amountStr);
      // Direct Deposit is the one section NOT inverted — see its own
      // comment on SECTION_HEADERS above.
      const amount_cents = section === 'direct_deposit' ? printedCents : -printedCents;

      if (section === 'direct_deposit') {
        rows.push({
          posted_date,
          description,
          merchant: cleanMerchantName(description),
          amount_cents,
          txn_type: 'transfer',
          suggested_category: null,
          confidence: 'HIGH',
          raw_text: line,
        });
      } else if (section === 'purchases') {
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
      } else {
        const { txn_type, category, merchant } = classifyPaymentLine(description);
        rows.push({
          posted_date,
          description,
          merchant: merchant ?? cleanMerchantName(description),
          amount_cents,
          txn_type,
          suggested_category: category,
          confidence: 'HIGH',
          raw_text: line,
        });
      }
      lastRow = rows[rows.length - 1];
    } else {
      // interest / fees — simple form
      const m = line.match(TXN_LINE_SIMPLE);
      if (!m) {
        if (lastRow) {
          mergeContinuation(lastRow, line);
          continue;
        }
        throw new Error(`Couldn't parse an ${section} line: "${line}"`);
      }
      const [, , postDate, description, amountStr] = m;
      const [mm, dd] = postDate.split('/').map(Number);
      const year = resolveYear(mm, periodStart, periodEnd);
      const pad = (n) => String(n).padStart(2, '0');
      const posted_date = `${year}-${pad(mm)}-${pad(dd)}`;
      const amount_cents = -parseMoney(amountStr);
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
      lastRow = rows[rows.length - 1];
    }
  }

  return rows;
}

/**
 * @param pages - all pages ({ pageNumber, text }), stage-1 output
 * @param classifications - stage-2 output (role per page)
 * @param cleanMerchantName - shared local merchant lookup (injected, not imported, so this file has no dependency direction on it beyond a function)
 * Returns { account, statement, rows } or throws with a specific message.
 */
function extractBofaCreditCardLocally(pages, classifications, cleanMerchantName) {
  const pageOne = pages[0]?.text ?? '';
  const holder_name = extractHolderName(pageOne);
  const mask = extractMask(pageOne);
  const period = extractPeriod(pageOne);
  if (!period) throw new Error('Could not find the statement period on page 1');
  if (!mask) throw new Error('Could not find the account number on page 1');

  const opening_balance_cents = extractLabeledAmount(pageOne, 'Previous Balance');
  const closing_balance_cents = extractLabeledAmount(pageOne, 'New Balance Total');

  // Cash-back page: "Base/Category/Relationship Cash Back Earned" plus
  // a running "Total Cash Back Available" — same three-component sum
  // rule as the AI prompt (categorize.js), because the statement
  // itself doesn't print one combined "earned this period" figure.
  const rewardsPage = classifications.find((c) => /reward|cash back/i.test(pages[c.pageNumber - 1]?.text ?? ''));
  let cashback_earned_cents = null;
  let cashback_balance_cents = null;
  if (rewardsPage) {
    const rewardsText = pages[rewardsPage.pageNumber - 1].text;
    const base = extractLabeledAmount(rewardsText, 'Base Cash Back Earned');
    const category = extractLabeledAmount(rewardsText, 'Category Bonus Earned');
    const relationship = extractLabeledAmount(rewardsText, 'Relationship Bonus Earned');
    if (base !== null || category !== null || relationship !== null) {
      cashback_earned_cents = (base ?? 0) + (category ?? 0) + (relationship ?? 0);
    }
    cashback_balance_cents = extractLabeledAmount(rewardsText, 'Total Cash Back Available');
  }

  const txnPages = classifications
    .filter((c) => c.role === 'TRANSACTIONS')
    .sort((a, b) => a.pageNumber - b.pageNumber);
  if (txnPages.length === 0) throw new Error('No transactions page found');

  const txnText = txnPages.map((c) => pages[c.pageNumber - 1].text).join('\n');
  const rows = parseTransactionLines(txnText, {
    periodStart: period.period_start,
    periodEnd: period.period_end,
    issuer: 'Bank of America',
    cleanMerchantName,
  });
  if (rows.length === 0) throw new Error('No transaction lines matched on the transactions page');

  // Cross-check against the statement's own printed totals — this is
  // the "verification" the local parser can do that the AI path
  // doesn't: the totals are printed numbers, not computed by either
  // of us, so if our line-by-line sum doesn't match them, something
  // was misparsed (or, just as likely, a real edge case we haven't
  // seen yet) and it's worth knowing which before trusting the rows.
  const totalPayments = extractAmountAfterLabel(txnText, 'TOTAL PAYMENTS AND OTHER CREDITS FOR THIS PERIOD');
  const totalPurchases = extractAmountAfterLabel(txnText, 'TOTAL PURCHASES AND ADJUSTMENTS FOR THIS PERIOD');
  const summedPayments = rows.filter((r) => r.txn_type === 'payment' || r.txn_type === 'refund' || r.txn_type === 'cashback')
    .reduce((sum, r) => sum + r.amount_cents, 0);
  const summedPurchases = rows.filter((r) => r.txn_type === 'purchase').reduce((sum, r) => sum + r.amount_cents, 0);

  // A second, independent check: opening balance minus the net of
  // EVERY row (purchases, payments, interest, fees, all in this
  // app's own signed convention) should land exactly on the printed
  // closing balance. This is the strongest single confidence signal
  // the local parser has, because it only passes when every section
  // was read correctly, not just one. (The minus, not plus, is not a
  // typo: the statement's own "balance owed" convention runs opposite
  // to this app's "money in my pocket" convention — verified against
  // real statement arithmetic, see BUILD-LOG.)
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
      name: null, // the statement's own product name isn't authoritative for matching; mask is
      issuer: 'Bank of America',
      mask,
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
      cashback_earned_cents,
      cashback_balance_cents,
    },
    rows,
    reconciliation,
  };
}

/* ------------------------------------------------------------------
   Checking (Adv SafeBalance Banking) — a genuinely different layout,
   not a variant of the credit-card one above.
   ------------------------------------------------------------------ */

// "Account number: 4000 1234 5678" on page 1, or "Account # 4000 1234
// 5678" on the running header of later pages — a space before "#",
// unlike the credit-card layout's "Account#". A checking number is 12
// digits (3 groups of 4), shorter than a 16-digit card PAN.
function extractCheckingMask(text) {
  const m = text.match(/Account\s*(?:number)?:?\s*#?\s*([\d\s]{10,16})/i);
  if (!m) return null;
  const digits = m[1].replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
}

// "Beginning balance on June 16, 2026   $1,234.56" — the date sits
// between the label and the amount, unlike every other labeled amount
// in this file, so this needs its own loose (label ... amount) match
// rather than extractLabeledAmount's adjacent-only pattern.
function extractCheckingBalance(text, labelPrefix) {
  const re = new RegExp(`${labelPrefix}.*?\\$?\\s*([\\d,]+\\.\\d{2})`, 'i');
  for (const line of text.split('\n')) {
    const m = line.match(re);
    if (m) return parseMoney(m[1]);
  }
  return null;
}

/** "June 16, 2026 to July 17, 2026" -> { period_start, period_end } — both years always printed, no rollover inference needed. */
function extractCheckingPeriod(text) {
  const m = text.match(
    /([A-Z][a-z]+)\s+(\d{1,2}),\s*(\d{4})\s+to\s+([A-Z][a-z]+)\s+(\d{1,2}),\s*(\d{4})/
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

const CHECKING_SECTION_HEADERS = [
  [/^Deposits and other additions$/i, 'deposits'],
  // A parent header with no rows of its own — always followed by one
  // of the real leaf sections below. Mapping it to `null` clears
  // `section` (and so `lastRow`) rather than leaving the previous
  // section's state stale, which would otherwise risk this line, or
  // a genuinely-broken first line of the next section, silently
  // merging into the wrong row.
  [/^Withdrawals and other subtractions$/i, null],
  [/^Checks$/i, 'checks'],
  [/^ATM and debit card subtractions$/i, 'atm'],
  [/^Other subtractions$/i, 'other'],
  [/^Service fees$/i, 'fees'],
];

const CHECKING_STOP_PHRASES = [/^Braille and Large Print Request/i];

// Ignored outright, section untouched — a column-header repeat or page
// footer, never a signal that the current section has ended.
const CHECKING_IGNORE_PATTERNS = [/^Date\s+Description\s+Amount$/i, /^Page \d+ of \d+$/i];

// A real TOTAL line — this section's rows are done. Distinct from the
// ignore patterns above: this line means "the section that was just
// open is now closed," which the ignore patterns must NOT trigger
// (a bug caught here, not from a real statement mismatch: the column-
// header line was tripping this same reset one line after the section
// header set it, wiping the section before any row was ever read).
const CHECKING_SECTION_END_PATTERNS = [/^TOTAL /i, /^Total (deposits|other subtractions|checks|ATM)/i];

// One date column, already 4-digit-year-bearing (MM/DD/YY), unlike
// the credit card layout's two dateless MM/DD columns — no year
// resolution needed here.
//
// `-?\s?`, not a bare `-?` — a real Chase checking line printed a
// space between the minus and a small amount ("- 7.75"), a pdf.js
// glyph-positioning artifact; without tolerating it, the minus wasn't
// captured as part of the amount and a real payment landed in the
// ledger as a positive deposit instead. Same fix as pdf-local-chase.js's
// TXN_LINE, applied here defensively — not yet confirmed against a
// real BofA statement, but it's the identical column shape.
const CHECKING_TXN_LINE = /^(\d{2}\/\d{2}\/\d{2})\s+(.+?)\s+(-?\s?[\d,]+\.\d{2})$/;

function parseCheckingTransactionLines(text, { cleanMerchantName }) {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l !== '');
  const rows = [];
  let section = null;
  let lastRow = null;

  for (const line of lines) {
    if (CHECKING_IGNORE_PATTERNS.some((p) => p.test(line))) continue;
    if (CHECKING_SECTION_END_PATTERNS.some((p) => p.test(line))) {
      section = null;
      lastRow = null;
      continue;
    }
    if (CHECKING_STOP_PHRASES.some((p) => p.test(line))) break;

    const headerMatch = CHECKING_SECTION_HEADERS.find(([p]) => p.test(line));
    if (headerMatch) {
      section = headerMatch[1];
      lastRow = null;
      continue;
    }
    if (section === null) continue;

    const m = line.match(CHECKING_TXN_LINE);
    if (!m) {
      if (lastRow) {
        mergeContinuation(lastRow, line);
        continue;
      }
      throw new Error(`Couldn't parse a ${section} line: "${line}"`);
    }

    const [, dateStr, description, amountStr] = m;
    const [mm, dd, yy] = dateStr.split('/');
    const posted_date = `20${yy}-${mm}-${dd}`;
    const amount_cents = parseMoney(amountStr); // already this app's own sign convention, no inversion

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

function extractBofaCheckingLocally(pages, classifications, cleanMerchantName) {
  const pageOne = pages[0]?.text ?? '';
  const holder_name = extractHolderName(pageOne);
  const mask = extractCheckingMask(pageOne);
  const period = extractCheckingPeriod(pageOne);
  if (!mask) throw new Error('Could not find the account number on page 1');
  if (!period) throw new Error('Could not find the statement period on page 1');

  const opening_balance_cents = extractCheckingBalance(pageOne, 'Beginning balance on');
  const closing_balance_cents = extractCheckingBalance(pageOne, 'Ending balance on');

  const txnPages = classifications
    .filter((c) => c.role === 'TRANSACTIONS')
    .sort((a, b) => a.pageNumber - b.pageNumber);
  if (txnPages.length === 0) throw new Error('No transactions page found');

  const txnText = txnPages.map((c) => pages[c.pageNumber - 1].text).join('\n');
  const rows = parseCheckingTransactionLines(txnText, { cleanMerchantName });
  if (rows.length === 0) throw new Error('No transaction lines matched on the transactions page');

  const totalDeposits = extractAmountAfterLabel(txnText, 'Total deposits and other additions');
  const totalSubtractions = extractAmountAfterLabel(txnText, 'Total other subtractions');
  const summedDeposits = rows.filter((r) => r.amount_cents > 0).reduce((sum, r) => sum + r.amount_cents, 0);
  const summedSubtractions = rows.filter((r) => r.amount_cents < 0).reduce((sum, r) => sum + r.amount_cents, 0);

  const netOfAllRows = rows.reduce((sum, r) => sum + r.amount_cents, 0);
  const balances_reconcile =
    opening_balance_cents === null || closing_balance_cents === null
      ? null
      : opening_balance_cents + netOfAllRows === closing_balance_cents;

  const reconciliation = {
    deposits_match: totalDeposits === null || totalDeposits === summedDeposits,
    subtractions_match: totalSubtractions === null || totalSubtractions === summedSubtractions,
    balances_reconcile,
  };

  return {
    account: {
      name: null,
      issuer: 'Bank of America',
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

/**
 * Dispatch on which layout page 1 actually matches, rather than
 * threading an account-type hint through pdf-local.js's issuer-only
 * dispatch table — both BofA layouts share the one 'bank of america'
 * issuer guess (layout-cache.js), so the credit-card-vs-checking
 * decision has to happen in here regardless.
 *
 * Tests for the credit-card layout specifically (its unique, no-space
 * "Account#1234..." form), not the checking layout — a first attempt
 * tested for "Account number:" instead, which looked checking-only in
 * a trimmed test fixture but, confirmed against a REAL full page 1,
 * also appears on every credit-card statement's own payment coupon at
 * the bottom of the page ("BANK OF AMERICA Account Number: ..."),
 * silently routing every real credit-card statement to the wrong
 * extractor. The no-space form is only ever the credit-card layout's
 * own top-of-page account line — never seen on a checking statement.
 */
export function extractBofaLocally(pages, classifications, cleanMerchantName) {
  const pageOne = pages[0]?.text ?? '';
  const isCreditCard = /Account#\s*[\d\s]{16,19}/i.test(pageOne);
  return isCreditCard
    ? extractBofaCreditCardLocally(pages, classifications, cleanMerchantName)
    : extractBofaCheckingLocally(pages, classifications, cleanMerchantName);
}
