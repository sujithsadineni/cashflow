/**
 * Local (no API call) parser for American Express credit-card
 * statements — built and verified against this household's own real
 * statements (`api/scripts/verify/verify-local-amex.mjs`).
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

import { parseMoney, extractAmountAfterLabel } from '../pdf-local-helpers.js';

const DATE_RE = /(\d{2}\/\d{2}\/\d{2})\*?/;
const MONEY_RE = /(-)?\$\s?([\d,]+\.\d{2})/;

// A balance in Amex's favour is printed "CR$2.49" or "$60.53CR" (D273): a credit, so
// negative here, where a card balance is what's owed.
const AMEX_AMOUNT = '(CR)?(-?\\$\\s?[\\d,]+\\.\\d{2})(CR)?';
const amexCents = (m) => (m[1] || m[3] ? -1 : 1) * parseMoney(m[2]);

function extractLabeledAmount(text, label) {
  const re = new RegExp(`${label}[ \\t]+${AMEX_AMOUNT}`, 'i');
  for (const line of text.split('\n')) {
    const m = line.match(re);
    if (m) return amexCents(m);
  }
  return null;
}

/**
 * The last amount on a label's line (D340): with a Plan It plan, Amex prints "Non-Plan Balance,
 * Plan Balance, Total" and a payment is itemised once for the total, so its check is against the
 * Total column. On a card without a plan there's one amount, and first and last are the same.
 */
export function lastAmountAfterLabel(text, label) {
  const start = new RegExp(`${label}[ \\t]+`, 'i');
  for (const line of text.split('\n')) {
    const at = line.search(start);
    if (at === -1) continue;
    const amounts = [...line.slice(at).matchAll(/-?\$\s?[\d,]+\.\d{2}/g)];
    if (amounts.length) return parseMoney(amounts.at(-1)[0]);
  }
  return null;
}

const dayAfterAMonthBefore = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 2, d + 1)).toISOString().slice(0, 10);
};

/**
 * Amex doesn't print a period_start anywhere on the statement — only a
 * Closing Date. The earliest transaction date is the best stand-in; it's
 * this app's own de-dup/display field, not an accounting figure, so a day
 * or two of slack is harmless. But a dispute credit, its reversal or a
 * refund keeps the original purchase's date, weeks before the cycle
 * (D275: a Walmart dispute dated Jan 6 put two 2025 statements' starts on
 * Jan 6 and made them overlap). Rows dated more than a week before "a
 * month before the close" don't count. With none left, a month before
 * the closing date stands in (D273).
 */
export function amexPeriodStart(rows, period_end, billingDays = null) {
  // Amex prints "Days in Billing Period: 31" (D341): the cycle exactly, not a guess from the
  // first purchase, which put a March statement's start on Mar 18 and left March showing Missing.
  if (billingDays) {
    const [ey, em, ed] = period_end.split('-').map(Number);
    return new Date(Date.UTC(ey, em - 1, ed - billingDays + 1)).toISOString().slice(0, 10);
  }
  const monthBefore = dayAfterAMonthBefore(period_end);
  const [y, m, d] = monthBefore.split('-').map(Number);
  const earliestPlausible = new Date(Date.UTC(y, m - 1, d - 7)).toISOString().slice(0, 10);
  const dates = rows.map((r) => r.posted_date).filter((date) => date >= earliestPlausible).sort();
  return dates[0] ?? monthBefore;
}

/** A statement with no activity at all (D273): $0.00 payments, charges, fees and interest on its summary. */
export function noActivity(pageOneText) {
  const zero = (label) => new RegExp(`${label}\\s+[+-]?\\$0\\.00\\b`, 'i').test(pageOneText);
  return zero('Payments/Credits') && zero('New Charges') && zero('Fees') && zero('Interest Charged');
}

/**
 * The balance a statement opens with. A card with an Amex "Plan It" plan
 * prints its summary twice, the plan's and the rest's, each with its own
 * "Previous Balance" ($0.00 and $1,993.67, say). The statement's New
 * Balance is their total, so its opening balance is too: reading only the
 * first made 27 statements look short by exactly the other one (D271).
 */
