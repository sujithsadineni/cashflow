/**
 * A card statement's APRs (D349, statement-extraction step 4), in each
 * bank's words. Pure; tested in apr.test.js. Promotional rates are read
 * elsewhere (parse/promos.js, statement_promo) and skipped here.
 *
 *   label first:  Amex "Purchases 01/25/2023 29.99% (v)", Barclays "Standard Purchases - $0.00 29.99%(v)",
 *                 Bilt "Cash advances 31.74% (variable)", Robinhood, Zolve 2026 "Purchases 35.00% V"
 *   rate first:   Bank of America "27.49%V $0.00 $0.00 Purchases" (2026: "27.74%V Purchases $0.00 $0.00"), Zolve 2022 "16.0% (V) $0.00 $0.00 Purchases"
 *   Apple:        "Annual Percentage Rate (APR) 19.49 % (variable)" — purchases, its only rate
 *   penalty:      "…may be increased (up) to the Penalty APR of 29.99%"
 *
 * Returns { apr_purchase_bps, apr_balance_transfer_bps, apr_cash_advance_bps,
 * apr_penalty_bps, apr_variable }, nulls when not printed. The first rate
 * printed for a type wins (an Amex Plan It line repeats a date, not a type).
 */
const RATE = '(\\d{1,2}(?:\\.\\d{1,3})?) ?%';
const KIND = '(\\((?:v|variable|fixed)\\)|V\\b)?';
const AMOUNT = '\\$?\\s?[\\d,]+\\.\\d{2}';
const TYPES = [
  ['apr_purchase_bps', 'Purchases'],
  ['apr_balance_transfer_bps', 'Balance Transfers?(?:/Checks)?'],
  ['apr_cash_advance_bps', '(?:Bank )?Cash Advances?'],
];

const bps = (text) => Math.round(Number(text) * 100);
const variableOf = (kind) => (kind == null ? null : !/fixed/i.test(kind));

export function readAprs(text) {
  const out = { apr_purchase_bps: null, apr_balance_transfer_bps: null, apr_cash_advance_bps: null, apr_penalty_bps: null, apr_variable: null };
  const lines = (text ?? '').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  for (const line of lines) {
    for (const [key, type] of TYPES) {
      if (out[key] !== null) continue;
      // Label first, a date or an amount allowed between it and the rate.
      const first = line.match(new RegExp(`^(?:Standard )?${type}\\b(?:[^%]*?\\s)?${RATE} ?${KIND}`, 'i'));
      // Rate first, then the type, amounts allowed on either side of it (BofA moved them after the type in 2026).
      const last = line.match(new RegExp(`^(?:${AMOUNT}\\s+)*${RATE} ?${KIND}(?:\\s+${AMOUNT})*\\s+${type}(?:\\s+${AMOUNT})*$`, 'i'));
      const m = first ?? last;
      if (!m) continue;
      out[key] = bps(m[1]);
      if (key === 'apr_purchase_bps') out.apr_variable = variableOf(m[2]);
    }
    if (out.apr_penalty_bps === null) {
      const p = line.match(new RegExp(`Penalty APR of ${RATE}`, 'i'));
      if (p) out.apr_penalty_bps = bps(p[1]);
    }
    if (out.apr_purchase_bps === null) {
      const apple = line.match(new RegExp(`Annual Percentage Rate \\(APR\\) ${RATE} ?\\((variable|fixed)\\)`, 'i'));
      if (apple) Object.assign(out, { apr_purchase_bps: bps(apple[1]), apr_variable: variableOf(apple[2]) });
    }
  }
  return out;
}
