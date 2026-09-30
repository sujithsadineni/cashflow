/**
 * Real brand identity for checking/savings accounts at banks we
 * recognize. Never applies to credit cards — those keep the existing
 * generic-or-photo treatment in CardCarousel.jsx.
 *
 * This is a DEFAULT only: an account's own `color` or `image_path`,
 * once set via the existing customize picker, always wins over it.
 *
 * Colors are the banks' own published brand colors, not guesses:
 *   Bank of America — https://brandpalettes.com/bank-of-america-logo-colors/
 *   Chase           — https://chromacreator.com/brands/chase
 *   SoFi            — https://www.brandcolorcode.com/sofi
 */

const normalize = (issuer) => (issuer ?? '').toLowerCase().replace(/[^a-z]/g, '');

// `issuer` is free text (parsed off statements or typed in Settings),
// so the same bank shows up as "BOFA", "Bank of America", etc. — map
// every variant we've actually seen (or are likely to) to one key.
const ALIASES = {
  bofa: 'bofa',
  bankofamerica: 'bofa',
  chase: 'chase',
  jpmorganchase: 'chase',
  jpmorgan: 'chase',
  sofi: 'sofi',
};

export const BANK_BRANDS = {
  bofa: { key: 'bofa', name: 'Bank of America', primary: '#012169', secondary: '#E31837' },
  chase: { key: 'chase', name: 'Chase', primary: '#117ACA', secondary: '#0B4E7A' },
  sofi: { key: 'sofi', name: 'SoFi', primary: '#00A2C7', secondary: '#201747' },
};

export function bankBrandFor(issuer) {
  const key = ALIASES[normalize(issuer)];
  return key ? BANK_BRANDS[key] : null;
}
