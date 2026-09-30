/**
 * Local (no API call) parser for American Express credit-card
 * statements — built and verified against this household's own real
 * statements (`api/scripts/verify-local-amex.mjs`).
 *
 * Amex's layout is genuinely harder to parse deterministically than
 * Bank of America's (see pdf-local-bofa.js): a joint account splits
 * transactions into per-cardholder blocks, spans several pages, and —
 * confirmed against real extracted text, not assumed — a
 * transaction's date and amount don't keep a fixed left-to-right
 * order; some lines print "$38.05  04/03/26", others print
 * "04/03/26   $42.17" for no discernible reason (almost certainly an
 * artifact of how the underlying 2-column PDF layout happens to
 * flatten for that particular line length). Rather than commit to one
 * order, every line inside a recognized section is scanned for a
 * date pattern and a money pattern independently; if a line has both,
 * it's a transaction and whatever text is left over (with those two
 * tokens removed) is the description. A continuation line — a phone
 * number, a city/state, a category label — has neither, so it's never
 * mistaken for a transaction; per-cardholder subtotal lines under a
 * "Summary" sub-header have money but no date, so those are safely
 * skipped too, with no separate Summary/Detail tracking needed.
 *
 * Same sign rule as BofA: the statement prints from "what you owe"'s
 * perspective (a charge is positive, a payment/credit is negative),
 * this app's convention is the opposite, so every amount is negated
 * uniformly on the way in.
 */

import { parseMoney, extractAmountAfterLabel } from './pdf-local-helpers.js';

const DATE_RE = /(\d{2}\/\d{2}\/\d{2})\*?/;
const MONEY_RE = /(-)?\$\s?([\d,]+\.\d{2})/;

function extractLabeledAmount(text, label) {
  const re = new RegExp(`${label}[ \\t]+(-?\\$\\s?[\\d,]+\\.\\d{2})`, 'i');
  for (const line of text.split('\n')) {
    const m = line.match(re);
    if (m) return parseMoney(m[1]);
  }
  return null;
}

// Unlike BofA, Amex's page 1 never puts the holder's name alone on
// its own line — it's flattened onto the end of "Customer Care:
// <phone>  NAME" (real, confirmed against captured text) — so this
// looks for that specific anchor first, falling back to a whole-line
// match in case a differently-laid-out Amex statement doesn't do that.
function extractHolderName(pageOneText) {
  const afterCustomerCare = pageOneText.match(/Customer Care:\s*[\d-]+\s+([A-Z][A-Z\s]+?)\s*$/m);
  if (afterCustomerCare) return afterCustomerCare[1].trim();

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
  const m = pageOneText.match(/Account Ending\s+([\d-]{4,10})/i);
  if (!m) return null;
  const digits = m[1].replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
}

function extractClosingDate(pageOneText) {
  const m = pageOneText.match(/Closing Date\s+(\d{2})\/(\d{2})\/(\d{2})/i);
  if (!m) return null;
  const [, mm, dd, yy] = m;
  return `20${yy}-${mm}-${dd}`;
}

// The "Amount" column header sometimes flattens onto the same joined
// line as the section name ("Payments   Amount") — real, seen in
// actual statement text, not hypothetical, and a bare `/^Payments$/`
// silently misses the transition when it happens, which then drops
// every row in that section (caught by a unit test, not by the
// real-statement check, since a missing row never shows up as a
// mismatch — there's nothing to compare it against).
const SECTION_HEADERS = [
  [/^Payments(\s+Amount)?$/, 'payments'],
  [/^Credits(\s+Amount)?$/, 'credits'],
  [/^New Charges$/, 'charges'],
  [/^Fees(\s+Amount)?$/, 'fees'],
  [/^Interest Charged(\s+Amount)?$/, 'interest'],
];

const STOP_PHRASES = [
  /^About Trailing Interest/i,
  /^\d{4} Fees and Interest Totals/i,
  /^Interest Charge Calculation/i,
];

