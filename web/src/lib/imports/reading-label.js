/**
 * What the reading says it's reading (D360), in the statement's own words:
 * "Reading payments and other credits…", "Reading new charges…", and on a
 * shared card "Reading Alex's transactions…", in place of a line number.
 * The heading is the one the row was printed under (GET /imports/:id/pages
 * `headings`); a shared card's person comes from the row's printed section
 * (D344); with neither (a CSV, a locked PDF), the row's kind. Pure; tested in
 * reading-label.test.js.
 *
 * @param row     the row being read
 * @param heading its printed heading, or null
 * @param first   (name) => a person's short name (shortPersonName, which masks)
 * @returns words after "Reading", e.g. "new charges"
 */
const BY_TYPE = { payment: 'payments', refund: 'credits', cashback: 'credits', fee: 'fees', interest: 'interest', transfer: 'transfers', deposit: 'deposits', savings: 'transfers', purchase: 'purchases' };

export function readingLabel(row, heading, first = (n) => n) {
  if (!row) return null;
  const h = (heading ?? '').trim();
  // A person's own section: their name, then what the section holds.
  if (row.person_name) return `${first(row.person_name)}'s ${/^payments/i.test(h) || row.txn_type === 'payment' ? 'payments' : 'transactions'}`;
  // "Transactions by …" on a card nobody shares is just the transactions.
  if (h) return h.replace(/\s+(by|made by)\s+.+$/i, '').toLowerCase();
  return BY_TYPE[row.txn_type] ?? 'the statement';
}
