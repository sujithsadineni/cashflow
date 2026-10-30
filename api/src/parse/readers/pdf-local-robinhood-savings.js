/**
 * Local (no API call) parser for Robinhood Banking savings statements
 * ("Personal Savings", Coastal Community Bank). Built against this
 * household's own statements, Jun–Sep 2026, which Claude had read before.
 *
 * Layout, confirmed against real text:
 *   - Page 1 is a cover: "Personal Savings 5117", "Statement", "September, 2026".
 *   - Every later page repeats "Personal Savings 5117", "Statement Period",
 *     "Sep 1 - Sep 30, 2026".
 *   - Summary: "Beginning Balance (Sep 1, 2026) $31,262.62" …
 *     "Total Ending Balance (Sep 30, 2026) $55,199.60".
 *   - Activity: "DATE DESCRIPTION CATEGORY AMOUNT BALANCE", then rows
 *     "9/24/26 CYBRID-CROBO.MON a1b2c3d4 Debit -$1,200.00 $25,000.00".
 *     A credit prints its balance BEFORE its amount ("$51,262.62 +$20,000.00"),
 *     a debit after; the signed one is the amount.
 *   - A long description wraps onto lines above and below its row, which
 *     is then printed with no description of its own:
 *       "Inter-Entity Transfer from Robinhood" / "6/25/26 Credit $70.00 +$70.00" / "Investing".
 *
 * Every row's printed balance is checked against the running balance, and
 * opening + rows against the closing balance. A line inside the activity
 * that isn't a row, a header or part of a description fails the parse.
 */

import { classifyCheckingOutflow } from '../pdf-local-helpers.js';

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const MONEY = /[+-]?\$[\d,]+\.\d{2}/g;
const cents = (text) => {
  const negative = text.startsWith('-');
  const n = Math.round(Number(text.replace(/[^\d.]/g, '')) * 100);
  return negative ? -n : n;
};
const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Is this a Robinhood Banking savings statement (not the Gold Card)? */
export function isRobinhoodSavings(pageOneText) {
  return /Robinhood Banking/i.test(pageOneText) && /Savings\s+\d{4}/i.test(pageOneText);
}

/** "Sep 1 - Sep 30, 2026" (or across a year end, "Dec 1, 2026 - Jan 1, 2027"). */
function extractPeriod(text) {
  const m = text.match(/([A-Z][a-z]{2})\s+(\d{1,2})(?:,\s*(\d{4}))?\s*-\s*([A-Z][a-z]{2})\s+(\d{1,2}),\s*(\d{4})/);
  if (!m || !MONTHS[m[1].toLowerCase()] || !MONTHS[m[4].toLowerCase()]) return null;
  const endYear = Number(m[6]);
  const startYear = m[3] ? Number(m[3]) : MONTHS[m[1].toLowerCase()] > MONTHS[m[4].toLowerCase()] ? endYear - 1 : endYear;
  return {
    period_start: iso(startYear, MONTHS[m[1].toLowerCase()], Number(m[2])),
    period_end: iso(endYear, MONTHS[m[4].toLowerCase()], Number(m[5])),
  };
}

const amountAfter = (text, label) => {
  const m = text.match(new RegExp(`${label}\\s*\\([^)]*\\)\\s+(-?\\$[\\d,]+\\.\\d{2})`, 'i'));
  return m ? cents(m[1]) : null;
};

/** The holder: the line after the statement period on the summary page, before the street address. */
function extractHolder(lines) {
  const i = lines.findIndex((l) => /^[A-Z][a-z]{2}\s+\d{1,2}.*-\s*[A-Z][a-z]{2}\s+\d{1,2},\s*\d{4}$/.test(l));
  const next = lines[i + 1];
  return i >= 0 && next && !/\d/.test(next) && !/Account|Balance|Activity/i.test(next) ? next : null;
}

/** Money between your own accounts, interest, or what the shared checking rules say for money out. */
export function classifySavings(description, amount_cents) {
  if (/^Interest Payment/i.test(description)) return { txn_type: 'interest', category: 'Interest' };
  if (amount_cents >= 0) {
    // Into savings is money moving between your own accounts: from a bank
    // ("ACH Deposit from Chase"), a card's balance-transfer deposit ("ACHBT"),
    // or Robinhood's own investing account. Anything else is a deposit.
    if (/ACH Deposit|ACHBT|Inter-Entity Transfer|Transfer from/i.test(description)) return { txn_type: 'transfer', category: null };
    return { txn_type: 'deposit', category: null };
  }
  return classifyCheckingOutflow(description);
}

const ROW = /^(\d{1,2})\/(\d{1,2})\/(\d{2})\s+(.*?)\s*\b(Credit|Debit)\s+(.*)$/;
const SKIP = [
  /^Personal Savings\s+\d{4}$/i,
  /^Statement Period$/i,
  /^[A-Z][a-z]{2}\s+\d{1,2}.*-\s*[A-Z][a-z]{2}\s+\d{1,2},\s*\d{4}$/,
  /^Account Activity$/i,
  /^DATE\s+DESCRIPTION\s+CATEGORY\s+AMOUNT\s+BALANCE$/i,
  /Robinhood Banking services provided by/i,
];

