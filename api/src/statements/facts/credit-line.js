/**
 * A card statement's credit line (D346, statement-extraction step 1): the
 * limit, what's available, and the cash-advance limit, in each bank's own
 * words (01-inventory.md). Pure; tested in credit-line.test.js.
 *
 * A figure counts only beside its label on the same line, either after it
 * ("Credit Limit $9,000.00", Amex, Zolve, Barclays, Bilt, Robinhood) or
 * starting the line before it ("$ 40,000.00 Total Credit Line", Bank of
 * America). The line-start form is tried first: Bank of America's summary box
 * shares lines with the column beside it ("$ 40,000.00 Total Credit Line $40
 * and your APRs may…"), and the figure after the label there is a late fee.
 * Terms-page sentences ("against your credit limit") have no figure.
 * Not printed → null, never 0. Apple prints no limit.
 */
import { parseMoney } from '../../parse/pdf-local-helpers.js';

const AMT = '\\$?\\s?[\\d,]+\\.\\d{2}';

// Most specific first, so "Available Credit Limit" isn't read as the limit.
const LABELS = {
  available_credit_cents: ['Available Credit Limit', 'Available Revolving Credit Line', 'Available Credit Line', 'Total Credit Available', 'Credit Limit Available', 'Available Credit', 'Credit Available'],
  cash_advance_limit_cents: ['Cash Advance Credit Limit', 'Cash Advance Limit', 'Cash Credit Line'],
  credit_limit_cents: ['Total Revolving Credit Line', 'Total Credit Line', 'Credit Limit'],
};
// Words that turn a limit label into another one ("Available Cash Advance Limit", "Available Credit Limit").
const NOT_AFTER = { credit_limit_cents: /(Available|Advance|Cash)\s*$/i, cash_advance_limit_cents: /Available\s*$/i, available_credit_cents: /Cash\s*$/i };

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function figureFor(lines, key) {
  for (const label of LABELS[key]) {
    const before = new RegExp(`^(${AMT})\\s{1,6}${esc(label)}\\b`, 'i');
    const after = new RegExp(`${esc(label)}\\b[:\\s]{1,12}(${AMT})`, 'i');
    for (const line of lines) {
      const lead = before.exec(line);
      if (lead) return parseMoney(lead[1]);
      const m = after.exec(line);
      if (m && !NOT_AFTER[key].test(line.slice(0, m.index))) return parseMoney(m[1]);
    }
  }
  return null;
}

export function readCreditLine(text) {
  const lines = (text ?? '').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const out = {};
  for (const key of Object.keys(LABELS)) out[key] = figureFor(lines, key);
  // Barclays: "Total Revolving Credit Line $N, Includes $N cash advance line".
  if (out.cash_advance_limit_cents === null) {
    const m = lines.join('\n').match(new RegExp(`Includes (${AMT}) cash advance line`, 'i'));
    if (m) out.cash_advance_limit_cents = parseMoney(m[1]);
  }
  return out;
}

/**
 * Does what's available square with the limit and the balance? Pending
 * charges and payments make the bank's figure differ honestly, so this only
 * says whether it's exact; a difference is shown, not flagged as wrong.
 * null when any figure is missing.
 */
export function creditLineAddsUp({ credit_limit_cents: limit, available_credit_cents: available, closing_balance_cents: balance }) {
  if (limit == null || available == null || balance == null) return null;
  return limit - Math.max(Number(balance), 0) === Number(available);
}
