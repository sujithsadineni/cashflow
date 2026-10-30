/**
 * Local (no API call) parser for Barclays card statements: the Frontier
 * Airlines World Mastercard (D187). Built against this household's own
 * statements (`api/scripts/verify/verify-local-barclays.mjs`).
 *
 * Layout, confirmed against real text:
 *   - Page 1: "<HOLDER> | Account Ending 5502 | Statement Period 12/06/25 - 01/05/26",
 *     then "Previous Balance as of 12/06/25 $224.49", "Payments - Thank You - $224.49",
 *     "Other Credits - $9.66", "Purchases + $75.49", "Fees Charged + $0.00",
 *     "Interest Charged + $0.00", "Statement Balance as of 01/05/26 = $65.83".
 *   - Transactions: "Mon DD  Mon DD  DESCRIPTION  MILES  $AMOUNT" in sections
 *     Payments, Other Credits, and "Purchase Activity for <holder> card ending NNNN"
 *     (one per card on the account, an authorised user's too; each purchase keeps
 *     that name and card ending as `spender_name` / `card_ending`, D344). Miles are a number,
 *     negative on a credit, or N/A, and are sometimes glued to the description
 *     ("DENVER CO 225 $45.00"). Amounts count from what you owe ("-$224.49" is a
 *     payment), so they're negated on the way in, like the other card parsers.
 *   - Fees Charged / Interest Charged rows have no miles column.
 *   - An airline ticket wraps its itinerary onto lines with no amount; they're
 *     kept on the row's raw line, not its description.
 *
 * The Samsung Galaxy Card (D277) has the same layout with cash back instead
 * of miles: the column is "Cash Rewards", a dollar amount ("$0.51",
 * "-$0.31" on a credit), and page 1 prints "Cash Rewards Earned This Period"
 * and "Total Cash Rewards Balance", copied onto the statement as printed.
 * Its statement credit ("CASH REWARDS - STMT CRD") is cashback, not a refund.
 * A month with no payment prints "No Payment Received $0.00", and the summary
 * says "Payments" without "Thank You".
 *
 * Never silently drops a line: anything inside a section that isn't a row, a
 * header, a total, or a continuation of the row above fails the parse (D12).
 */

import { parseMoney } from '../pdf-local-helpers.js';

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n) => String(n).padStart(2, '0');
const MONEY = '-?\\$[\\d,]*\\.\\d{2}';

/** "12/06/25 - 01/05/26" -> { period_start, period_end }. */
function extractPeriod(text) {
  const m = text.match(/Statement Period (\d{2})\/(\d{2})\/(\d{2}) - (\d{2})\/(\d{2})\/(\d{2})/);
  if (!m) return null;
  const [, sm, sd, sy, em, ed, ey] = m;
  return { period_start: `20${sy}-${sm}-${sd}`, period_end: `20${ey}-${em}-${ed}`, endYear: 2000 + Number(ey), endMonth: Number(em) };
}

const amountAfter = (text, re) => {
  const m = text.match(re);
  return m ? parseMoney(m[1]) : null;
};

// "Dec 27   Dec 28   DESCRIPTION   38   $12.67" — miles (Frontier) or cash
// rewards in dollars (Samsung, "$0.51"); optional only in fees/interest.
// Miles can run to thousands, printed "1,690" (D314): a flight's miles missed the whole row.
const ROW_WITH_MILES = new RegExp(`^([A-Z][a-z]{2}) (\\d{2})\\s+([A-Z][a-z]{2}) (\\d{2})\\s+(.+?)\\s+(N/A|-?\\d{1,3}(?:,\\d{3})*|${MONEY})\\s+(${MONEY})$`);
const ROW_NO_MILES = new RegExp(`^([A-Z][a-z]{2}) (\\d{2})\\s+([A-Z][a-z]{2}) (\\d{2})\\s+(.+?)\\s+(${MONEY})$`);

