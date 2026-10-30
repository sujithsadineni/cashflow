/**
 * Fees & Interest: what holding the household's accounts cost (D285). Every
 * `fee` row and every interest charge, less the fees a bank gave back (a
 * reversed annual fee, a refunded maintenance fee). Those refunds already
 * lower Spent (money/spend.js counts refunds), so counting them here keeps
 * this card a true slice of it; leaving them out showed Zolve's $99.99
 * annual fee for 2026 although it was reversed three days later.
 */

import { explorerYear } from './year-explorer.js';

/** A refund that gives back a fee or interest, not a merchant's. `t` and `c` are the transaction and category aliases. */
export const FEE_REFUND_SQL = `(t.txn_type = 'refund' AND (c.name IN ('Interest', 'Annual Fee', 'Bank Fees')
   OR t.description ~* '\\mFEE\\M|SERVICE CHARGE'))`;
const FEE_WORD = /\bFEE\b|SERVICE CHARGE/i;
export const isFeeRefund = (t) => t.txn_type === 'refund' && (['Interest', 'Annual Fee', 'Bank Fees'].includes(t.category_name) || FEE_WORD.test(t.description ?? ''));

/** What a fee or interest row is: 'transfer' | 'annual' | 'late' | 'account' | 'interest' | 'refund' | 'other'. */
export function feeKind(t) {
  if (t.txn_type === 'refund') return 'refund';
  if (t.txn_type === 'interest') return 'interest';
  const d = t.description ?? '';
  // "DIRECT DEPOSIT - TRANSACTION FEE" is a balance transfer's; a FOREIGN transaction fee isn't (D342).
  if (/BALANCE TRANSFER|(?<!FOREIGN )TRANSACTION FEE|CASH ADVANCE/i.test(d)) return 'transfer';
  if (/ANNUAL FEE/i.test(d)) return 'annual';
  if (/LATE FEE|RETURNED PAYMENT/i.test(d)) return 'late';
  if (/MAINTENANCE|SERVICE CHARGE|MONTHLY FEE/i.test(d)) return 'account';
  return 'other';
}

const KINDS = ['transfer', 'annual', 'late', 'account', 'interest', 'other', 'refund'];

/** One year of it (money/year-explorer.js). */
export const feesYear = ({ rows, accounts, year }) => explorerYear({ rows, accounts, year, kinds: KINDS, kindOf: feeKind });

/**
 * Interest Earned and Bank Fees (D342) for a row a reader filed under Interest or left blank:
 * interest coming in is earned; a fee that isn't an annual fee or a balance transfer's is a bank
 * fee. Null when neither applies, or the household has no such category.
 */
export function refinedFeeCategory(row, categoryNames = null) {
  const has = (name) => !categoryNames || categoryNames.includes(name);
  const open = !row.suggested_category || row.suggested_category === 'Interest';
  if (!open) return null;
  if (row.txn_type === 'interest' && row.amount_cents > 0 && has('Interest Earned')) return 'Interest Earned';
  if (row.txn_type === 'fee' && !['annual', 'transfer'].includes(feeKind(row)) && has('Bank Fees')) return 'Bank Fees';
  return null;
}
