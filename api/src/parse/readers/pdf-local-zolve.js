/**
 * Local (no API call) parser for Zolve credit card statements (D221),
 * verified against this household's own statements
 * (`api/scripts/verify/verify-local-zolve.mjs`).
 *
 * Zolve changed issuer processors in mid-2026, and with it the card
 * numbers and the statement layout. Both are read:
 *
 * Layout A (from July 2026), "Monthly Credit Card Statement":
 *   July 18, 2026 - August 17, 2026  MasterCard ending in ••• 5509
 *   Previous Balance   $299.99 … - Payments $299.99 · - Other Credits $99.99
 *   + Purchases $107.74 · + Cash Advance · + Interest Charged · + Fees Charged
 *   New Balance     7.75
 *   PAYMENTS & OTHER CREDITS / TRANSACTIONS / FEES CHARGED / INTEREST CHARGED
 *   07/30/2026   [GP] BILL PAYMENT   $299.99
 *
 * Layout B (to June 2026), "Credit Card Statement":
 *   NAME   - Card Ending in - * 5118
 *   Bill Period: 03/15/2026   - 04/14/2026
 *   Previous Balance $307.39 · Payments · Other Credits · Purchases ·
 *   Cash Advance · Interest Charged · Fee Charged · New Balance $1,439.39
 *   Payments and Other Credits / Purchases and Cash Advances / Fees Charged / Interest Charged
 *   (some months print one "Fees and Interest Charged" section instead:
 *   03/26/2026   03/26/2026   Annual Fee   $95.00)
 *   A credit balance prints in brackets: "New Balance   ($200.00)".
 *   Posted Date   Transaction Date   Description   Amount(USD)
 *   03/15/2026   03/14/2026   Cosmetics Co Midvale Midvale TXUSA   $22.80
 *   A long description is split around its date line: the first part on
 *   the line above, the rest on the line below:
 *     SPI*DUKE-ENERGY
 *     03/18/2026   03/16/2026   $140.47
 *     CHARLOTTE NCUSA
 *
 * Every amount prints positive; the section says which way it went:
 * credits are money in, transactions, fees and interest money out.
 * Every statement is checked against its own summary: credits, charges,
 * fees, interest, and opening − rows = closing.
 */

import { parseMoney } from '../pdf-local-helpers.js';

const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
const pad = (n) => String(n).padStart(2, '0');
const MONEY = '\\$?\\s?[\\d,]*\\d\\.\\d{2}';
const DATE = '(\\d{2})/(\\d{2})/(\\d{4})';

const SECTIONS = [
  [/^(PAYMENTS & OTHER CREDITS|Payments and Other Credits)$/, 'credits'],
  [/^(TRANSACTIONS|Purchases and Cash Advances)$/, 'charges'],
  [/^(FEES CHARGED|Fees Charged)$/, 'fees'],
  [/^(INTEREST CHARGED|Interest Charged)$/, 'interest'],
  [/^Fees and Interest Charged$/, 'fees_interest'], // split per row: interest by its description, the rest fees
];
const SECTION_END = /^(Sub Total:?|Total fees for this period|No transaction available|INTEREST CHARGE CALCULATION|Duration\b|\d{4} Totals Year-to-date|TOTALS YEAR-TO-DATE)/i;
const NOT_DESCRIPTION = /^(Transaction Date|Posted Date|Page:|Account Activity|Bill Period|Monthly Credit Card Statement|Credit Card Statement|Zolve Credit Cards are issued)|Card Ending in|ending in •/i;

const money = (s) => parseMoney(s.replace(/\s/g, ''));

/** The first amount after a summary label, with or without "$" ("New Balance     7.75"); bracketed is negative ("($200.00)"). */
function summary(text, label) {
  const m = text.match(new RegExp(`(?:^|\\s|[-+] )${label}\\s+(\\(?)(${MONEY})(?!\\d)`, 'm'));
  return m ? (m[1] ? -money(m[2]) : money(m[2])) : null;
}

