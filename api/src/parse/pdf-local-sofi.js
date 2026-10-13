/**
 * Local (no API call) parser for SoFi Checking & Savings statements
 * (D216), built and verified against this household's own statements
 * (`api/scripts/verify-local-sofi.mjs`).
 *
 * The layout, confirmed across every statement on disk:
 *
 *   Primary Account Holder Address Account Number
 *   Alex Morgan 1 Main St 411061810000
 *   Member since Mar 24, 2026 Monthly Statement Period
 *   Anytown, GA 30000 Aug 1, 2026 - Aug 31, 2026
 *    Checking Account - 0000
 *    Current Balance  Monthly Interest Paid  Annual Percentage Yield Earned
 *    $11,502.91  $4.90  0.50%
 *    Beginning Balance  Year-to-date Interest Paid
 *    $14,653.20  $17.18
 *    DATE   TYPE   DESCRIPTION   AMOUNT   BALANCE
 *    Aug 31, 2026   Direct Payment   BILT CARD HOUSING -$2,101.50   $11,748.01
 *   Transaction ID: 164-49185001
 *
 * - One PDF holds every account the member has (Checking, then
 *   Savings), each with its own summary and transaction list. Only the
 *   Checking section is read: one statement maps to one account in this
 *   app. Rows in any other section are never dropped silently; they are
 *   counted in the reconciliation so the review screen can say so.
 * - Columns are separated by runs of 2+ spaces; the description and its
 *   amount are separated by a single space, so the amount is the last
 *   money token of the third column.
 * - Amounts are printed in this app's own sign convention (money out
 *   "-$250.00", money in "$4.90"). The SoFi TYPE says how, not which way:
 *   an incoming Zelle is a "Direct Payment" with a positive amount.
 * - Every row prints the balance after it, newest first. That gives a
 *   per-row check stronger than opening + rows = closing: walking the
 *   list oldest-first, each balance must equal the one before plus the
 *   row's amount.
 */

import { parseMoney, classifyCheckingInflow, classifyCheckingOutflow } from './pdf-local-helpers.js';

const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
const pad = (n) => String(n).padStart(2, '0');
const isoDate = (mon, day, year) => (MONTHS[mon] ? `${year}-${pad(MONTHS[mon])}-${pad(day)}` : null);

const MONEY = /-?\$[\d,]*\d\.\d{2}/g; // every amount on a line (match only, never .test)
const ONE_MONEY = /-?\$[\d,]*\d\.\d{2}/;
const SECTION = /^(Checking|Savings) Account - (\d{4})$/;
const ROW_START = /^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})\s{2,}/;
const PERIOD = /([A-Z][a-z]{2}) (\d{1,2}), (\d{4}) - ([A-Z][a-z]{2}) (\d{1,2}), (\d{4})/;

/** Every SoFi row type seen on a real statement; anything else stops the read instead of guessing. */
const KNOWN_TYPES = new Set(['Direct Payment', 'Direct Deposit', 'Deposit', 'Withdrawal', 'Bonus', 'Interest Earned', 'Debit Card', 'Check Deposit', 'Other']);

// Money moved to or from another bank the household uses: SoFi prints the
// other bank's legal name ("BANK OF AMERICA, N.A.") on a plain Deposit or
// Withdrawal. Account-verification micro-deposits are left to the app's own
// verification rule (verification.js), which runs on every import.
const OTHER_BANK = /\b(N\.A\.|BANK|CREDIT UNION)\b/i;
const VERIFY = /ACCTVERIFY|ACCT VERIFY|VERIFY/i;
const REWARD = /REWARD|BONUS/i;

/** What a row is, from SoFi's TYPE, the description and the sign. */
export function classifySofi(type, description, amount_cents) {
  if (type === 'Interest Earned') return { txn_type: 'interest', category: 'Interest' };
  if (type === 'Bonus' || (type === 'Other' && REWARD.test(description))) return { txn_type: 'cashback', category: 'Cashback' };
  if (type === 'Debit Card') return amount_cents < 0 ? { txn_type: 'purchase', category: null } : { txn_type: 'refund', category: null };
  if (type === 'Check Deposit') return { txn_type: 'deposit', category: null };
  if ((type === 'Withdrawal' || type === 'Deposit') && OTHER_BANK.test(description) && !VERIFY.test(description)) {
    return { txn_type: 'transfer', category: null };
  }
  return amount_cents >= 0 ? classifyCheckingInflow(description) : classifyCheckingOutflow(description);
}

/** The holder's name: the start of the line under "Primary Account Holder", before the address number. */
function extractHolder(lines) {
  const i = lines.findIndex((l) => /^Primary Account Holder/i.test(l));
  if (i < 0 || !lines[i + 1]) return null;
  const m = lines[i + 1].match(/^([A-Za-z][A-Za-z.'-]*(?: [A-Za-z][A-Za-z.'-]*){0,4}?) \d/);
  return m ? m[1] : null;
}

