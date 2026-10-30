/**
 * Why a row on a shared card is someone other than the card's owner (D344),
 * for the row's detail beside Person. null when the row is the owner's.
 * Pure; tested in spender.test.js.
 */
export function spenderNote(t) {
  if (t.account_person_id == null || t.person_id === t.account_person_id) return null;
  if (t.card_ending && t.card_ending !== t.account_mask) return `Their card ··${t.card_ending} on this account`;
  return 'Their section of the statement';
}
