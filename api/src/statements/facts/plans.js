/**
 * Installment plans on a card statement (D356, statement-extraction step 7):
 * Amex Plan It, the only plans on file (Bank of America's "Custom Pay Plan"
 * appears only in its terms). Pure; tested in plans.test.js. Read as printed.
 *
 *   "Plan Balance = $1,234.56", "Plan Payment Due $415.20", "New Plan Principal +$1,200.00",
 *   "Plan Fees +$4.80", and the Plan Balance Details table, one line per plan:
 *   "03/11/23 CORNER STORE 3 $1,200.00 $0.00 $1,200.00 $400.00 $4.80 $404.80"
 *   (created, description, months, previous balance, payments/credits, remaining
 *   principal, monthly principal, monthly fee, payment due).
 *
 * Returns { balance_cents, payment_due_cents, new_principal_cents, fees_cents,
 * items: [{ created_on, description, months, remaining_cents, monthly_principal_cents,
 * monthly_fee_cents, payment_due_cents }] }, or null when the statement has no plan.
 */
const AMT = '\\$\\s?([\\d,]+\\.\\d{2})';
const cents = (t) => Math.round(Number(t.replace(/,/g, '')) * 100);

export function readPlans(text) {
  const lines = (text ?? '').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const out = {};
  const first = (re, key) => {
    for (const l of lines) { const m = l.match(re); if (m) { out[key] = cents(m[1]); return; } }
  };
  first(new RegExp(`^Plan Balance = ${AMT}`), 'balance_cents');
  first(new RegExp(`^Plan Payment Due ${AMT}`), 'payment_due_cents');
  first(new RegExp(`^New Plan Principal \\+${AMT}`), 'new_principal_cents');
  first(new RegExp(`^Plan Fees \\+${AMT}`), 'fees_cents');

  const ROW = new RegExp(`^(\\d{2})/(\\d{2})/(\\d{2}) (.+?) (\\d{1,2}) ${AMT} -?${AMT} ${AMT} ${AMT} ${AMT} ${AMT}$`);
  // The same line twice is a continued page, or two identical plans: "Plan Totals" says which.
  const totals = lines.map((l) => l.match(new RegExp(`^Plan Totals ${AMT} -?${AMT} ${AMT}`))).find(Boolean);
  const all = lines.filter((l) => ROW.test(l));
  const remainingOf = (list) => list.reduce((n, l) => n + cents(l.match(ROW)[8]), 0);
  const unique = [...new Set(all)];
  const rows = totals && remainingOf(all) === cents(totals[3]) ? all : unique;
  const items = [];
  for (const l of rows) {
    const m = l.match(ROW);
    items.push({
      created_on: `20${m[3]}-${m[1]}-${m[2]}`, description: m[4].trim(), months: Number(m[5]),
      remaining_cents: cents(m[8]), monthly_principal_cents: cents(m[9]), monthly_fee_cents: cents(m[10]), payment_due_cents: cents(m[11]),
    });
  }
  if (items.length) out.items = items;
  return out.balance_cents != null || items.length ? out : null;
}
