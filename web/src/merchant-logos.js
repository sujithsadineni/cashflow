/**
 * A small curated merchant → domain map, so recognizable brands get a
 * real logo. Statement extraction already cleans merchant names down
 * to something human ("COSTCO WHSE #1206" → "Costco"), so matching is
 * just a normalized lookup, not fuzzy guessing.
 *
 * Anything not in this list — a local restaurant, a small shop — has
 * no reliable domain to guess, so it falls back to a colored initial
 * instead of a broken image request. Add to this list as new
 * recognizable merchants show up; it's meant to grow.
 */
const MERCHANT_DOMAINS = {
  costco: 'costco.com',
  target: 'target.com',
  amazon: 'amazon.com',
  walmart: 'walmart.com',
  'whole foods market': 'wholefoodsmarket.com',
  'whole foods': 'wholefoodsmarket.com',
  starbucks: 'starbucks.com',
  'trader joes': 'traderjoes.com',
  costco_gas: 'costco.com',
  tesla: 'tesla.com',
  uber: 'uber.com',
  lyft: 'lyft.com',
  doordash: 'doordash.com',
  'uber eats': 'ubereats.com',
  grubhub: 'grubhub.com',
  netflix: 'netflix.com',
  spotify: 'spotify.com',
  apple: 'apple.com',
  google: 'google.com',
  anthropic: 'anthropic.com',
  'home depot': 'homedepot.com',
  'the home depot': 'homedepot.com',
  lowes: 'lowes.com',
  cvs: 'cvs.com',
  walgreens: 'walgreens.com',
  'best buy': 'bestbuy.com',
  chipotle: 'chipotle.com',
  mcdonalds: 'mcdonalds.com',
  'five below': 'fivebelow.com',
  publix: 'publix.com',
  kroger: 'kroger.com',
  shell: 'shell.com',
  chevron: 'chevron.com',
  delta: 'delta.com',
  united: 'united.com',
  airbnb: 'airbnb.com',
  bilt: 'biltrewards.com',
  'bilt housing': 'biltrewards.com',
  'bank of america': 'bankofamerica.com',
  chase: 'chase.com',
  paypal: 'paypal.com',
  venmo: 'venmo.com',
  // Subscriptions, utilities, and bill-pay brands — the recurring-
  // expense merchants, added as they showed up as real detected series.
  // Keys are what `normalize()` produces, which strips punctuation —
  // "Disney+" normalizes to "disney", not "disney+".
  disney: 'disneyplus.com',
  'disney plus': 'disneyplus.com',
  'hbo max': 'max.com',
  max: 'max.com',
  hulu: 'hulu.com',
  peacock: 'peacocktv.com',
  paramount: 'paramountplus.com',
  youtube: 'youtube.com',
  'youtube tv': 'tv.youtube.com',
  xfinity: 'xfinity.com',
  comcast: 'xfinity.com',
  'wells fargo': 'wellsfargo.com',
  cinemark: 'cinemark.com',
  amc: 'amctheatres.com',
  'duke energy': 'duke-energy.com',
  geico: 'geico.com',
  progressive: 'progressive.com',
  'state farm': 'statefarm.com',
  att: 'att.com',
  verizon: 'verizon.com',
  tmobile: 't-mobile.com',
  'american express': 'americanexpress.com',
  zelle: 'zellepay.com',
  // National chains found with no icon at all in a real audit of every
  // merchant in the dev database (201 of 235 had none) — added directly
  // since these are unambiguous, real brands. What's left after this is
  // genuinely small/local businesses with no logo to find; that's what
  // the per-merchant editable override (merchant_icon table,
  // routes/merchant-icons.js) is for.
  'dollar tree': 'dollartree.com',
  'dollar general': 'dollargeneral.com',
  chickfila: 'chick-fil-a.com', // "Chick-fil-A" normalizes to one word — hyphens are stripped, not spaced
  'taco bell': 'tacobell.com',
  hm: 'hm.com',
  'tj maxx': 'tjmaxx.tjx.com',
  kohls: 'kohls.com',
  ross: 'rossstores.com',
  burlington: 'burlington.com',
  nike: 'nike.com',
  ikea: 'ikea.com',
  'panda express': 'pandaexpress.com',
  'panera bread': 'panerabread.com',
  dominos: 'dominos.com',
  'buffalo wild wings': 'buffalowildwings.com',
  'dave busters': 'daveandbusters.com',
  'discount tire': 'discounttire.com',
  usps: 'usps.com',
  'the ups store': 'theupsstore.com',
  levis: 'levi.com',
  claires: 'claires.com',
  'bath body works': 'bathandbodyworks.com',
  'victorias secret': 'victoriassecret.com',
  'kate spade': 'katespade.com',
  fossil: 'fossil.com',
  github: 'github.com',
  groupon: 'groupon.com',
  openai: 'openai.com',
  logitech: 'logitech.com',
  samsung: 'samsung.com',
  'planet fitness': 'planetfitness.com',
  regal: 'regmovies.com',
  aldi: 'aldi.us',
  'harris teeter': 'harristeeter.com',
  'auntie annes': 'auntieannes.com',
  'ben jerrys': 'benjerry.com',
  'cold stone creamery': 'coldstonecreamery.com',
  shein: 'shein.com',
  adidas: 'adidas.com',
  exxon: 'exxon.com',
  exxonmobil: 'exxonmobil.com',
  'royal farms': 'royalfarms.com',
  quiktrip: 'quiktrip.com',
  // Second pass, prompted directly: "show all existing merchant logos"
  // after the household had already hand-assigned emoji to several
  // merchants that turned out to be real, findable brands. Each of
  // these was verified before adding — the favicon's actual bytes
  // checked against Google's generic-fallback icon, not just "the
  // request succeeded" — since a few real domains (Allstate, BP)
  // silently needed a `www.` prefix to resolve at all, and a wrong
  // guess here would show a stranger's logo on real spending data.
  allstate: 'www.allstate.com',
  'american eagle': 'ae.com',
  amtrak: 'amtrak.com',
  axon: 'axon.com',
  'axon enterprise': 'axon.com',
  barclaycard: 'barclaycardus.com',
  'calvin klein': 'calvinklein.com',
  'charlotte russe': 'charlotterusse.com',
  egencia: 'egencia.com',
  'food lion': 'foodlion.com',
  francescas: 'francescas.com',
  'georgia power': 'georgiapower.com',
  'ingles markets': 'ingles-markets.com',
  marshalls: 'marshalls.com',
  marta: 'itsmarta.com',
  miniso: 'miniso.com',
  'paris baguette': 'parisbaguette.com',
  'patel brothers': 'patelbros.com',
  robinhood: 'robinhood.com',
  sheetz: 'sheetz.com',
  'sofi bank': 'sofi.com',
  sofi: 'sofi.com',
  spectrum: 'spectrum.com',
  'the cheesecake factory': 'thecheesecakefactory.com',
  'tommy hilfiger': 'tommy.com',
  topgolf: 'topgolf.com',
  'breeze airways': 'flybreeze.com',
  bp: 'www.bp.com',
  cantaloupe: 'cantaloupe.com',
  // Third pass: a full re-scan of every merchant still showing a
  // plain initial (111 of 235), directly requested. Same verification
  // as the second pass — each domain's favicon fetched and visually
  // confirmed as a real, distinctive mark before adding, not just "a
  // 200 came back" — most of the 111 are genuinely small local shops
  // (restaurants, salons, parking) with no real logo to find, and
  // stayed that way; these are the ones that turned out to be real,
  // findable chains.
  'frontier airlines': 'flyfrontier.com',
  'office depot': 'officedepot.com',
  playstation: 'playstation.com',
  'mint mobile': 'mintmobile.com',
  toastique: 'toastique.com',
  'sweet paris': 'sweetparis.com',
  'comfort inn': 'comfortinn.com',
  'culinary dropout': 'culinarydropout.com',
  'van leeuwen ice cream': 'vanleeuwenicecream.com',
  'jenis splendid ice creams': 'jenis.com',
  'ding tea': 'dingtea.com',
  'leeann chin': 'leeannchin.com',
  globale: 'global-e.com',
  continuedev: 'continue.dev',
  'honk parking': 'honkmobile.com',
  'miss a': 'shopmissa.com',
  'k manga': 'kmanga.kodansha.com',
  botiwalla: 'botiwalla.com',
  'chapel hill tire': 'chapelhilltire.com',
  'galleria dallas ice skating center': 'galleriadallas.com',
};

