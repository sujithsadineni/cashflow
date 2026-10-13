/**
 * How an account looks as a little card (D243): its own photo, else its
 * bank's colours and logo, else its chosen colour. Shared by the Glass
 * intro's wallet fan and the Glass People cards.
 */

import { bankBrandFor } from './bankBrands';
import bofaLogo from './assets/bank-logos/bofa.png';
import chaseLogo from './assets/bank-logos/chase.png';
import sofiLogo from './assets/bank-logos/sofi.png';

const BRAND_LOGOS = { bofa: bofaLogo, chase: chaseLogo, sofi: sofiLogo };

export function accountArt(account) {
  if (account.image_path) {
    return { style: { backgroundImage: `url(/api/account-images/${account.image_path.split('/').pop()})`, backgroundSize: 'cover', backgroundPosition: 'center' }, logo: null };
  }
  const brand = bankBrandFor(account.issuer);
  if (brand) return { style: { background: `linear-gradient(155deg, ${brand.primary} 0%, ${brand.secondary} 100%)` }, logo: BRAND_LOGOS[brand.key] ?? null };
  const c = account.color ?? '#3A3A3C';
  return { style: { background: `linear-gradient(155deg, ${c} 0%, color-mix(in srgb, ${c} 55%, black) 100%)` }, logo: null };
}

export const accountKind = (account) => (account.account_type === 'CHECKING' ? 'Checking' : account.account_type === 'SAVINGS' ? 'Savings' : null);