const SKIP = [
  /^Transaction Date\s+Posting Date/i,
  /^Total (payments|other credits|purchase activity|balance transfer activity|cash advance activity|fees|interest) for this period/i,
  /^No (fees|interest) charged for this period/i,
  /^No Payment Received\s+\$0\.00$/i,
  /^continued on page \d+$/i,
  /^Visit BarclaysUS\.com/i,
  /^No Transaction Activity at This Time/i,
  /^Fees and Interest$/i,
  /^To see activity after this statement period/i,
  /^(Frontier Airlines|Samsung) .*Statement$/i,
  /Account Ending \d{4}\s+\|\s+Statement Period/i,
  /^®$/,
];

function parseRows(text, { endYear, endMonth, cleanMerchantName }) {
  const rows = [];
  let section = null;
  let last = null;
  let holder = null; // { spender_name, card_ending } of the purchase section we're in

  for (const line of text.split('\n').map((l) => l.trim()).filter(Boolean)) {
    if (/^\d{4} Year-to-Date Totals/i.test(line)) break;
    // Interest is the last section: after its total come rewards details and
    // notices on pages classified as transactions too (Samsung, D277).
    if (/^Total interest for this period/i.test(line)) break;
    if (/^Transactions$/i.test(line)) { section = 'none'; last = null; continue; }
    if (/^Payments$/i.test(line)) { section = 'payments'; last = null; continue; }
    if (/^Other Credits$/i.test(line)) { section = 'credits'; last = null; continue; }
    const purchaseHeader = line.match(/^Purchase Activity for (.+?) card ending (\d{4})/i);
    if (purchaseHeader) {
      // The header and its subtotal line share these words; the subtotal ends in an amount.
      if (!new RegExp(`${MONEY}$`).test(line)) {
        section = 'purchases'; last = null;
        holder = { spender_name: purchaseHeader[1].trim(), card_ending: purchaseHeader[2] };
      }
      continue;
    }
    // A balance transfer or cash advance moves money to you (or to another
    // card) and puts it on this card as new debt, so it's negative here
    // like a purchase, but typed 'transfer': it isn't spending (D191).
    if (/^Balance Transfers$/i.test(line)) { section = 'balance_transfers'; last = null; continue; }
    if (/^Cash Advances$/i.test(line)) { section = 'cash_advances'; last = null; continue; }
    if (/^Fees Charged$/i.test(line)) { section = 'fees'; last = null; continue; }
    if (/^Interest Charged$/i.test(line)) { section = 'interest'; last = null; continue; }
    if (section === null || SKIP.some((p) => p.test(line))) continue;
    if (section === 'none') continue;

    const m = (section === 'fees' || section === 'interest' ? ROW_NO_MILES : ROW_WITH_MILES).exec(line);
    if (!m) {
      if (last) { last.raw_text += ` | ${line}`; continue; }
      throw new Error(`Couldn't parse a ${section} line: "${line}"`);
    }
    const [, , , postMon, postDay, description] = m;
    const amount = m[m.length - 1];
    const month = MONTHS[postMon.toLowerCase()];
    // A January statement carries December rows: those belong to last year.
    const year = month > endMonth ? endYear - 1 : endYear;
    const posted_date = `${year}-${pad(month)}-${postDay}`;
    const amount_cents = -parseMoney(amount) || 0;

    let row;
    if (section === 'payments') {
      row = { txn_type: 'payment', merchant: null, suggested_category: 'Card Payment' };
    } else if (section === 'credits' && /^CASH REWARDS\b/i.test(description)) {
      // Cash rewards redeemed as a statement credit: the card paying you back, not a return.
      row = { txn_type: 'cashback', merchant: null, suggested_category: 'Cashback' };
    } else if (section === 'credits') {
      row = { txn_type: 'refund', merchant: cleanMerchantName(description), suggested_category: null };
    } else if (section === 'balance_transfers' || section === 'cash_advances') {
      row = { txn_type: 'transfer', merchant: null, suggested_category: 'Balance Transfer' };
    } else if (section === 'fees') {
      const btFee = /BALANCE TRANSFER|CASH ADVANCE/i.test(description);
      row = { txn_type: 'fee', merchant: 'Barclays', suggested_category: btFee ? 'Balance Transfer' : null };
    } else if (section === 'interest') {
      row = { txn_type: 'interest', merchant: null, suggested_category: 'Interest' };
    } else {
      row = { txn_type: 'purchase', merchant: cleanMerchantName(description), suggested_category: null, ...holder };
    }
    rows.push({ posted_date, description: description.replace(/\s{2,}/g, ' '), amount_cents, confidence: 'HIGH', raw_text: line, ...row });
    last = rows[rows.length - 1];
  }
  return rows;
}

