/**
 * The dates "Where it's going" covers (D373): one calendar month, or the
 * year so far — January of the month's own year through the end of that
 * month, the same span every year_to_date_* figure on the Overview uses.
 * `to` is exclusive (the first day after), so SQL reads `< to`.
 */
export function whereRange(month, span) {
  const [year, mon] = month.split('-').map(Number);
  const next = mon === 12 ? `${year + 1}-01-01` : `${year}-${String(mon + 1).padStart(2, '0')}-01`;
  return { from: span === 'ytd' ? `${year}-01-01` : `${month}-01`, to: next };
}
