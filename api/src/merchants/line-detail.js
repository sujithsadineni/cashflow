/**
 * What a row's printed line says beyond its merchant (D352): the day it was
 * bought when the bank prints that and the day it posted, and the wallet it
 * was paid with. Read every time a row is shown, like its place (D224):
 * nothing stored. Pure; tested in line-detail.test.js.
 *
 *   Bank of America  "03/11   03/13   McDonalds 33418 …"       (bought, posted)
 *   Barclays         "Apr 26   Apr 27   CHIPOTLE 3267 …"
 *   Zolve            "11/20/2024 11/21/2024 7-ELEVEN 50711 …"
 *   Amex             "AplPay PARKWHIZ INC   CHICAGO   IL …"     (Apple Pay)
 *
 * @param raw        the printed line (staged_transaction.raw_text), or null
 * @param description the saved description (carries "AplPay" when there's no line)
 * @param posted     the row's posted date, YYYY-MM-DD
 * @returns { sale_date, wallet }, each null when not printed
 */
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n) => String(n).padStart(2, '0');

const WALLETS = [
  [/\bAplPay\b|\bApple Pay\b/i, 'Apple Pay'],
  [/\bSamsung ?Pay\b/i, 'Samsung Pay'],
  [/\bGglPay\b|\bGoogle Pay\b/i, 'Google Pay'],
];

/** A month and day, in the posted date's year, or the year before when it would land after it. */
function dated(month, day, posted) {
  let year = Number(posted.slice(0, 4));
  if (month > Number(posted.slice(5, 7))) year -= 1;
  return `${year}-${pad(month)}-${pad(day)}`;
}

function saleDate(raw, posted) {
  const line = (raw ?? '').replace(/\s+/g, ' ').trim();
  let m = line.match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2})\/(\d{2})\/(\d{4}) /);
  if (m) return `${m[3]}-${m[1]}-${m[2]}`;
  m = line.match(/^(\d{2})\/(\d{2}) (\d{2})\/(\d{2}) /);
  if (m) return dated(Number(m[1]), Number(m[2]), posted);
  m = line.match(/^([A-Z][a-z]{2}) (\d{1,2}) ([A-Z][a-z]{2}) (\d{1,2}) /);
  if (m && MONTHS[m[1].toLowerCase()]) return dated(MONTHS[m[1].toLowerCase()], Number(m[2]), posted);
  return null;
}

export function lineDetail(raw, description, posted) {
  const sale = posted ? saleDate(raw, posted) : null;
  const text = `${raw ?? ''} ${description ?? ''}`;
  return {
    // Only when it differs from the day it posted: the same day says nothing new.
    sale_date: sale && sale !== posted ? sale : null,
    wallet: WALLETS.find(([re]) => re.test(text))?.[1] ?? null,
  };
}
