/**
 * Local (no API call) parser for Apple Card statements (D219), built and
 * verified against this household's own statements
 * (`api/scripts/verify-local-apple.mjs`).
 *
 * The layout, confirmed across every statement on disk:
 *
 *   Previous Total Balance   $158.86        ← opening
 *   Total Balance   $603.31                 ← closing
 *   Total payments for this period   $0.00
 *   Total charges, credits, and returns for this period   $444.45
 *   Total interest for this month   $0.00
 *   Total Daily Cash to account   $14.29    ← cash back, paid to Apple Cash
 *
 *   Payments made by <name>
 *   -$170.78 ACH Deposit Internet transfer from account ending in 0000    01/24/2026
 *   -$30.32 Daily Cash redemption    01/01/2026
 *
 *   Transactions by <name>
 *   05/01/2026   SPI*DUKE-ENERGY 528 S CHURCH ST CHARLOTTE 28202 NC USA   2%   $2.10   $105.15
 *   04/29/2026   SP AUTOPARTS ... CA USA (RETURN)   -$205.54
 *   Daily Cash Adjustment   -2%   $4.11
 *
 * - Co-owners: each person has their own payments and transactions; all
 *   of them are the card's, so all are read.
 * - A payment line prints amount first and date last. A transaction line
 *   prints date first, then "2%  $2.10" (the Daily Cash rate and amount)
 *   and the amount last; a return has no Daily Cash columns.
 * - Signs: Apple prints what the card owes. A charge "$105.15" is money out
 *   here (-10515); a return or payment "-$205.54" is money in (+20554).
 * - A "Daily Cash Adjustment" under a return IS a card charge: Apple
 *   takes back the Daily Cash it paid on the returned purchase by
 *   charging it to the card. Proved on every statement on disk: each
 *   month's "Total charges, credits, and returns" exceeds the sum of its
 *   rows by exactly its adjustment lines (May: $4.11 + $1.14 = $5.25).
 *   The earlier Claude read skipped them, which was every one of the
 *   small Apple gaps. Read as type cashback, negative (Daily Cash given
 *   back), dated with its return.
 * - "ChargePoint 3% Daily Cash", "3% Daily Cash at Nike", "June 2026 Nike
 *   6% Offer" sub-lines are extra Daily Cash paid to Apple Cash, not the
 *   card: not rows (the printed totals confirm it). A "Daily Cash redemption" in
 *   Payments lowers the card balance: cash back applied as a credit.
 * - A long description wraps its last word onto the next line ("INDIND");
 *   only a short line directly under a row is treated as its continuation.
 * - No card number is printed anywhere, so the mask is null: the account
 *   is matched by name.
 */

import { parseMoney } from './pdf-local-helpers.js';

const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
const pad = (n) => String(n).padStart(2, '0');
const MONEY = '-?\\$[\\d,]*\\d\\.\\d{2}';

const PERIOD = /([A-Z][a-z]{2}) (\d{1,2})(?:, (\d{4}))? — ([A-Z][a-z]{2}) (\d{1,2}), (\d{4})/;
const PAYMENT_ROW = new RegExp(`^(${MONEY}) (.+?) (\\d{2})/(\\d{2})/(\\d{4})$`);
const TXN_ROW = new RegExp(`^(\\d{2})/(\\d{2})/(\\d{4}) (.+?)(?: -?\\d+% ${MONEY})? (${MONEY})$`);
const DAILY_CASH_LINE = /Daily Cash|\d+% \$/; // sub-lines about Apple Cash, never card rows
const mdy = (mm, dd, yyyy) => `${yyyy}-${mm}-${dd}`;

function firstAmount(lines, pattern) {
  for (const l of lines) {
    const m = l.match(pattern);
    if (m) return parseMoney(m[1]);
  }
  return null;
}

/** "Name, email" on the line after "Apple Card Customer" / "Apple Card Co-Owners". */
function extractHolder(lines) {
  const i = lines.findIndex((l) => /^Apple Card (Customer|Co-Owners)$/.test(l));
  const m = i >= 0 ? (lines[i + 1] ?? '').match(/^([^,@]+),/) : null;
  return m ? m[1].trim() : null;
}

/**
 * @param pages - all pages ({ pageNumber, text })
 * @param classifications - unused: Apple's own section headers bound the rows
 * @param cleanMerchantName - shared local merchant lookup
 * Returns { account, statement, rows, reconciliation } or throws with a specific message.
 */