export function extractRobinhoodSavingsLocally(pages, _classifications, cleanMerchantName) {
  const all = pages.map((p) => p.text).join('\n');
  const lines = all.split('\n').map((l) => l.trim().replace(/\s+/g, ' ')).filter(Boolean);

  const mask = all.match(/Savings\s+(\d{4})\b/i)?.[1] ?? null;
  const period = extractPeriod(all);
  if (!mask) throw new Error('Could not find the account number ("Personal Savings 1234")');
  if (!period) throw new Error('Could not find the Statement Period');

  const flat = lines.join('\n');
  const opening_balance_cents = amountAfter(flat, 'Beginning Balance');
  const closing_balance_cents = amountAfter(flat, 'Total Ending Balance');

  const start = lines.findIndex((l) => /^DATE\s+DESCRIPTION\s+CATEGORY\s+AMOUNT\s+BALANCE$/i.test(l));
  if (start < 0) throw new Error('No Account Activity section found');

  const rows = [];
  let pending = []; // description lines waiting for their row
  let ended = false;
  for (const line of lines.slice(start + 1)) {
    if (SKIP.some((re) => re.test(line))) continue;
    if (/^\d{1,2}\/\d{1,2}\/\d{2}\s+Beginning Balance\b/i.test(line)) continue;
    if (/^\d{1,2}\/\d{1,2}\/\d{2}\s+Ending Balance\b/i.test(line)) { ended = true; break; }
    const m = line.match(ROW);
    if (!m) { pending.push(line); continue; }
    const [, mo, d, yy, desc, category, rest] = m;
    const money = rest.match(MONEY) ?? [];
    const amountText = money.find((t) => /^[+-]/.test(t));
    const balanceText = money.find((t) => t !== amountText);
    if (!amountText || !balanceText) throw new Error(`Couldn't find the amount and balance in: "${line}"`);
    let description = desc.trim();
    if (!description) { description = pending.join(' '); pending = []; }
    else if (pending.length) {
      // Lines between two rows that have their own descriptions finish the row above.
      if (!rows.length) throw new Error(`A line this reader doesn't recognise: "${pending[0]}"`);
      rows.at(-1).description = `${rows.at(-1).description} ${pending.join(' ')}`;
      rows.at(-1).raw_text = `${rows.at(-1).raw_text} | ${pending.join(' | ')}`;
      pending = [];
    }
    if (!description) throw new Error(`A row with no description: "${line}"`);
    const amount_cents = cents(amountText);
    if ((category === 'Debit') !== (amount_cents < 0)) throw new Error(`"${category}" doesn't match the amount's sign in: "${line}"`);
    rows.push({
      posted_date: iso(2000 + Number(yy), Number(mo), Number(d)),
      description,
      amount_cents,
      balance_after_cents: cents(balanceText),
      raw_text: line,
    });
  }
  if (!ended) throw new Error('The Account Activity never reached its Ending Balance line');
  if (pending.length) {
    if (!rows.length) throw new Error(`A line this reader doesn't recognise: "${pending[0]}"`);
    rows.at(-1).description = `${rows.at(-1).description} ${pending.join(' ')}`;
  }

  // Per-row check: each printed balance is the previous one plus this row.
  let running = opening_balance_cents;
  const badRows = [];
  for (const r of rows) {
    if (running !== null) running += r.amount_cents;
    if (running !== r.balance_after_cents) badRows.push(r.raw_text);
    running = r.balance_after_cents;
  }
  const net = rows.reduce((s, r) => s + r.amount_cents, 0);

  return {
    account: {
      name: 'Robinhood Savings',
      issuer: 'Robinhood',
      mask,
      account_type: 'SAVINGS',
      holder_name: extractHolder(lines),
    },
    statement: {
      ...period,
      opening_balance_cents,
      closing_balance_cents,
      total_spend_cents: rows.filter((r) => r.amount_cents < 0).reduce((s, r) => s + r.amount_cents, 0),
      total_payments_cents: rows.filter((r) => r.amount_cents > 0 && !/^Interest Payment/i.test(r.description)).reduce((s, r) => s + r.amount_cents, 0),
      cashback_earned_cents: null,
      cashback_balance_cents: null,
    },
    rows: rows.map(({ balance_after_cents, ...r }) => {
      const { txn_type, category } = classifySavings(r.description, r.amount_cents);
      return { ...r, merchant: cleanMerchantName(r.description), txn_type, suggested_category: category, confidence: 'HIGH' };
    }),
    reconciliation: {
      balances_reconcile: opening_balance_cents === null || closing_balance_cents === null ? null : opening_balance_cents + net === closing_balance_cents,
      running_balance_ok: badRows.length === 0,
      ...(badRows.length ? { running_balance_breaks: badRows.slice(0, 3) } : {}),
    },
  };
}
