/**
 * Money back from a merchant: a refund, or a reward (D189)?
 *
 * A refund is the merchant giving money back (a return, a cancelled
 * flight) and it lowers spending. A reward is the card paying you (an
 * Amex Offer credit, a streaming credit, cash back redeemed), which is
 * cashback and doesn't touch spending. Statements word rewards plainly,
 * so the words decide. These were all typed 'refund' before, which made
 * spending look smaller than it was.
 */
const REWARD = /amex offer|offer credit|offer:|streaming credit|digital entertainment credit|\bcredit for\b.*\b(plus|membership)\b|cash ?back|cash reward|\brewards?\b|\bdeals\b|statement credit|redeem/i;

/** 'cashback' or 'refund' for a positive row at a merchant. */
export const inflowType = (description) => (REWARD.test(description ?? '') ? 'cashback' : 'refund');