/**
 * @param pages - all pages ({ pageNumber, text }), stage-1 output
 * @param classifications - stage-2 output (role per page)
 * @param cleanMerchantName - shared local merchant lookup
 * Returns { account, statement, rows, reconciliation } or throws with a specific message.
 */
export function extractBarclaysLocally(pages, classifications, cleanMerchantName) {
  const pageOne = pages[0]?.text ?? '';
  const period = extractPeriod(pageOne);
  if (!period) throw new Error('Could not find the statement period on page 1');

  const header = pageOne.match(/^(.+?)\s+\|\s+Account Ending (\d{4})/m);
  const product = pageOne.match(/^(.+?) Statement$/m)?.[1]?.trim() ?? null;

  const txnPages = classifications.filter((c) => c.role === 'TRANSACTIONS').sort((a, b) => a.pageNumber - b.pageNumber);
  if (txnPages.length === 0) throw new Error('No transactions page found');
  const txnText = txnPages.map((c) => pages.find((p) => p.pageNumber === c.pageNumber).text).join('\n');
  const rows = parseRows(txnText, { ...period, cleanMerchantName });
  if (rows.length === 0) throw new Error('No transaction lines matched on the transactions page');

  const opening = amountAfter(pageOne, new RegExp(`Previous Balance as of [\\d/]+\\s+(${MONEY})`));
  const closing = amountAfter(pageOne, new RegExp(`Statement Balance as of [\\d/]+\\s+=\\s+(${MONEY})`));
  const payments = amountAfter(pageOne, new RegExp(`Payments(?: - Thank You)?\\s+-\\s+(${MONEY})`)) ?? 0;
  const credits = amountAfter(pageOne, new RegExp(`Other Credits\\s+-\\s+(${MONEY})`)) ?? 0;
  const purchases = amountAfter(pageOne, new RegExp(`Purchases\\s+\\+\\s+(${MONEY})`));
  const transfers =
    (amountAfter(pageOne, new RegExp(`Balance Transfers\\s+\\+\\s+(${MONEY})`)) ?? 0) +
    (amountAfter(pageOne, new RegExp(`Cash Advances\\s+\\+\\s+(${MONEY})`)) ?? 0);

  const sum = (types) => rows.filter((r) => types.includes(r.txn_type)).reduce((s, r) => s + r.amount_cents, 0);
  const net = rows.reduce((s, r) => s + r.amount_cents, 0);

  return {
    account: { name: product, issuer: 'Barclays', mask: header?.[2] ?? null, account_type: 'CREDIT_CARD', holder_name: header?.[1]?.trim() ?? null },
    statement: {
      period_start: period.period_start,
      period_end: period.period_end,
      opening_balance_cents: opening,
      closing_balance_cents: closing,
      total_spend_cents: purchases === null ? null : -purchases,
      total_payments_cents: payments + credits,
      // Miles go to Frontier, not cash back; the Samsung card prints its cash rewards.
      cashback_earned_cents: amountAfter(pageOne, new RegExp(`Cash Rewards Earned This Period\\s+(${MONEY})`)),
      cashback_balance_cents: amountAfter(pageOne, new RegExp(`Total Cash Rewards Balance\\s+(${MONEY})`)),
    },
    rows,
    reconciliation: {
      payments_match: payments + credits === sum(['payment', 'refund', 'cashback']),
      purchases_match: purchases === null || -purchases === sum(['purchase']),
      transfers_match: -transfers === sum(['transfer']),
      balances_reconcile: opening === null || closing === null ? null : opening - net === closing,
    },
  };
}
