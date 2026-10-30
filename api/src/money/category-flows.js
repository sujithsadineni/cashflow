/**
 * Investment and To India, the two small Overview cards that are one
 * hand-kept category each (D286). Their kinds are how the money moved:
 * Investment all goes to Robinhood, so it's whether Robinhood pulled it,
 * it was sent instantly, or it came back out; To India is which service
 * carried it.
 */

import { explorerYear } from './year-explorer.js';

const INVEST_KINDS = ['pulled', 'instant', 'back', 'other'];

/** 'pulled' (Robinhood's ACH debit) | 'instant' (a realtime payment out) | 'back' (money returned) | 'other'. */
export function investKind(t) {
  if (t.amount_cents > 0) return 'back';
  const d = t.description ?? '';
  if (/Instant Payment|Realtime Payment/i.test(d)) return 'instant';
  if (/\bDEBITS\b|\bACH\b/i.test(d)) return 'pulled';
  return 'other';
}

const INDIA_KINDS = ['remitly', 'frex', 'tribe', 'crobo', 'other'];

/** Which service sent it. Tribe's line starts "Fbo Frex (Tradit Tribe", so Tribe is checked first. */
export function indiaKind(t) {
  const text = `${t.merchant ?? ''} ${t.description ?? ''}`;
  if (/REMITLY|RMTLY/i.test(text)) return 'remitly';
  if (/TRIBE/i.test(text)) return 'tribe';
  if (/FREX/i.test(text)) return 'frex';
  if (/CROBO/i.test(text)) return 'crobo';
  return 'other';
}

export const investmentYear = ({ rows, accounts, year }) => explorerYear({ rows, accounts, year, kinds: INVEST_KINDS, kindOf: investKind });
export const indiaYear = ({ rows, accounts, year }) => explorerYear({ rows, accounts, year, kinds: INDIA_KINDS, kindOf: indiaKind });
