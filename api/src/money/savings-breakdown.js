import { countsAsSpend, spendCents } from './spend.js';
import { explorerYear } from './year-explorer.js';

/**
 * Where a period's Savings went (D179).
 *
 * Savings = income + spend + loan payments (summary.js). Every row is
 * in exactly one of those, or in the flows Savings deliberately leaves
 * out: moves to savings, borrowed money, transfers, card bills between
 * your own accounts, cashback and interest earned. So:
 *
 *   Savings = (sum of every row) − (sum of the left-out flows)
 *
 * The sum of every row is how much the accounts in the app changed:
 * cash up, card debt down. Each left-out flow, negated, is a line that
 * explains the gap: "+$15,600 moved to Apple Savings" is money you kept
 * that sits in an account the app can't see. The lines add up to
 * Savings to the cent (tested). The only exception is a period whose
 * refunds outweigh its spending, where Savings clamps spend at zero;
 * the caller shows any such remainder.
 */

const isIncome = (t) => t.txn_type === 'deposit';
const isLoan = (t) => t.category_name === 'Loan' && t.txn_type === 'payment';
const SAVINGS_KINDS = ['income', 'spending', 'loan', 'borrowed', 'transfers', 'card_bills', 'earned', 'other'];

/**
 * "Apple Gs Savings Transfer 9101 Web ID: …" → "Apple Gs Savings". The
 * bank's line, not the merchant: a savings move's merchant is often the
 * brand ("Apple"), which reads like a purchase.
 */
export function destinationOf(t) {
  const head = (t.description ?? '').split(/\s+(?:DES:|PPD|Web ID|Transfer|Payment|ID:|\d{4,})/i)[0].trim();
  return head.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()) || t.merchant || 'Savings';
}

function bucketOf(t) {
  if (t.txn_type === 'savings') return `moved:${destinationOf(t)}`;
  if (t.category_name === 'Balance Transfer') return 'borrowed';
  if (t.txn_type === 'transfer') return 'transfers';
  if (t.txn_type === 'payment') return 'card_bills';
  if ((t.txn_type === 'cashback' || t.txn_type === 'interest') && t.amount_cents > 0) return 'earned';
  return 'other';
}

/** The Savings tile's counted rows, followed by the existing breakdown buckets. */
export function savingsKindOf(t) {
  if (isIncome(t)) return 'income';
  if (countsAsSpend(t)) return 'spending';
  if (isLoan(t)) return 'loan';
  return bucketOf(t);
}

export function savingsKindLabel(key) {
  if (key.startsWith('moved:')) return `Moved to ${key.slice(6)}`;
  return {
    income: 'Income',
    spending: 'Spending',
    loan: 'Loan payments',
    borrowed: 'Borrowed (balance transfers)',
    transfers: 'Other transfers',
    card_bills: 'Card bills between your accounts',
    earned: 'Cashback & interest (not counted as income)',
    other: 'Other',
  }[key];
}

/** A row's contribution to Savings: counted activity plus the inverse of excluded flows. */
export function savingsAmountOf(t) {
  const kind = savingsKindOf(t);
  return ['income', 'spending', 'loan'].includes(kind) ? t.amount_cents : -t.amount_cents;
}

function savingsTotalCents(rows) {
  const income = rows.filter(isIncome).reduce((sum, row) => sum + row.amount_cents, 0);
  const loans = rows.filter(isLoan).reduce((sum, row) => sum + row.amount_cents, 0);
  return income + spendCents(rows) + loans;
}

/** One year in the shared explorer shape, while preserving each transaction's actual amount. */
export function savingsYear({ rows, accounts, year }) {
  const kinds = [...new Set([...SAVINGS_KINDS, ...rows.map(savingsKindOf)])];
  const uncounted = kinds.filter((kind) => !['income', 'spending', 'loan'].includes(kind));
  const yearRows = rows.filter((row) => row.posted_date.startsWith(year));
  const monthTotal = (month) => savingsTotalCents(yearRows.filter((row) => row.posted_date.startsWith(month)));
  const result = explorerYear({
    rows,
    accounts,
    year,
    kinds,
    kindOf: savingsKindOf,
    amountOf: savingsAmountOf,
    uncounted,
  });
  return {
    ...result,
    total_cents: savingsTotalCents(yearRows),
    months: result.months.map((month) => ({ ...month, total: monthTotal(month.month) })),
    kind_labels: Object.fromEntries(kinds.map((key) => [key, savingsKindLabel(key)])),
  };
}

/**
 * @param rows - the period's transactions: { amount_cents, txn_type, category_name, merchant, description }
 * @returns { accounts_change_cents, lines: [{ key, label, cents }] }, lines biggest first
 */
export function savingsBreakdown(rows) {
  let all = 0;
  const left = new Map();
  for (const t of rows) {
    all += t.amount_cents;
    const b = savingsKindOf(t);
    if (b === 'income' || b === 'spending' || b === 'loan') continue;
    left.set(b, (left.get(b) ?? 0) - t.amount_cents);
  }
  const lines = [...left]
    .filter(([, cents]) => cents !== 0)
    .map(([key, cents]) => ({ key, label: savingsKindLabel(key), cents }))
    .sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents));
  return { accounts_change_cents: all, lines };
}

/**
 * Pairs each "Moved to …" line with the savings or investment account it
 * went into (D180), so the line can show where that money stands now.
 * Matched when the account's issuer, or the first word of its name,
 * appears in the destination: "Robinhood Money" matches issuer
 * "Robinhood". Only SAVINGS/INVESTMENT accounts, so a Robinhood credit
 * card never claims a Robinhood savings move.
 * ponytail: a name match, not a stored link; add one if two accounts
 * ever share an issuer.
 */
export function linkDestinations(lines, accounts) {
  const candidates = accounts.filter((a) => a.account_type === 'SAVINGS' || a.account_type === 'INVESTMENT');
  return lines.map((l) => {
    if (!l.key.startsWith('moved:')) return l;
    const dest = l.key.slice(6).toLowerCase();
    const a = candidates.find((c) => [c.issuer, c.name?.split(/\s+/)[0]].some((w) => w && dest.includes(w.toLowerCase())));
    return a
      ? { ...l, account: { id: a.id, name: a.name, balance_cents: a.balance_cents, as_of: a.balance_as_of } }
      : { ...l, destination: l.key.slice(6) };
  });
}
