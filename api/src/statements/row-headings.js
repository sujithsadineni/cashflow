/**
 * The heading each row was printed under (D360): "Payments", "Credits", "New
 * Charges", "Fees", "Interest Charged", "Purchases and Adjustments", "Deposits
 * and Additions" … as the statement itself names its parts, so the reading can
 * say what it's reading ("Reading payments…") instead of a line number. A
 * row's heading is the nearest one above its line, on its page or an earlier
 * one ("Detail Continued" pages carry the last heading on). Pure; tested in
 * row-headings.test.js.
 *
 * A heading is a short line of words only (no amounts, no dates, no "Total"),
 * naming a kind of money: the words below. "Summary", "Detail" and a card
 * member's name aren't headings; a shared card's sections come from the rows'
 * printed names instead (D344).
 *
 * @param pages   [{ n, lines: [{ text, top }] }] (page-lines.js)
 * @param located { [rowId]: { page, top } } (locateRows)
 * @returns { [rowId]: heading as printed, tidied to Title Case }
 */
const KINDS = /\b(payments?|credits?|charges|purchases?|fees?|interest|deposits?|withdrawals?|additions|subtractions|checks|transfers?|adjustments|cash advances?|installments?|refunds?|returns?|transactions)\b/i;
const NOT = /^(total|totals|summary|detail|new balance|previous balance|minimum|page|continued)\b|year.to.date|\bfor this period\b|\bthank you\b|agreement|notice|update|important|\boffer\b|\bfrom\b/i;
// What rides along a heading: its column's label, or a page's "- Continued".
const tidy = (text) => text.replace(/\s+/g, ' ').trim().replace(/\s*-\s*continued$/i, '').replace(/\s+amount$/i, '');

const title = (s) => s.toLowerCase().replace(/(^|\s|\/)([a-z])/g, (m, a, b) => a + b.toUpperCase()).replace(/\b(And|Or|Of|The|To|By)\b/g, (w) => w.toLowerCase());

export function isHeading(text) {
  const t = tidy(text);
  // A transaction's own line has a merchant's marks: "GEICO *AUTO", "(RETURN)", "PURCHASE RETURNS - SAMSUNG".
  if (!t || t.length > 42 || /[\d$*()]/.test(t) || / - /.test(t)) return false;
  if (t.split(' ').length > 6 || NOT.test(t)) return false;
  return KINDS.test(t);
}

export function rowHeadings(pages, located) {
  const heads = pages.flatMap((p) => p.lines.filter((l) => isHeading(l.text)).map((l) => ({ page: p.n, top: l.top, text: title(tidy(l.text)) })));
  const out = {};
  for (const [id, box] of Object.entries(located ?? {})) {
    let best = null;
    for (const h of heads) {
      const above = h.page < box.page || (h.page === box.page && h.top < box.top - 0.001);
      if (above && (!best || h.page > best.page || (h.page === best.page && h.top > best.top))) best = h;
    }
    if (best) out[id] = best.text;
  }
  return out;
}
