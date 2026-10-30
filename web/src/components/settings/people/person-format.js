/** Small formatters the People page shares (D302, D303). */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Sep 2026" from an ISO date. */
export const monthYear = (iso) => (iso ? `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : '');

/** "Bank of America ··5108 ··5115, Zolve ··5116": the accounts something was read from, by bank. */
export function accountWord(list) {
  const banks = new Map();
  for (const a of list) {
    const bank = a.issuer ?? a.name;
    if (!banks.has(bank)) banks.set(bank, []);
    if (a.mask) banks.get(bank).push(`··${a.mask}`);
  }
  return [...banks].map(([bank, masks]) => [bank, ...masks.sort()].join(' ')).join(', ');
}

/** An address printed in capitals, set in title case; the state stays two capitals. */
export const addressCase = (line) => (line !== line.toUpperCase() ? line : line
  .split(', ')
  .map((part, i, all) => (i === all.length - 1 && /^[A-Z]{2}\b/.test(part)
    ? part
    : part.replace(/\b[A-Z]+\b/g, (w) => w[0] + w.slice(1).toLowerCase())))
  .join(', '));
