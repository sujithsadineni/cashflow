/**
 * Words for an account's cards over time (D275): reissues (a lost or
 * expired card) and upgrades, from GET /accounts' card_history. Pure:
 * tested in card-history.test.js.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthYear = (iso) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

/** "Earlier cards ··5110 ··5104 ··5107", or null: every number but the current one. */
export function earlierCards(account) {
  const masks = [...new Set((account.card_history ?? []).map((c) => c.mask))].filter((m) => m !== account.mask);
  return masks.length ? `Earlier cards ${masks.map((m) => `··${m}`).join(' ')}` : null;
}

/** "Blue Cash Everyday until Jan 2024", one phrase per product it was before the current one, or null. */
export function earlierProducts(account) {
  const runs = (account.card_history ?? []).filter((c) => c.product);
  const phrases = [];
  for (let i = 0; i < runs.length - 1; i++) {
    if (runs[i].product !== runs[i + 1].product) phrases.push(`${runs[i].product} until ${monthYear(runs[i].to)}`);
  }
  return phrases.length ? phrases.join(' · ') : null;
}

/**
 * The card a statement was printed on, when it isn't the account's current
 * card: "Blue Cash Everyday ··5104". null for the current card or unknown.
 */
export function printedOn(statement, account) {
  if (!statement?.card_mask || !account) return null;
  const current = (account.card_history ?? []).at(-1);
  const sameCard = statement.card_mask === account.mask && (!statement.product_name || !current?.product || statement.product_name === current.product);
  if (sameCard) return null;
  return [statement.product_name, `··${statement.card_mask}`].filter(Boolean).join(' ');
}