const normalize = (name) => name.trim().toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ');

/**
 * Returns a domain string, or null when there's no confident mapping.
 * Tries an exact match first, then a word-boundary prefix match — real
 * merchants often carry a base brand plus extra words ("Tesla
 * Supercharger", "AMC Theatres", "Apple Card"), which an exact-only
 * match misses even though the brand is already known. The trailing
 * space in the prefix check keeps this safe ("Applebees" won't
 * false-match "apple").
 */
export function lookupMerchantDomain(merchant) {
  if (!merchant) return null;
  const normalized = normalize(merchant);
  if (MERCHANT_DOMAINS[normalized]) return MERCHANT_DOMAINS[normalized];
  for (const [key, domain] of Object.entries(MERCHANT_DOMAINS)) {
    if (normalized.startsWith(`${key} `)) return domain;
  }
  return null;
}

/** A deterministic color from the app's card palette, by name — same merchant, same color, every time. */
const AVATAR_PALETTE = ['#3B4B6B', '#6B4B8A', '#8A5A3B', '#4B6B5A', '#6B5A3B', '#3B6B7A', '#5A5A6B', '#7A4B4B'];

export function avatarColorFor(name) {
  if (!name) return AVATAR_PALETTE[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

export function initialsFor(name) {
  if (!name) return '?';
  return name.trim().charAt(0).toUpperCase();
}
