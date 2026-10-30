/**
 * A credit card's balance transfer paid into checking as a deposit (owner's
 * request): Bank of America card services' ACH line, "BOA CS DES:DIRECT DEP
 * … INDN:<name> CO ID:…". It isn't income or a salary: it's money borrowed on
 * the card, so it's a transfer in the Balance Transfer category, named for
 * what it is. The ID and the name after INDN change from line to line, which
 * is why merchant learning (exact lines only, for transfers) never caught it.
 */
const BOA_CARD_SERVICES_DEPOSIT = /^BOA CS\s+DES:\s*DIRECT DEP\b/i;

export const BALANCE_TRANSFER_DEPOSIT = { merchant: 'BofA Balance Transfer', category: 'Balance Transfer', txn_type: 'transfer' };

/** The merchant, category and type for a balance-transfer deposit line, or null. */
export function balanceTransferDepositFor(description) {
  return BOA_CARD_SERVICES_DEPOSIT.test((description ?? '').trim()) ? BALANCE_TRANSFER_DEPOSIT : null;
}
