/**
 * Which accounts the Glass intro's wallet fans out (D239), and in what order.
 *
 * Owner's rules: the Apple Card in the centre when there is one; no two
 * cards from the same company unless there aren't enough companies; and a
 * spread of kinds, so a premium card (a Gold card), a bank account and
 * savings sit beside the everyday cards.
 *
 * Returns up to `count` accounts in display order, left to right, with the
 * centrepiece in the middle.
 */

const ALIASES = {
  bankofamerica: 'bofa', bofa: 'bofa',
  americanexpress: 'amex', amex: 'amex',
  goldmansachs: 'goldman', goldmansachsbankusa: 'goldman', goldmansachsbank: 'goldman',
  jpmorganchase: 'chase', chase: 'chase',
};
/** One key per company, however the issuer was written ("BOFA", "Bank of America"). */
export function companyOf(account) {
  const raw = (account.issuer ?? account.name ?? '').toLowerCase().replace(/[^a-z]/g, '');
  return ALIASES[raw] ?? raw;
}

const isApple = (a) => /apple\s*card/i.test(a.name ?? '');
const PREMIUM = [/gold/i, /platinum/i, /reserve/i, /sapphire/i, /preferred/i];
const premiumRank = (a) => {
  const i = PREMIUM.findIndex((re) => re.test(a.name ?? ''));
  return i < 0 ? Infinity : i;
};
const KNOWN_BANKS = new Set(['chase', 'sofi', 'bofa']);

export function pickWalletCards(accounts, count = 5) {
  const pool = accounts.filter((a) => a.is_active !== false && ['CREDIT_CARD', 'CHECKING', 'SAVINGS'].includes(a.account_type));
  const credit = pool.filter((a) => a.account_type === 'CREDIT_CARD');
  // A card with its own photo reads better in the fan than a plain colour.
  const byPhoto = (list) => [...list].sort((a, b) => Number(Boolean(b.image_path)) - Number(Boolean(a.image_path)));

  // The roles, in the order they claim a company.
  const roles = [
    credit.filter(isApple),
    byPhoto(credit.filter((a) => !isApple(a) && premiumRank(a) < Infinity)).sort((a, b) => premiumRank(a) - premiumRank(b)),
    [...pool.filter((a) => a.account_type === 'CHECKING')].sort((a, b) => Number(KNOWN_BANKS.has(companyOf(b))) - Number(KNOWN_BANKS.has(companyOf(a)))),
    byPhoto(credit),
    pool.filter((a) => a.account_type === 'SAVINGS'),
  ];

  const picked = [];
  const used = new Set();
  const take = (a) => { picked.push(a); used.add(companyOf(a)); };
  for (const role of roles) {
    const a = role.find((x) => !picked.includes(x) && !used.has(companyOf(x)));
    if (a && picked.length < count) take(a);
  }
  // More room: other companies first, from any role, cards with photos first.
  for (const a of byPhoto(credit).concat(pool)) {
    if (picked.length >= count) break;
    if (!picked.includes(a) && !used.has(companyOf(a))) take(a);
  }
  // Still short (few companies): repeats are allowed now.
  for (const a of byPhoto(credit).concat(pool)) {
    if (picked.length >= count) break;
    if (!picked.includes(a)) take(a);
  }

  // Display order: the first pick (the Apple Card, when there is one) in the
  // middle, the next ones alternating right and left outward.
  const order = [];
  picked.forEach((a, i) => {
    if (i === 0) order.push(a);
    else if (i % 2 === 1) order.unshift(a);
    else order.push(a);
  });
  return order;
}
