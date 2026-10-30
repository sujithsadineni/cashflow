/**
 * Known credit card products, drawn in code (D403): their colours, the
 * network's name, and whether the card is light enough to need dark type.
 * A photo someone uploads (or a card picture they pick, below), or a colour
 * they choose, always wins over this. Shared with the API, which skips a new
 * card's random colour when its product is here, so the product face shows.
 *
 * Matched on the account's issuer and product name as statements print them.
 *
 * `art`: the issuer's own picture of the card in web/public/card-art/ (D407, see its NOTICE),
 * offered when the card is created or customized, never applied without being picked.
 */
const PRODUCTS = [
  { key: 'amex-bcp', issuer: /american express|amex/i, name: /blue cash preferred/i, primary: '#2E77BB', secondary: '#0B2E63', network: 'AMEX', art: 'amex-blue-cash-preferred.png' },
  { key: 'amex-bce', issuer: /american express|amex/i, name: /blue cash everyday/i, primary: '#5EA3DA', secondary: '#1D4F8F', network: 'AMEX', art: 'amex-blue-cash-everyday.png' },
  { key: 'amex-magnet', issuer: /american express|amex/i, name: /cash magnet/i, primary: '#3C6FA8', secondary: '#13294F', network: 'AMEX', art: 'amex-cash-magnet.png' },
  { key: 'amex-gold', issuer: /american express|amex/i, name: /\bgold\b/i, primary: '#D8B26A', secondary: '#9A7536', network: 'AMEX', light: true },
  { key: 'amex-platinum', issuer: /american express|amex/i, name: /platinum/i, primary: '#D9DCE1', secondary: '#9AA0A8', network: 'AMEX', light: true },
  { key: 'apple-card', issuer: /goldman|apple/i, name: /apple card/i, primary: '#F7F7F8', secondary: '#D9D9DE', network: 'Mastercard', light: true, art: 'apple-card.png' },
  { key: 'bofa-ccr', issuer: /bank of america|bofa/i, name: /customized cash/i, primary: '#D4203B', secondary: '#8E0F22', network: 'VISA', art: 'bofa-customized-cash-rewards.png' },
  { key: 'bofa-travel', issuer: /bank of america|bofa/i, name: /travel rewards/i, primary: '#1F3A6B', secondary: '#0C1C3A', network: 'VISA' },
  { key: 'bofa-unlimited', issuer: /bank of america|bofa/i, name: /unlimited cash/i, primary: '#C8102E', secondary: '#6E0716', network: 'VISA' },
  { key: 'bofa-visa', issuer: /bank of america|bofa/i, name: /visa signature|platinum visa/i, primary: '#20315A', secondary: '#0D1730', network: 'VISA' },
  { key: 'bilt', issuer: /bilt|wells fargo/i, name: /bilt/i, primary: '#1B2A44', secondary: '#0A1120', network: 'Mastercard', art: 'bilt.png' },
  { key: 'frontier', issuer: /barclays/i, name: /frontier/i, primary: '#2E9A47', secondary: '#0F5A26', network: 'Mastercard', art: 'barclays-frontier.png' },
  { key: 'samsung', issuer: /barclays|samsung/i, name: /samsung/i, primary: '#2B2D33', secondary: '#0E0F12', network: 'Mastercard' },
  { key: 'robinhood-gold', issuer: /robinhood/i, name: /gold/i, primary: '#C9A44C', secondary: '#7D6224', network: 'Mastercard', light: true, art: 'robinhood-gold.png' },
  { key: 'zolve', issuer: /zolve/i, name: /zolve|credit card/i, primary: '#5A1A2C', secondary: '#2C0B15', network: 'Mastercard', art: 'zolve.png' },
  { key: 'chase-freedom', issuer: /chase/i, name: /freedom/i, primary: '#2A6FC9', secondary: '#123A73', network: 'VISA' },
  { key: 'chase-sapphire', issuer: /chase/i, name: /sapphire/i, primary: '#1C3F78', secondary: '#0A1A36', network: 'VISA' },
  { key: 'citi-double', issuer: /citi/i, name: /double cash/i, primary: '#7FA7C9', secondary: '#3B5D80', network: 'Mastercard' },
  { key: 'discover-it', issuer: /discover/i, name: /discover|\bit\b/i, primary: '#F28C28', secondary: '#B3530A', network: 'DISCOVER' },
  { key: 'capone-quicksilver', issuer: /capital one/i, name: /quicksilver/i, primary: '#A9AFB7', secondary: '#5E646C', network: 'Mastercard', light: true },
];

/** The product an account is, or null: credit cards only, by issuer and printed name. */
export function cardProductFor(account) {
  if (account?.account_type !== 'CREDIT_CARD') return null;
  const issuer = account.issuer ?? '';
  const name = account.name ?? '';
  return PRODUCTS.find((p) => p.issuer.test(issuer) && p.name.test(name)) ?? null;
}

/** The face's background, as the rest of the card faces draw theirs. */
export const productBackground = (p) => ({ background: `linear-gradient(155deg, ${p.primary} 0%, ${p.secondary} 100%)` });

/** A product's picture, by its key, or null. Shared with the API that copies it to the account. */
export const cardArtFor = (key) => PRODUCTS.find((p) => p.key === key)?.art ?? null;