/** The first money amount on the line after `label` (SoFi prints labels and figures on separate lines). */
function amountAfter(lines, from, label) {
  for (let i = from; i < lines.length; i++) {
    if (SECTION.test(lines[i]) && i > from) return null; // ran into the next account
    if (lines[i].startsWith(label)) {
      const m = (lines[i + 1] ?? '').match(ONE_MONEY);
      return m ? parseMoney(m[0]) : null;
    }
  }
  return null;
}

/**
 * @param pages - all pages ({ pageNumber, text })
 * @param classifications - unused: SoFi's section headers bound the rows exactly
 * @param cleanMerchantName - shared local merchant lookup
 * Returns { account, statement, rows, reconciliation } or throws with a specific message.
 */
export function extractSofiLocally(pages, classifications, cleanMerchantName) {
  const lines = pages.flatMap((p) => (p.text ?? '').split('\n')).map((l) => l.trim()).filter(Boolean);
  const periodMatch = lines.join('\n').match(PERIOD);
  if (!periodMatch) throw new Error('Could not find the statement period on page 1');
  const [, m1, d1, y1, m2, d2, y2] = periodMatch;
  const period = { period_start: isoDate(m1, d1, y1), period_end: isoDate(m2, d2, y2) };

  // Walk the lines, keeping track of which account's section we're in.
  const sections = new Map(); // "Checking - 5506" -> { kind, mask, summaryAt, rows }
  let current = null;
  lines.forEach((line, i) => {
    const s = line.match(SECTION);
    if (s) {
      const key = `${s[1]} - ${s[2]}`;
      if (!sections.has(key)) sections.set(key, { kind: s[1], mask: s[2], summaryAt: i, rows: [] });
      current = sections.get(key);
      return;
    }
    if (!current || !ROW_START.test(line)) return;
    const cols = line.split(/\s{2,}/);
    if (cols.length < 4) throw new Error(`Couldn't read a transaction line: "${line}"`);
    const [dateCol, type, ...rest] = cols;
    const balanceCol = rest.pop();
    const descAndAmount = rest.join(' ');
    const amounts = descAndAmount.match(MONEY);
    const balanceMatch = balanceCol.match(ONE_MONEY);
    if (!amounts || !balanceMatch) throw new Error(`Couldn't find the amount and balance in: "${line}"`);
    if (!KNOWN_TYPES.has(type)) throw new Error(`A SoFi transaction type this reader doesn't know yet: "${type}" in "${line}"`);
    const amountText = amounts.at(-1);
    const description = descAndAmount.slice(0, descAndAmount.lastIndexOf(amountText)).trim();
    const [, mon, day, year] = dateCol.match(/^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})/);
    const amount_cents = parseMoney(amountText);
    const { txn_type, category } = classifySofi(type, description, amount_cents);
    current.rows.push({
      posted_date: isoDate(mon, day, year),
      description,
      merchant: cleanMerchantName(description),
      amount_cents,
      txn_type,
      suggested_category: category,
      confidence: 'HIGH',
      raw_text: line,
      balance_after_cents: parseMoney(balanceMatch[0]),
      sofi_type: type,
    });
  });

  const checking = [...sections.values()].find((s) => s.kind === 'Checking');
  if (!checking) throw new Error('No Checking Account section found');
  const opening_balance_cents = amountAfter(lines, checking.summaryAt, 'Beginning Balance');
  const closing_balance_cents = amountAfter(lines, checking.summaryAt, 'Current Balance');

  // Oldest first, as the account actually moved; SoFi prints newest first.
  const rows = [...checking.rows].reverse();

  // Per-row check: each printed balance is the previous one plus this row.
  let running = opening_balance_cents;
  const badRows = [];
  for (const r of rows) {
    if (running !== null) running += r.amount_cents;
    if (running !== r.balance_after_cents) badRows.push(r.raw_text);
    running = r.balance_after_cents;
  }
  const net = rows.reduce((sum, r) => sum + r.amount_cents, 0);
  const otherAccountRows = [...sections.values()].filter((s) => s !== checking).reduce((n, s) => n + s.rows.length, 0);

  return {
    account: {
      name: null,
      issuer: 'SoFi',
      mask: checking.mask,
      account_type: 'CHECKING',
      holder_name: extractHolder(lines),
    },
    statement: {
      period_start: period.period_start,
      period_end: period.period_end,
      opening_balance_cents,
      closing_balance_cents,
      total_spend_cents: null,
      total_payments_cents: null,
      cashback_earned_cents: null,
      cashback_balance_cents: null,
    },
    rows: rows.map(({ balance_after_cents, sofi_type, ...r }) => r),
    reconciliation: {
      balances_reconcile: opening_balance_cents === null || closing_balance_cents === null ? null : opening_balance_cents + net === closing_balance_cents,
      running_balance_ok: badRows.length === 0,
      ...(badRows.length ? { running_balance_breaks: badRows.slice(0, 3) } : {}),
      ...(otherAccountRows ? { other_account_rows_not_read: otherAccountRows } : {}),
    },
  };
}
