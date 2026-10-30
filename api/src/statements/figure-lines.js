/**
 * Where a statement prints each figure of the strip above its rows (D360), so
 * hovering a figure lights its line on the page, as hovering a row does
 * (D335). A figure's line is the first one printing its amount beside its
 * label's words ("New Balance $251.36"); the due date's is the line naming the
 * due date with the date itself. A figure nothing matches gets no box, and the
 * page lights nothing for it. Pure; tested in figure-lines.test.js.
 *
 * @param pages   [{ n, lines: [{ text, left, right, top, bottom }] }] (page-lines.js)
 * @param summary the strip's figures (shared.js statementSummary)
 * @returns { [key]: { page, left, right, top, bottom } }, keys as the strip's
 */
const LABELS = {
  opening: /previous (total |statement )?balance|opening balance|beginning balance|balance last statement/i,
  closing: /new balance|closing balance|ending balance|statement balance|total balance/i,
  spend: /new charges|purchases|charges|withdrawals|debits|subtractions|money out/i,
  payments: /payments|credits|deposits|additions|money in/i,
  cashback: /reward|cash ?back|daily cash/i,
  fees: /fees/i,
  interest: /interest/i,
  minimum: /minimum (payment|due)/i,
  savings_interest: /interest (earned|paid)|interest/i,
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "1,234.56" for 123456 or -123456: how a statement prints the size of an amount. */
const printed = (cents) => (Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Every way a date is printed: 11/19/26, 11/19/2026, Nov 19, November 19. */
function dateForms(iso) {
  const [y, m, d] = iso.split('-');
  const month = MONTHS[Number(m) - 1];
  return [`${m}/${d}/${y.slice(2)}`, `${m}/${d}/${y}`, `${month} ${Number(d)}`, `${month}. ${Number(d)}`];
}

export function locateFigures(pages, summary) {
  const lines = pages.flatMap((p) => p.lines.map((l) => ({ ...l, page: p.n })));
  const box = ({ page, left, right, top, bottom }) => ({ page, left, right, top, bottom });
  const find = (test) => lines.find((l) => test(l.text));
  const out = {};
  const amount = (key, cents, label = LABELS[key], prefer = null) => {
    if (cents == null) return;
    const want = printed(cents);
    const hit = (prefer && find((t) => t.includes(want) && label.test(t) && prefer.test(t))) || find((t) => t.includes(want) && label.test(t));
    if (hit) out[key] = box(hit);
  };
  amount('opening', summary.opening_cents);
  amount('closing', summary.closing_cents);
  amount('spend', summary.spend_cents);
  amount('payments', summary.payments_cents);
  amount('cashback', summary.cashback_cents);
  // The year's fees and interest print on their own line ("Total fees charged in 2026"), apart from the period's.
  const year = summary.ytd_year ? new RegExp(`\\b${summary.ytd_year}\\b|year.to.date`, 'i') : /year.to.date/i;
  amount('fees', summary.ytd_fees_cents, LABELS.fees, year);
  amount('interest', summary.ytd_interest_cents, LABELS.interest, year);
  amount('savings_interest', summary.savings?.interest_cents ?? null);
  // For the statement's notes (D360): its credit line, and its purchase APR as printed ("28.74%").
  amount('limit', summary.credit_limit_cents, /credit limit|credit line/i);
  if (summary.apr_purchase_bps != null) {
    const rate = `${(summary.apr_purchase_bps / 100).toFixed(2)}%`;
    const hit = find((t) => t.includes(rate) && /purchase/i.test(t)) ?? find((t) => t.includes(rate));
    if (hit) out.apr = box(hit);
  }
  if (summary.due_date) {
    const forms = dateForms(summary.due_date);
    const hit = find((t) => /due/i.test(t) && forms.some((f) => t.includes(f))) ?? find((t) => forms.some((f) => t.includes(f)));
    if (hit) out.due = box(hit);
  }
  return out;
}
