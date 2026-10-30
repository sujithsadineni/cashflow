/**
 * How a loan with no card of its own looks as a card (D299): one matte
 * surface, as Apple Card is, carrying only the lender's name, what kind of
 * loan it is, and its glyph pressed faintly into it. The colour is the
 * lender's when it's a known bank (Wells Fargo's red, its wordmark in gold),
 * else a deep, quiet colour for the kind of loan. Pure: tested in
 * loan-art.test.js; LoanCard.jsx draws it.
 */

import { bankBrandFor } from '../cards/bankBrands.js';

// Deep, low-chroma colours: a matte card, not a sticker.
const BY_TYPE = {
  car: '#24324A',
  home: '#2E4A3F',
  credit_card: '#2C2C31',
  balance_transfer: '#3A3350',
  other: '#43365E',
};

const KIND = { car: 'Auto Loan', home: 'Home Loan', credit_card: 'Card', balance_transfer: 'Balance Transfer', other: 'Loan' };

/** A colour mixed toward black, for the card's lower edge. */
const deepen = (hex, share) => `color-mix(in srgb, ${hex} ${Math.round((1 - share) * 100)}%, black)`;

export function loanArt(loan) {
  const brand = bankBrandFor(loan.lender);
  const base = brand?.primary ?? BY_TYPE[loan.loan_type] ?? BY_TYPE.other;
  return {
    base,
    // A brand's own darker shade when it has one; else the base, deepened.
    deep: brand?.secondary ?? deepen(base, 0.45),
    wordmarkColor: brand?.wordmark ?? 'rgb(255 255 255 / 0.88)',
    wordmark: (brand?.name ?? loan.lender ?? '').trim().toUpperCase(),
    kind: KIND[loan.loan_type] ?? KIND.other,
  };
}
