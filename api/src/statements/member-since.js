/**
 * The date an account was opened, as a statement prints it (D393):
 * "Member since Mar 24, 2026" (SoFi), and the other ways issuers word it
 * ("Customer since", "Account opened", "Cardmember since"), with the date
 * written out, as digits, or as a year alone. Pure: text in, 'YYYY-MM-DD'
 * or null out. A year alone is its first day, so none of that year's
 * months reads as before the account. Tested in member-since.test.js.
 */

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const LABEL = String.raw`(?:card\s?member|member|customer|client)\s+since|account\s+opened(?:\s+on)?|date\s+opened|opened\s+on`;
const pad = (n) => String(n).padStart(2, '0');

function valid(y, m, d) {
  if (y < 1950 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCMonth() === m - 1 ? `${y}-${pad(m)}-${pad(d)}` : null;
}

export function memberSince(text) {
  if (!text) return null;
  const after = new RegExp(`(?:${LABEL})\\s*:?\\s*`, 'i');
  const at = text.match(after);
  if (!at) return null;
  const rest = text.slice(at.index + at[0].length, at.index + at[0].length + 24);
  // Mar 24, 2026 / March 24 2026
  let m = rest.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) return valid(Number(m[3]), MONTHS[m[1].slice(0, 3).toLowerCase()], Number(m[2]));
  // 03/24/2026 or 03-24-2026 (US order)
  m = rest.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (m) return valid(Number(m[3]), Number(m[1]), Number(m[2]));
  // 2026-03-24
  m = rest.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return valid(Number(m[1]), Number(m[2]), Number(m[3]));
  // March 2026
  m = rest.match(/^([A-Za-z]{3,9})\.?\s+(\d{4})/);
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) return valid(Number(m[2]), MONTHS[m[1].slice(0, 3).toLowerCase()], 1);
  // 2019
  m = rest.match(/^(\d{4})\b/);
  if (m) return valid(Number(m[1]), 1, 1);
  return null;
}