export function extractAppleLocally(pages, classifications, cleanMerchantName) {
  const lines = pages.flatMap((p) => (p.text ?? '').split('\n')).map((l) => l.trim().replace(/\s+/g, ' ')).filter(Boolean);

  const pm = lines.join('\n').match(PERIOD);
  if (!pm) throw new Error('Could not find the statement period');
  const [, m1, d1, y1, m2, d2, y2] = pm;
  const startYear = y1 ?? (MONTHS[m1] > MONTHS[m2] ? Number(y2) - 1 : y2);
  const period = { period_start: `${startYear}-${pad(MONTHS[m1])}-${pad(d1)}`, period_end: `${y2}-${pad(MONTHS[m2])}-${pad(d2)}` };

  const opening = firstAmount(lines, new RegExp(`^Previous Total Balance (${MONEY})$`));
  const closing = firstAmount(lines, new RegExp(`^Total Balance (${MONEY})$`));
  const totalPayments = firstAmount(lines, new RegExp(`^Total payments for this period (${MONEY})$`));
  const totalCharges = firstAmount(lines, new RegExp(`^Total charges, credits, and returns for this period (${MONEY})$`));
  const totalInterest = firstAmount(lines, new RegExp(`^Total interest for this month (${MONEY})$`));
  const dailyCash = firstAmount(lines, new RegExp(`^Total Daily Cash to account (${MONEY})$`));

  const rows = [];
  let section = null; // 'payments' | 'charges'
  let lastWasRow = false;
  for (const line of lines) {
    if (/^Payments made by /.test(line)) { section = 'payments'; lastWasRow = false; continue; }
    if (/^Transactions by /.test(line)) { section = 'charges'; lastWasRow = false; continue; }
    if (/^Total payments for this period|^Total charges, credits and returns /.test(line)) { section = null; lastWasRow = false; continue; }
    if (!section) continue;

    if (section === 'payments') {
      const m = line.match(PAYMENT_ROW);
      if (!m) { lastWasRow = false; continue; }
      const [, amountText, description, mm, dd, yyyy] = m;
      const amount_cents = -parseMoney(amountText);
      const redemption = /Daily Cash redemption/i.test(description);
      rows.push({
        posted_date: mdy(mm, dd, yyyy), description, merchant: null, amount_cents,
        txn_type: redemption ? 'cashback' : 'payment',
        suggested_category: redemption ? 'Cashback' : 'Card Payment',
        confidence: 'HIGH', raw_text: line, kind: 'payment',
      });
      lastWasRow = true;
      continue;
    }

    const m = line.match(TXN_ROW);
    if (m) {
      const [, mm, dd, yyyy, description, amountText] = m;
      const amount_cents = -parseMoney(amountText);
      rows.push({
        posted_date: mdy(mm, dd, yyyy), description, merchant: cleanMerchantName(description), amount_cents,
        txn_type: amount_cents < 0 ? 'purchase' : 'refund',
        suggested_category: null, confidence: 'HIGH', raw_text: line, kind: 'charge',
      });
      lastWasRow = true;
      continue;
    }
    // Daily Cash taken back on a return: a charge on the card, dated with the return.
    // "Promo Daily Cash Adjustment" too: the same clawback on promo Daily Cash (July 2026: $0.27).
    const adj = line.match(new RegExp(`^(?:Promo )?Daily Cash Adjustment -?\\d+% (${MONEY})$`));
    if (adj && rows.length > 0) {
      const ret = rows.at(-1);
      rows.push({
        posted_date: ret.posted_date, description: `Daily Cash Adjustment · ${ret.description}`.slice(0, 120), merchant: null,
        amount_cents: -Math.abs(parseMoney(adj[1])), txn_type: 'cashback', suggested_category: 'Cashback',
        confidence: 'HIGH', raw_text: line, kind: 'charge',
      });
      lastWasRow = false;
      continue;
    }
    // A wrapped last word ("INDIND"): short, no money, no Daily Cash note, right under its row.
    if (lastWasRow && !DAILY_CASH_LINE.test(line) && !/\$/.test(line) && line.length <= 24 && !/^(Date|Page|Statement|Apple Card)/.test(line)) {
      const last = rows.at(-1);
      last.description = `${last.description} ${line}`;
      last.raw_text = `${last.raw_text}\n${line}`;
      last.merchant = cleanMerchantName(last.description);
    }
    lastWasRow = false;
  }
  if (rows.length === 0 && totalCharges !== 0 && totalPayments !== 0) throw new Error('No transaction lines matched');

  // Interest isn't itemised in the activity; when a month has some, it becomes its own row.
  if (totalInterest) {
    rows.push({
      posted_date: period.period_end, description: 'Interest charged', merchant: null, amount_cents: -totalInterest,
      txn_type: 'interest', suggested_category: 'Interest', confidence: 'HIGH', raw_text: `Total interest for this month ${totalInterest}`, kind: 'interest',
    });
  }

  const sum = (kind) => rows.filter((r) => r.kind === kind).reduce((s, r) => s + r.amount_cents, 0);
  const net = rows.reduce((s, r) => s + r.amount_cents, 0);

  return {
    account: { name: 'Apple Card', issuer: 'Goldman Sachs Bank USA', mask: null, account_type: 'CREDIT_CARD', holder_name: extractHolder(lines) },
    statement: {
      period_start: period.period_start,
      period_end: period.period_end,
      opening_balance_cents: opening,
      closing_balance_cents: closing,
      total_spend_cents: totalCharges === null ? null : -totalCharges,
      total_payments_cents: totalPayments === null ? null : -totalPayments,
      cashback_earned_cents: dailyCash,
      cashback_balance_cents: null,
    },
    rows: rows.map(({ kind, ...r }) => r),
    reconciliation: {
      payments_match: totalPayments === null ? null : -sum('payment') === totalPayments,
      charges_match: totalCharges === null ? null : -sum('charge') === totalCharges,
      balances_reconcile: opening === null || closing === null ? null : opening - net === closing,
    },
  };
}