// A fee's category: the annual fee has its own; any other (a late fee) is a bank fee (D342).
const feeCategory = (description) => (/ANNUAL FEE/i.test(description) ? 'Annual Fee' : 'Bank Fees');

/**
 * Zolve prints a return three times (D337): a "Pending Credit" (+), a "Reversal Transaction" of it
 * among the charges (−), and the "Purchase Returns" (+). The first two cancel, so the reversal is a
 * refund taken back: filed as Refund, it nets the pending credit to zero there instead of counting
 * as a purchase. A fee it waives comes back as "Reversal Transaction [Fee - …]": a fee, not a
 * payment, though its line has the word in it.
 */
export function classify(section, description) {
  const reversal = /^Reversal Transaction/i.test(description);
  if (section === 'credits') {
    if (reversal && /\[\s*Fee\b/i.test(description)) return { txn_type: 'fee', category: feeCategory(description) };
    if (/PAYMENT/i.test(description) && !/LATE PAYMENT/i.test(description)) return { txn_type: 'payment', category: 'Card Payment' };
    if (/ANNUAL FEE/i.test(description)) return { txn_type: 'refund', category: 'Annual Fee' };
    // A credit that isn't a payment is money back from a merchant: "Refund", as the household files
    // the other cards' returns; it was left blank, so every Zolve return showed uncategorised.
    return { txn_type: 'refund', category: 'Refund' };
  }
  if (section === 'fees') return { txn_type: 'fee', category: feeCategory(description) };
  if (section === 'interest') return { txn_type: 'interest', category: 'Interest' };
  if (reversal) return { txn_type: 'refund', category: 'Refund' };
  return { txn_type: 'purchase', category: null };
}

/**
 * @param pages - all pages ({ pageNumber, text })
 * @param classifications - unused: Zolve's section headers bound the rows
 * @param cleanMerchantName - shared local merchant lookup
 * Returns { account, statement, rows, reconciliation } or throws with a specific message.
 */
export function extractZolveLocally(pages, classifications, cleanMerchantName) {
  // Layout A's font has no glyph for "$" in a few places, so pdf.js emits
  // NUL there ("New Balance   \u0000 400.00"); it stands for the dollar sign.
  const lines = pages.flatMap((p) => (p.text ?? '').split('\n')).map((l) => l.replaceAll('\u0000', '$').trim().replace(/\s+/g, ' ')).filter(Boolean);
  const text = lines.join('\n');
  const layoutB = /Bill Period:/.test(text);

  let period;
  if (layoutB) {
    const m = text.match(new RegExp(`Bill Period: ${DATE} - ${DATE}`));
    if (!m) throw new Error('Could not find the Bill Period');
    period = { period_start: `${m[3]}-${m[1]}-${m[2]}`, period_end: `${m[6]}-${m[4]}-${m[5]}` };
  } else {
    const m = text.match(/([A-Z][a-z]+) (\d{1,2}), (\d{4}) - ([A-Z][a-z]+) (\d{1,2}), (\d{4})/);
    if (!m) throw new Error('Could not find the statement period');
    period = { period_start: `${m[3]}-${pad(MONTHS[m[1].toLowerCase()])}-${pad(m[2])}`, period_end: `${m[6]}-${pad(MONTHS[m[4].toLowerCase()])}-${pad(m[5])}` };
  }
  const mask = text.match(/(?:ending in [•*\s]*|Ending in -?\s?\*\s?)(\d{4})/i)?.[1] ?? null;
  const holder = (layoutB ? lines[0].match(/^([A-Z][A-Z .'-]+?)\s+-?\s*Card Ending/)?.[1] : lines[0].match(/^([A-Z][A-Z .'-]+)$/)?.[1]) ?? null;

  const opening = summary(text, 'Previous Balance');
  const closing = summary(text, 'New Balance');
  const totals = {
    payments: summary(text, 'Payments'),
    otherCredits: summary(text, 'Other Credits'),
    purchases: summary(text, 'Purchases'),
    cashAdvance: summary(text, 'Cash Advance'),
    interest: summary(text, 'Interest Charged'),
    fees: summary(text, layoutB ? 'Fee Charged' : 'Fees Charged'),
  };

  const rows = [];
  let section = null;
  let prefix = null; // layout B: the first part of a split description, seen above its date line
  let awaitingSuffix = null; // layout B: a row whose description continues on the next line
  const rowRe = layoutB ? new RegExp(`^${DATE} ${DATE}(?: (.+?))? (${MONEY})$`) : new RegExp(`^${DATE} (.+?) (${MONEY})$`);

  for (const line of lines) {
    const header = SECTIONS.find(([re]) => re.test(line));
    if (header) { section = header[1]; prefix = null; awaitingSuffix = null; continue; }
    if (!section) continue;
    if (SECTION_END.test(line)) { section = null; prefix = null; awaitingSuffix = null; continue; }

    const m = line.match(rowRe);
    if (m) {
      // Layout B: posted date first, transaction date second; the posted date is the one on the account.
      const [, mm, dd, yyyy] = m;
      const inline = layoutB ? m[7] : m[4];
      const amountText = layoutB ? m[8] : m[5];
      const amount = money(amountText);
      const description = inline ?? prefix ?? '';
      const row = {
        posted_date: `${yyyy}-${mm}-${dd}`,
        description,
        amount_cents: section === 'credits' ? amount : -amount,
        section: section === 'fees_interest' ? (/INTEREST/i.test(description) ? 'interest' : 'fees') : section,
        raw_text: [!inline && prefix ? prefix : null, line].filter(Boolean).join('\n'),
      };
      rows.push(row);
      awaitingSuffix = layoutB && !inline ? row : null;
      prefix = null;
      continue;
    }
    if (NOT_DESCRIPTION.test(line) || /\$/.test(line)) continue;
    if (awaitingSuffix) {
      awaitingSuffix.description = `${awaitingSuffix.description} ${line}`.trim();
      awaitingSuffix.raw_text += `\n${line}`;
      awaitingSuffix = null;
    } else if (layoutB) {
      prefix = prefix ? `${prefix} ${line}` : line;
    }
  }

  const out = rows.map((r) => {
    const { txn_type, category } = classify(r.section, r.description);
    return {
      posted_date: r.posted_date,
      description: r.description,
      merchant: r.section === 'charges' ? cleanMerchantName(r.description) : null,
      amount_cents: r.amount_cents,
      txn_type,
      suggested_category: category,
      confidence: r.description ? 'HIGH' : 'LOW',
      raw_text: r.raw_text,
    };
  });

  const sumOf = (section) => rows.filter((r) => r.section === section).reduce((s, r) => s + Math.abs(r.amount_cents), 0);
  const net = rows.reduce((s, r) => s + r.amount_cents, 0);
  const eq = (a, b) => (b === null ? null : a === b);

  return {
    account: { name: 'Zolve Credit Card', issuer: 'Zolve', mask, account_type: 'CREDIT_CARD', holder_name: holder },
    statement: {
      period_start: period.period_start,
      period_end: period.period_end,
      opening_balance_cents: opening,
      closing_balance_cents: closing,
      total_spend_cents: totals.purchases === null ? null : -totals.purchases,
      total_payments_cents: totals.payments === null ? null : totals.payments + (totals.otherCredits ?? 0),
      cashback_earned_cents: null,
      cashback_balance_cents: null,
    },
    rows: out,
    reconciliation: {
      credits_match: totals.payments === null ? null : sumOf('credits') === totals.payments + (totals.otherCredits ?? 0),
      charges_match: totals.purchases === null ? null : sumOf('charges') === totals.purchases + (totals.cashAdvance ?? 0),
      fees_match: eq(sumOf('fees'), totals.fees),
      interest_match: eq(sumOf('interest'), totals.interest),
      balances_reconcile: opening === null || closing === null ? null : opening - net === closing,
    },
  };
}
