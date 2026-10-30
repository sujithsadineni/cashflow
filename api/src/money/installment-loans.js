/**
 * Loans nobody has entered yet, from the bank's own rows (D419): the same
 * amount leaving a checking or savings account for the same payee month after
 * month, still going. A car loan's auto draft, a personal loan's ACH.
 *
 * Only a suggestion: Loans shows it with "Track it" (lender, monthly payment,
 * first payment and paying account filled in; the person adds the term) or
 * "Not a loan". What's left out: card bills (matched or filed as Card Payment),
 * money moved between the household's own accounts or into a brokerage, Zelle, and bills that are
 * already filed as something regular (rent, utilities, insurance, subscriptions).
 * A payee with no loan words in its line needs a bigger, company-style payment.
 *
 * Pure: rows, loans and dismissed keys in, suggestions out. Tested in
 * installment-loans.test.js.
 */

import { BROKERAGE } from '../parse/categories/flow-category.js';

const MIN_PAYMENTS = 3;
const MIN_CENTS = 10_000; // $100: below that it's a subscription, not a loan
const MIN_PLAIN_CENTS = 30_000; // without loan words, $300 and a company payment
const GAP_DAYS = [20, 40]; // monthly, give or take a weekend and a short month
const STALE_DAYS = 62; // no payment in two months: paid off, or moved

const NOT_LOANS = new Set([
  'Card Payment', 'Transfers', 'Savings', 'Investment', 'Zelle', 'Rent', 'Utilities', 'Phone', 'Internet',
  'Insurance', 'Subscriptions', 'Balance Transfer', 'Salary', 'Taxes',
]);
const LOAN_WORDS = /\b(loan|lending|lender|financ(e|ial|ing)|mortgage|installment|auto draft|auto pay(ment)?|car pay|credit union|servicing)\b/i;
const CAR_WORDS = /\b(auto(?! ?pay)|car|motor|vehicle|toyota|honda|tesla|ford credit|nissan|hyundai|kia)\b/i;
const HOME_WORDS = /\b(mortgage|home ?loan|escrow)\b/i;
// A company's ACH: "DES:", "PPD", "CCD", "CO ID".
const COMPANY_ACH = /\b(des:|ppd|ccd|co id)/i;

const DAY = 86_400_000;
const days = (a, b) => (Date.parse(b) - Date.parse(a)) / DAY;

/** The payee's words, without reference numbers: "SAMPLE AUTO DRAFT PPD ID: 0123" → "sample auto draft ppd id". */
export const payeeKey = (description) => (description ?? '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();

/** The lender's name off its line: the words before the ACH codes, in title case. */
export function lenderOf(description) {
  const head = (description ?? '').split(/\s(?:des:|ppd\b|ccd\b|id:|ach\b|web\b|auto draft|auto ?pay|payment|pmt\b|loan\b|co id)/i)[0];
  const words = head.replace(/[^A-Za-z&' -]+/g, ' ').split(/\s+/).filter(Boolean);
  while (words.length > 1 && words.at(-1).length === 1) words.pop(); // a word cut to one letter by the bank
  const name = words.slice(0, 4).join(' ');
  return name ? name.toLowerCase().replace(/(^|[\s&'-])([a-z])/g, (_, a, b) => a + b.toUpperCase()) : null;
}

/** The longest run of payments about a month apart that ends with the latest one. */
function currentRun(dates) {
  let start = dates.length - 1;
  while (start > 0) {
    const gap = days(dates[start - 1], dates[start]);
    if (gap < GAP_DAYS[0] || gap > GAP_DAYS[1]) break;
    start--;
  }
  return dates.slice(start);
}

/**
 * @param rows money out of checking and savings: { account_id, account_name, posted_date, amount_cents,
 *   description, merchant, txn_type, category_name, card_payment (matched to a card bill) }
 * @param loans every loan: { lender, monthly_payment_cents, payment_account_id }
 * @param dismissed keys the person answered "Not a loan"
 * @param today 'YYYY-MM-DD', or the latest row's date when the records stop earlier
 */
export function installmentSuggestions({ rows, loans = [], dismissed = [], today }) {
  const groups = new Map();
  for (const r of rows) {
    if (r.amount_cents > -MIN_CENTS || r.card_payment || /zelle/i.test(r.description ?? '') || BROKERAGE.test(r.description ?? '')) continue;
    if (['transfer', 'savings'].includes(r.txn_type) || NOT_LOANS.has(r.category_name)) continue;
    const key = `${r.account_id}|${payeeKey(r.description)}|${r.amount_cents}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const out = [];
  for (const same of groups.values()) {
    const sorted = same.sort((a, b) => a.posted_date.localeCompare(b.posted_date));
    const run = currentRun(sorted.map((r) => r.posted_date));
    if (run.length < MIN_PAYMENTS || days(run.at(-1), today) > STALE_DAYS) continue;
    const first = sorted.at(-run.length);
    const line = first.description ?? '';
    const cents = -first.amount_cents;
    if (!LOAN_WORDS.test(line) && !(cents >= MIN_PLAIN_CENTS && COMPANY_ACH.test(line))) continue;
    const lender = first.merchant ?? lenderOf(line);
    if (!lender) continue;
    const tracked = loans.some((l) => (l.lender && line.toLowerCase().includes(l.lender.trim().toLowerCase()))
      || (l.monthly_payment_cents === cents && (!l.payment_account_id || l.payment_account_id === first.account_id)));
    const key = `pay:${first.account_id}:${cents}`;
    if (tracked || dismissed.includes(key)) continue;
    out.push({
      kind: 'installment',
      key,
      lender,
      loan_type: HOME_WORDS.test(line) ? 'home' : CAR_WORDS.test(line) ? 'car' : 'other',
      monthly_payment_cents: cents,
      start_date: run[0],
      last_date: run.at(-1),
      payments: run.length,
      payment_account_id: first.account_id,
      account_name: first.account_name,
    });
  }
  return out.sort((a, b) => b.monthly_payment_cents - a.monthly_payment_cents);
}
