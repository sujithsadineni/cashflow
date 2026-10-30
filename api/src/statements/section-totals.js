/**
 * What a shared card's statement prints as each person's total (D360), so the
 * statement dialog can check each person's section of rows against it. Read
 * from the page lines the dialog already has (page-lines.js), when the pages
 * are shown: nothing stored. Pure; tested in section-totals.test.js.
 *
 *   Amex   "New Charges" … "JORDAN LEE 7-21234 $120.40" (one per card) … "Total New Charges"
 *          kind 'charges': the card's new charges, so its purchases and fees
 *   Apple  "Transactions by Jordan Lee" … "Total charges, credits and returns $64.20"
 *          kind 'all': everything in that person's section
 *
 * Others print one person's section (Barclays) or no total per card (Bank of
 * America, not read yet): nothing comes back, and the dialog shows no check.
 *
 * @param pages [{ n, lines: [{ text }] }]
 * @returns [{ printed_name, card_ending, total_cents, kind }]; total_cents in the app's sign (charges negative)
 */
const MONEY = /(-?)\$([\d,]+\.\d{2})$/;
const cents = (m) => (m[1] ? 1 : -1) * Math.round(Number(m[2].replace(/,/g, '')) * 100);

export function readSectionTotals(pages) {
  const lines = pages.flatMap((p) => p.lines.map((l) => l.text.replace(/\s+/g, ' ').trim()));
  const out = [];

  // Amex: one line per card between "New Charges" and its total.
  let charges = false;
  for (const line of lines) {
    if (/^New Charges$/i.test(line)) { charges = true; continue; }
    if (/^Total New Charges\b/i.test(line)) { charges = false; continue; }
    if (!charges) continue;
    const m = line.match(/^(.+?) \d+-\d*(\d{4}) (-?\$[\d,]+\.\d{2})$/);
    if (m) out.push({ printed_name: m[1], card_ending: m[2], total_cents: cents(m[3].match(MONEY)), kind: 'charges' });
  }
  if (out.length > 0) return out;

  // Apple: each person's section ends with its own total.
  let name = null;
  for (const line of lines) {
    const head = line.match(/^Transactions by (.+)$/i);
    if (head) { name = head[1]; continue; }
    const total = name && line.match(/^Total charges, credits and returns (-?\$[\d,]+\.\d{2})$/i);
    if (total) {
      out.push({ printed_name: name, card_ending: null, total_cents: cents(total[1].match(MONEY)), kind: 'all' });
      name = null;
    }
  }
  return out;
}
