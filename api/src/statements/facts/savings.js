/**
 * What a bank statement says its money earned (D355, statement-extraction
 * step 6), in each bank's words. Pure; tested in savings.test.js. Read,
 * never projected.
 *
 *   Robinhood Savings: "Annual Percentage Yield Earned 3.61%", "Interest Earned
 *     (Sep 2026) $12.34", "Interest Paid This Year $98.76", "Tax Withheld $0.00",
 *     "Tax Withheld This Year $0.00"
 *   SoFi: labels on one line, figures on the next —
 *     "Current Balance Monthly Interest Paid Annual Percentage Yield Earned" / "$1,000.00 $1.23 0.50%"
 *     "Beginning Balance Year-to-date Interest Paid" / "$900.00 $9.87"
 *
 * Returns { apy_bps, interest_cents, interest_ytd_cents, tax_withheld_cents,
 * tax_withheld_ytd_cents } with only what was printed, or null.
 */
const AMT = '\\$\\s?([\\d,]+\\.\\d{2})';
const cents = (t) => Math.round(Number(t.replace(/,/g, '')) * 100);

export function readSavings(text) {
  const lines = (text ?? '').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const out = {};
  const first = (re, key, conv = cents) => {
    if (out[key] != null) return;
    for (const l of lines) { const m = l.match(re); if (m) { out[key] = conv(m[1]); return; } }
  };
  first(/Annual Percentage Yield Earned (\d{1,2}\.\d{1,3})\s?%/i, 'apy_bps', (t) => Math.round(Number(t) * 100));
  first(new RegExp(`^Interest Earned \\([A-Za-z]{3} \\d{4}\\) ${AMT}`, 'i'), 'interest_cents');
  first(new RegExp(`^Interest Paid This Year ${AMT}`, 'i'), 'interest_ytd_cents');
  first(new RegExp(`^Tax Withheld This Year ${AMT}`, 'i'), 'tax_withheld_ytd_cents');
  first(new RegExp(`^Tax Withheld ${AMT}`, 'i'), 'tax_withheld_cents');

  // SoFi: the figures on the line under their labels; the first block is the account's.
  for (let i = 0; i < lines.length - 1; i++) {
    if (/^Current Balance Monthly Interest Paid Annual Percentage Yield Earned$/i.test(lines[i])) {
      const m = lines[i + 1].match(new RegExp(`^${AMT}\\s?${AMT}\\s?(\\d{1,2}\\.\\d{1,3})\\s?%$`));
      if (m && out.apy_bps == null) Object.assign(out, { interest_cents: cents(m[2]), apy_bps: Math.round(Number(m[3]) * 100) });
    }
    if (/^Beginning Balance Year-to-date Interest Paid$/i.test(lines[i]) && out.interest_ytd_cents == null) {
      const m = lines[i + 1].match(new RegExp(`^${AMT}\\s?${AMT}$`));
      if (m) out.interest_ytd_cents = cents(m[2]);
    }
  }
  return Object.keys(out).length ? out : null;
}