const AMEX_OFFER_PATTERN = /Amex Offer Credit|Streaming Credit/i;

function classifySectionLine(section, description) {
  if (section === 'charges') return { txn_type: 'purchase', category: null };
  if (section === 'payments') return { txn_type: 'payment', category: 'Card Payment' };
  if (section === 'credits') {
    return AMEX_OFFER_PATTERN.test(description)
      ? { txn_type: 'refund', category: 'Cashback' }
      : { txn_type: 'refund', category: 'Refund' };
  }
  if (section === 'interest') return { txn_type: 'interest', category: 'Interest' };
  return { txn_type: 'fee', category: null };
}

function parseTransactionLines(text, { issuer, cleanMerchantName }) {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l !== '');
  const rows = [];
  let section = null;
  // pdf.js's text layer sometimes emits the exact same visual line
  // twice in a row, differing only in incidental whitespace (confirmed
  // against real statement text) — that's a rendering artifact, not a
  // second transaction, and gets deduped by exact normalized text.
  // But a real household statement also has a genuine same-store,
  // same-day, same-amount purchase on the SAME line text — two
  // cardholders on a joint account both buying $100 of groceries at
  // the same place, confirmed against a real case — so the dedupe set
  // resets at every "Card Ending" sub-header. That keeps it catching
  // only an immediate back-to-back repeat within one cardholder's own
  // block, never two different cardholders' otherwise-identical lines.
  const seenLines = new Set();

  for (const line of lines) {
    if (/Card Ending/i.test(line)) seenLines.clear();

    const headerMatch = SECTION_HEADERS.find(([p]) => p.test(line));
    if (headerMatch) {
      section = headerMatch[1];
      continue;
    }
    if (STOP_PHRASES.some((p) => p.test(line))) {
      // Not a hard stop: with several TRANSACTIONS-classified pages
      // concatenated into one stream, "Interest Charge Calculation"
      // boilerplate on an earlier page would otherwise abort before a
      // later page's real content ever gets scanned (confirmed against
      // real statement text — a real household statement has exactly
      // this shape). Drop out of whatever section we were in and keep
      // scanning for the next real header instead.
      section = null;
      continue;
    }

    const dateMatch = line.match(DATE_RE);
    const moneyMatch = line.match(MONEY_RE);
    if (!dateMatch || !moneyMatch) {
      // Not a transaction anchor line — a continuation line, a
      // per-cardholder subtotal with no date, a column header. Absence
      // of BOTH tokens is sufficient on its own; nothing else to check.
      continue;
    }
    if (section === null) continue; // a date+money line before any known section started

    const normalizedLine = line.replace(/\s+/g, ' ');
    if (seenLines.has(normalizedLine)) continue;
    seenLines.add(normalizedLine);

    const description = line
      .replace(dateMatch[0], ' ')
      .replace(moneyMatch[0], ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    const [, mm, dd, yy] = line.match(/(\d{2})\/(\d{2})\/(\d{2})/);
    const posted_date = `20${yy}-${mm}-${dd}`;
    const amount_cents = -parseMoney(moneyMatch[0]);

    const { txn_type, category } = classifySectionLine(section, description);
    rows.push({
      posted_date,
      description,
      merchant: section === 'interest' || section === 'fees' ? issuer : cleanMerchantName(description),
      amount_cents,
      txn_type,
      suggested_category: category,
      confidence: 'HIGH',
      raw_text: line,
    });
  }

  return rows;
}

/**
 * @param pages - all pages ({ pageNumber, text }), stage-1 output
 * @param classifications - stage-2 output (role per page)
 * @param cleanMerchantName - shared local merchant lookup
 * Returns { account, statement, rows, reconciliation } or throws with a specific message.
 */
