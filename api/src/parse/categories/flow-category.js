/**
 * The category of a row that moves money rather than buys something (D417), by its type and
 * its words: what every household files a card payment, a Zelle, a refund, cash back, pay or a
 * transfer to a brokerage under. Needs no history, so a new install's first statements are
 * filed. Only fills a blank: the household's own history and the readers' rules come first.
 * Returns a category name, or null for a purchase (that's the merchant's category).
 */
const has = (re) => (row) => re.test(row.description ?? '');
const zelle = has(/\bzelle\b/i);
const payroll = has(/\b(payroll|direct dep|dir dep|salary|paycheck|pay ?roll)\b/i);
const taxRefund = has(/\b(irs treas|treas 310|tax ref|state of \w+ tax|dept of revenue|[a-z]{2}dor)\b/i);
const cashDeposit = has(/\b(atm|cash deposit|counter deposit|deposit at|branch deposit)\b/i);
// Shared with installment-loans.js: money into a brokerage is investing, never a loan payment.
export const BROKERAGE = /\b(robinhood|schwab|fidelity|vanguard|e\*?trade|webull|coinbase|wealthfront|betterment|acorns|stash|m1 finance|public\.com)\b/i;
const brokerage = has(BROKERAGE);
// A lender's monthly draft (D419): a car or personal loan, not a card bill.
const loan = has(/\b(loan|lending|mortgage|auto draft|auto loan|installment)\b/i);
const savings = has(/\bsavings?\b/i);
const balanceTransfer = has(/\bbalance transfer\b/i);
const annual = has(/\bannual\b/i);

export function flowCategory(row) {
  const type = row.txn_type;
  if (zelle(row)) return 'Zelle';
  switch (type) {
    case 'payment': return loan(row) ? 'Loan' : 'Card Payment';
    case 'cashback': return 'Cashback';
    case 'refund': return 'Refund';
    case 'fee': return balanceTransfer(row) ? 'Balance Transfer Fee' : annual(row) ? 'Annual Fee' : 'Bank Fees';
    case 'interest': return row.amount_cents > 0 ? 'Interest Earned' : 'Interest';
    case 'deposit':
      if (payroll(row)) return 'Salary';
      if (taxRefund(row)) return 'Tax-Refund';
      if (cashDeposit(row)) return 'Cash Deposit';
      return null;
    case 'transfer':
    case 'savings':
      if (balanceTransfer(row)) return 'Balance Transfer';
      if (brokerage(row)) return 'Investment';
      if (savings(row) || type === 'savings') return 'Savings';
      return 'Transfers';
    default: return null;
  }
}
