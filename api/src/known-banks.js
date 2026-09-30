/**
 * Recognizes an issuer string as one of the banks the web app draws a
 * real brand identity for (see web/src/bankBrands.js — the two files
 * must stay in sync on which keys exist, though only the frontend
 * needs the actual colors/marks).
 *
 * Used only to decide whether account creation should leave `color`
 * unset so that brand identity can show through as the default,
 * instead of the random palette color every other account gets.
 */

const normalize = (issuer) => (issuer ?? '').toLowerCase().replace(/[^a-z]/g, '');

const KNOWN_BANKS = new Set([
  'bofa', 'bankofamerica',
  'chase', 'jpmorganchase', 'jpmorgan',
  'sofi',
]);

export const isKnownBank = (issuer) => KNOWN_BANKS.has(normalize(issuer));