export function extractAmexLocally(pages, classifications, cleanMerchantName) {
  const pageOne = pages[0]?.text ?? '';
  const holder_name = extractHolderName(pageOne);
  const mask = extractMask(pageOne);
  const period_end = extractClosingDate(pageOne);
  if (!mask) throw new Error('Could not find "Account Ending" on page 1');
  if (!period_end) throw new Error('Could not find the Closing Date on page 1');

  const opening_balance_cents = extractLabeledAmount(pageOne, 'Previous Balance');
  // "New Balance" on Amex is unsigned/always positive as printed (what
  // you owe), unlike BofA's signed version — matches this app's own
  // convention for "how much is owed" directly, no flip needed. A
  // credit balance (you're owed money) prints with its own minus, so
  // this still uses the signed regex, just without assuming a sign.
  const closing_balance_cents = extractLabeledAmount(pageOne, 'New Balance');

  // A page landing between two TRANSACTIONS pages but classified
  // SUMMARY happens for real on this household's own statements — a
  // per-cardholder detail block sparse enough (fewer dates/dollars
  // per line than stage 2's thresholds expect) to score as a summary
  // page even though it's genuine transaction detail, not a boilerplate
  // or account-overview page. Stage 2's thresholds are shared with the
  // AI path and tuned against real data (D19); the safe fix here is
  // local to this parser, not loosening that shared classifier: include
  // a SUMMARY page only when it's sandwiched, never a standalone one
  // like page 1's account overview or the closing Fees/Interest table.
  const sorted = [...classifications].sort((a, b) => a.pageNumber - b.pageNumber);
  const txnPageNumbers = new Set();
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].role === 'TRANSACTIONS') {
      txnPageNumbers.add(sorted[i].pageNumber);
    } else if (
      sorted[i].role === 'SUMMARY' &&
      sorted[i - 1]?.role === 'TRANSACTIONS' &&
      sorted[i + 1]?.role === 'TRANSACTIONS'
    ) {
      txnPageNumbers.add(sorted[i].pageNumber);
    }
  }
  if (txnPageNumbers.size === 0) throw new Error('No transactions page found');

  const txnText = [...txnPageNumbers]
    .sort((a, b) => a - b)
    .map((n) => pages[n - 1].text)
    .join('\n');
  const rows = parseTransactionLines(txnText, { issuer: 'American Express', cleanMerchantName });
  if (rows.length === 0) throw new Error('No transaction lines matched on the transactions pages');

  // Amex doesn't print a period_start anywhere on the statement — only
  // a Closing Date. The earliest transaction date found is the best
  // available stand-in; it's this app's own de-dup/display field, not
  // an accounting figure, so a day or two of slack here is harmless.
  const period_start = rows.map((r) => r.posted_date).sort()[0];

  const totalPayments = extractAmountAfterLabel(txnText, 'Total Payments and Credits');
  const totalCharges = extractAmountAfterLabel(txnText, 'Total New Charges');
  const summedPayments = rows
    .filter((r) => r.txn_type === 'payment' || r.txn_type === 'refund')
    .reduce((sum, r) => sum + r.amount_cents, 0);
  const summedCharges = rows.filter((r) => r.txn_type === 'purchase').reduce((sum, r) => sum + r.amount_cents, 0);

  const reconciliation = {
    payments_match: totalPayments === null || -totalPayments === summedPayments,
    charges_match: totalCharges === null || -totalCharges === summedCharges,
  };

  return {
    account: {
      name: null,
      issuer: 'American Express',
      mask,
      account_type: 'CREDIT_CARD',
      holder_name,
    },
    statement: {
      period_start,
      period_end,
      opening_balance_cents,
      closing_balance_cents,
      total_spend_cents: totalCharges === null ? null : -totalCharges,
      total_payments_cents: totalPayments === null ? null : -totalPayments,
      cashback_earned_cents: null, // Amex prints "Reward Dollars", a different rewards program shape — not built yet, see BUILD-LOG
      cashback_balance_cents: null,
    },
    rows,
    reconciliation,
  };
}
