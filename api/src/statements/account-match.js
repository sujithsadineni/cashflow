/**
 * Which account an uploaded statement belongs to, from the card printed
 * on it (D275). An account's cards change: a reissue after a card expires
 * or is lost changes the last 4, an upgrade changes the product too. So a
 * statement's last 4 is checked against each account's current card and
 * every card its statements were printed with, and when two accounts have
 * had the same last 4 the issuer and then the product decide. Still tied:
 * no suggestion, the person picks. Pure: tested in account-match.test.js.
 *
 * candidates: [{ id, issuer, name, mask, is_active, cards: [{ mask, product }] }]
 * detected:   { mask, issuer, name } read off the statement
 * Returns the account id, or null.
 */
const norm = (s) => (s ?? '').toLowerCase().replace(/®/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

export function pickAccountForCard(candidates, detected) {
  if (!detected?.mask) return null;
  let hits = candidates.filter((a) => a.mask === detected.mask || (a.cards ?? []).some((c) => c.mask === detected.mask));
  // A closed account that had the same card (re-added under a new account) gives way to the open one.
  if (hits.length > 1 && hits.some((a) => a.is_active !== false)) hits = hits.filter((a) => a.is_active !== false);
  if (hits.length > 1 && detected.issuer) {
    const sameIssuer = hits.filter((a) => norm(a.issuer) === norm(detected.issuer));
    if (sameIssuer.length > 0) hits = sameIssuer;
  }
  if (hits.length > 1 && detected.name) {
    const product = norm(detected.name);
    // The product that card number was printed with on this account, else the account's own name.
    const printedWith = (a) => {
      const seen = (a.cards ?? []).filter((c) => c.mask === detected.mask && c.product).map((c) => norm(c.product));
      return seen.length > 0 ? seen : a.mask === detected.mask ? [norm(a.name)] : [];
    };
    hits = hits.filter((a) => printedWith(a).includes(product));
  }
  return hits.length === 1 ? hits[0].id : null;
}