export function extractOpeningBalance(pageOneText) {
  const re = new RegExp(`Previous Balance[ \\t]+${AMEX_AMOUNT}`, 'i');
  const all = pageOneText.split('\n').map((line) => line.match(re)).filter(Boolean).map(amexCents);
  if (all.length === 0) return null;
  const hasPlan = /\bPlan Balance\b|\bNew Plan Principal\b/i.test(pageOneText);
  return hasPlan ? all.reduce((sum, c) => sum + c, 0) : all[0];
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

// The Reward Dollars box on page 1 (D331). Amex prints the balance as of the
// previous statement's closing date, the date on the line above the figure:
//   " Reward Dollars" / " New Balance   $512.40" / " as of 08/25/2026" / " 143.27"
// (the card's New Balance is interleaved, so the figure is the line after "as of").
const REWARD_BOX = /Reward Dollars[\s\S]{0,120}?as of (\d{2})\/(\d{2})\/(\d{4})[ \t]*\n[ \t]*(-?[\d,]*\.\d{2})/;
export function extractRewardDollars(pageOneText) {
  const m = (pageOneText ?? '').match(REWARD_BOX);
  if (!m) return null;
  return { cents: parseMoney(m[4]), as_of: `${m[3]}-${m[1]}-${m[2]}` };
}

// The product printed at the top of page 1: "Blue Cash Everyday® from
// American Express", "American Express Cash Magnet® Card". It changes
// with an upgrade while the account stays the same (D275).
export function extractProductName(pageOneText) {
  const line = pageOneText.split('\n').find((l) => /®/.test(l) && /american\s+express/i.test(l));
  if (!line) return null;
  const name = line
    .replace(/p\.\s*\d+\/\d+/i, '')
    .replace(/®/g, '')
    .replace(/\s+from\s+American\s+Express/i, '')
    .replace(/^\s*American\s+Express\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return name || null;
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

// The card paying you, not a merchant giving money back: cashback (D303).
// Amex prints offers as "… Amex Offer Credit", a streaming credit, or an
// offer code with "10.00% back".
const AMEX_OFFER_PATTERN = /Amex Offer Credit|Streaming Credit|\d+(\.\d+)?% back\b/i;

function classifySectionLine(section, description) {
  if (section === 'charges') return { txn_type: 'purchase', category: null };
  if (section === 'payments') return { txn_type: 'payment', category: 'Card Payment' };
  if (section === 'credits') {
    return AMEX_OFFER_PATTERN.test(description)
      ? { txn_type: 'cashback', category: 'Cashback' }
      : { txn_type: 'refund', category: 'Refund' };
  }
  if (section === 'interest') return { txn_type: 'interest', category: 'Interest' };
  return { txn_type: 'fee', category: null };
}

function parseTransactionLines(text, { issuer, cleanMerchantName }) {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l !== '');
  const rows = [];
  let section = null;
  // New Charges are listed per card member: a name line, then "Card Ending 7-21234" (D344). Each
  // charge keeps that name and the card's last four; the block lasts until the next section.
  let holder = null;
  let lineBefore = null;
  // pdf.js's text layer sometimes emits the exact same visual line
  // twice in a row, differing only in incidental whitespace (confirmed
  // against real statement text) — that's a rendering artifact, not a
  // second transaction, so an anchor line identical to the line
  // *immediately* before it is dropped.
  //
  // Only immediately (D214). This used to drop any repeat within a
  // cardholder's block, and a real Blue Cash Everyday statement lost a
  // genuine second $50 Spectrum charge: same date, same amount, same
  // text, but with its own "CABLE SVC" continuation line between the
  // two. The statement's "Total New Charges $100.00" proved both were
  // real. Any line in between (a continuation, a sub-header) means the
  // next anchor is a new transaction.
  let previousLine = null;
  // Repeats set aside, not lost (D340): two genuinely identical credits can print one after the
  // other ("FRAUD CREDIT … -$9.04" twice), and the printed total is what tells the two apart.
  const repeats = [];

  for (const line of lines) {
    const normalized = line.replace(/\s+/g, ' ');
    const repeat = normalized === previousLine;
    previousLine = normalized;

    const before = lineBefore;
    lineBefore = normalized;
    const headerMatch = SECTION_HEADERS.find(([p]) => p.test(line));
    if (headerMatch) {
      section = headerMatch[1];
      holder = null;
      continue;
    }
    // The name is the line above, or the same line when the PDF flattens them together.
    const cardEnding = normalized.match(/^(?:(.+?) )?Card Ending [\d-]*(\d{4})$/);
    if (cardEnding) {
      holder = { spender_name: cardEnding[1] ?? before, card_ending: cardEnding[2] };
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
      // Except one: Amex often prints "Amex Offer Credit" on its own line
      // under the merchant ("GROUPON 07/24/26 -$10.00", "CHICAGO", "Amex
      // Offer Credit"), and that makes the credit above it cashback (D303).
      const last = rows.at(-1);
      if (section === 'credits' && last?.section === 'credits' && AMEX_OFFER_PATTERN.test(line)) {
        Object.assign(last, { txn_type: 'cashback', suggested_category: 'Cashback', raw_text: `${last.raw_text}\n${line}` });
      }
      continue;
    }
    if (section === null) continue; // a date+money line before any known section started

    const description = line
      .replace(dateMatch[0], ' ')
      .replace(moneyMatch[0], ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    const [, mm, dd, yy] = line.match(/(\d{2})\/(\d{2})\/(\d{2})/);
    const posted_date = `20${yy}-${mm}-${dd}`;
    const amount_cents = -parseMoney(moneyMatch[0]);

    const { txn_type, category } = classifySectionLine(section, description);
    (repeat ? repeats : rows).push({
      posted_date,
      description,
      merchant: section === 'interest' || section === 'fees' ? issuer : cleanMerchantName(description),
      amount_cents,
      txn_type,
      suggested_category: category,
      confidence: 'HIGH',
      raw_text: line,
      section,
      ...(section === 'charges' ? holder : null),
    });
  }

  const strip = ({ section: _section, ...row }) => row;
  return { rows: rows.map(strip), repeats: repeats.map(strip) };
}

/**
 * Put back the repeats the printed totals prove are real (D340): only when adding a group of them
 * makes its side match to the cent. Payments and credits are one side, charges the other.
 */
export function restoreProvenRepeats(rows, repeats, { payments, charges }) {
  const credit = (r) => r.txn_type === 'payment' || r.txn_type === 'refund' || r.txn_type === 'cashback';
  const sum = (list) => list.reduce((s, r) => s + r.amount_cents, 0);
  const out = [...rows];
  for (const [isSide, total] of [[credit, payments], [(r) => r.txn_type === 'purchase', charges]]) {
    const extra = repeats.filter(isSide);
    if (total === null || extra.length === 0) continue;
    if (sum(out.filter(isSide)) !== total && sum(out.filter(isSide)) + sum(extra) === total) out.push(...extra);
  }
  return out;
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

  const opening_balance_cents = extractOpeningBalance(pageOne);
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
  // A SUMMARY page just before the first TRANSACTIONS page that starts the
  // detail listing, a section header and at least one dated row on it (D271): a 2024 Amex layout puts the Payments and Credits
  // summary, their rows and the first New Charges on one page scored as a
  // summary, and the next page opens "Detail Continued" with no section
  // header, so leaving it out lost every row of five statements.
  const firstTxn = Math.min(...txnPageNumbers);
  const before = sorted.find((c) => c.pageNumber === firstTxn - 1);
  const beforeLines = (pages[(before?.pageNumber ?? 0) - 1]?.text ?? '').split('\n').map((l) => l.trim());
  if (before?.role === 'SUMMARY'
      && SECTION_HEADERS.some(([re]) => beforeLines.some((l) => re.test(l)))
      && beforeLines.some((l) => DATE_RE.test(l) && MONEY_RE.test(l))) {
    txnPageNumbers.add(before.pageNumber);
  }
  // A 2023 Blue Cash Everyday layout (D340) scores its Credits detail and its New Charges detail
  // (pages 3 and 4) as summaries, and the interest table and boilerplate after them as
  // transactions, so nothing dated was ever read. Any page after the first that opens one of
  // the statement's own sections is detail, and so is every page between two such pages.
  const lineSets = pages.map((p) => (p.text ?? '').split('\n').map((l) => l.trim()));
  const sectioned = sorted
    .filter((c) => c.pageNumber > 1 && c.role !== 'BOILERPLATE')
    .filter((c) => SECTION_HEADERS.some(([re]) => (lineSets[c.pageNumber - 1] ?? []).some((l) => re.test(l))))
    .map((c) => c.pageNumber);
  if (sectioned.length > 0) {
    for (let n = Math.min(...sectioned); n <= Math.max(...sectioned); n++) {
      if (sorted.find((c) => c.pageNumber === n)?.role !== 'BOILERPLATE') txnPageNumbers.add(n);
    }
  }
  if (txnPageNumbers.size === 0) throw new Error('No transactions page found');

  const txnText = [...txnPageNumbers]
    .sort((a, b) => a - b)
    .map((n) => pages[n - 1].text)
    .join('\n');
  const parsed = parseTransactionLines(txnText, { issuer: 'American Express', cleanMerchantName });
  const totalPayments = lastAmountAfterLabel(txnText, 'Total Payments and Credits');
  // Charges are itemised in the Non-Plan column (a purchase moved onto a plan stays a charge), so first.
  const totalCharges = extractAmountAfterLabel(txnText, 'Total New Charges');
  // A Plan It credit (D340) moves a purchase onto a plan: the purchase is already among the
  // charges, and the credit is printed only in the summary, so the credits are checked without it.
  const planItCredit = lastAmountAfterLabel(txnText, 'Plan It Credit') ?? 0;
  const itemisedCredits = totalPayments === null ? null : totalPayments - planItCredit;
  const rows = restoreProvenRepeats(parsed.rows, parsed.repeats, {
    payments: itemisedCredits === null ? null : -itemisedCredits,
    charges: totalCharges === null ? null : -totalCharges,
  });
  // A statement with no rows is real only when its summary says nothing happened (D273):
  // a card that sat untouched still gets a statement while it holds a balance.
  if (rows.length === 0 && !noActivity(pageOne)) throw new Error('No transaction lines matched on the transactions pages');

  const billingDays = Number(pages.map((p) => p.text ?? '').join('\n').match(/Days in Billing Period:\s*(\d{1,2})\b/)?.[1]) || null;
  const period_start = amexPeriodStart(rows, period_end, billingDays);
  const rewards = extractRewardDollars(pageOne);

  const summedPayments = rows
    .filter((r) => r.txn_type === 'payment' || r.txn_type === 'refund' || r.txn_type === 'cashback')
    .reduce((sum, r) => sum + r.amount_cents, 0);
  const summedCharges = rows.filter((r) => r.txn_type === 'purchase').reduce((sum, r) => sum + r.amount_cents, 0);

  const reconciliation = {
    payments_match: itemisedCredits === null || -itemisedCredits === summedPayments,
    charges_match: totalCharges === null || -totalCharges === summedCharges,
  };

  return {
    account: {
      name: extractProductName(pageOne),
      // The printed product, kept on the statement (D275). Only readers that
      // read it off the page set this; a guessed account name isn't a product.
      product: extractProductName(pageOne),
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
      // Amex prints only the Reward Dollars balance, not what was earned.
      cashback_earned_cents: null,
      cashback_balance_cents: rewards?.cents ?? null,
      cashback_balance_as_of: rewards?.as_of ?? null,
    },
    rows,
    reconciliation,
  };
}
