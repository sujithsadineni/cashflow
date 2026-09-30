/**
 * Deterministic classification for Bilt's rent-payment mechanic.
 *
 * Confirmed against Bilt's own support docs, not just inferred from
 * this household's data: Bilt charges rent to the Mastercard to earn
 * points, then reverses that charge within ~24 hours and pulls the
 * real payment via ACH from the linked bank account instead — the
 * card never actually carries the rent balance. One rent payment
 * therefore produces up to four transaction rows across two accounts,
 * and only two of them are real money leaving the household:
 *
 *   - card: "BPS*BILT HOUSING ..."        the rent charge — reversed
 *           the same day, never real money out. txn_type: transfer.
 *   - card: "BILT RENT CHARGE ADJUSTMENT" its same-amount reversal —
 *           also never real money. txn_type: transfer.
 *   - bank: "BILT CARD HOUSING"           the real ACH rent debit —
 *           this is the actual expense. txn_type: purchase.
 *   - bank: "BILT PAYMENT BILTRENT"       a fixed recurring rent-linked
 *           charge — also real money out. txn_type: purchase.
 *
 * Getting txn_type right here matters as much as the category: every
 * "how much did we spend" query in this app (routes/summary.js,
 * routes/transactions.js) filters spend as `amount_cents < 0 AND
 * txn_type NOT IN ('payment','transfer','savings')`. The card-side
 * charge was landing as 'purchase' (wrongly counted as real spend,
 * even though it's reversed) while the bank-side ACH debits were
 * landing as 'payment' (wrongly EXCLUDED from spend, even though
 * that's the actual rent money). Net effect: rent spend was both
 * double-counted (via the card) and under-counted (the real bank
 * debit never showed up) at the same time — August looked like
 * $3,300 in "rent" when the real number, money that actually left the
 * SoFi checking account, is $1,650.00. Correcting txn_type to match
 * what's real fixes every one of those queries at once, with no
 * per-query special-casing for Bilt.
 *
 * A real card-statement payment ("BILT CARD PMT") is genuinely
 * different — it pays down whatever non-rent balance is left on the
 * card — and correctly stays category Card Payment, txn_type payment
 * (excluded from spend, same as any other credit card bill payment:
 * the underlying purchases already counted as spend when they
 * happened, so counting the payment too would double them again).
 *
 * This is a small, fixed, unambiguous set of description prefixes, so
 * a plain regex beats another AI guess — same reasoning as
 * merchant-review.js's deterministic matching.
 */

const RULES = [
  { pattern: /^BPS\*BILT HOUSING/i, category: 'Rent', txn_type: 'transfer' },
  { pattern: /^BILT RENT CHARGE ADJUSTMENT/i, category: 'Rent', txn_type: 'transfer' },
  { pattern: /^BILT CARD HOUSING/i, category: 'Rent', txn_type: 'purchase' },
  { pattern: /^BILT PAYMENT BILTRENT/i, category: 'Rent', txn_type: 'purchase' },
  { pattern: /^BILT CARD PMT/i, category: 'Card Payment', txn_type: 'payment' },
];

/** { category, txn_type } for a description, or null if this rule doesn't apply. */
export function biltRentRuleFor(description) {
  const d = (description ?? '').trim();
  for (const rule of RULES) {
    if (rule.pattern.test(d)) return { category: rule.category, txn_type: rule.txn_type };
  }
  return null;
}
