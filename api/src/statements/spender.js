/**
 * Who spent a row on a shared card (D344), from the section its statement
 * printed it in. Pure: tested in spender.test.js.
 *
 * A row carries what the reader saw: `spender_name` (the section's name, as
 * printed) and `card_ending` (when the statement prints one per card). The
 * card's members say who those are:
 *   1. a member's own card ending decides first (a name can be printed two
 *      ways; a card number can't);
 *   2. then the exact printed name, ignoring case and spacing;
 *   3. a card ending the account itself has been printed with is the
 *      owner's card: the account's person, nothing to propose; so is a
 *      section printed with the owner's own name and no card ending;
 *   4. a member added before their section ever printed (no name, no card
 *      ending yet: an "expected" member) takes a section that isn't the
 *      owner's, when they're the only one waiting;
 *   5. anything else is left unresolved and proposed (D100): the row counts
 *      as the account's person until someone says who it is.
 * Payments and credits aren't tagged by the readers, so they resolve to
 * nobody, which means the account's person (the owner's rule: payments stay
 * with the card's owner).
 *
 * members:  [{ person_id, printed_name, card_ending, is_active }]
 * ownMasks: last fours the account and its statements were printed with
 * Returns { personId, proposed }: personId null means the account's person.
 */
export const normalizePrintedName = (name) => (name ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

export function resolveSpender(row, { members = [], ownMasks = [], ownNames = [] } = {}) {
  const name = normalizePrintedName(row.spender_name);
  const ending = row.card_ending ?? null;
  if (!name && !ending) return { personId: null, proposed: false };
  const active = members.filter((m) => m.is_active !== false);

  if (ending) {
    const byEnding = active.find((m) => m.card_ending === ending);
    if (byEnding) return { personId: byEnding.person_id, proposed: false };
  }
  if (name) {
    const byName = active.filter((m) => normalizePrintedName(m.printed_name) === name);
    // Two members printed alike can't be told apart by name: ask instead of guessing.
    if (byName.length === 1) return { personId: byName[0].person_id, proposed: false };
  }
  if (ending && ownMasks.includes(ending)) return { personId: null, proposed: false };
  // A co-owner's statement prints the owner's own section too (Apple Card, no card numbers):
  // under the name the account's statements print its holder as, that's the owner, not someone new.
  if (name && !ending && ownNames.some((n) => normalizePrintedName(n) === name)) return { personId: null, proposed: false };
  const expected = active.filter((m) => m.role !== 'owner' && !m.printed_name && !m.card_ending);
  if (expected.length === 1) return { personId: expected[0].person_id, proposed: false };
  return { personId: null, proposed: true };
}

/**
 * The purchase a refund gives back (the owner's rule: a refund follows the
 * original buyer). The latest purchase on the same card, on or before the
 * refund and within `days`, with the same merchant (or the same description
 * when neither has a merchant) and at least the refund's size.
 *
 * refund:    { posted_date, amount_cents (positive), merchant, description }
 * purchases: [{ id, posted_date, amount_cents (negative), merchant, description, spender_person_id }]
 * Returns that purchase, or null.
 */
const sameText = (s) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const DAY_MS = 86_400_000;

export function originalPurchase(refund, purchases, { days = 180 } = {}) {
  const refundDay = Date.parse(refund.posted_date);
  const matches = purchases.filter((p) => {
    const gap = (refundDay - Date.parse(p.posted_date)) / DAY_MS;
    if (gap < 0 || gap > days) return false;
    if (-p.amount_cents < refund.amount_cents) return false;
    if (refund.merchant && p.merchant) return refund.merchant === p.merchant;
    return !refund.merchant && !p.merchant && sameText(refund.description) === sameText(p.description);
  });
  matches.sort((a, b) => Date.parse(b.posted_date) - Date.parse(a.posted_date) || b.id - a.id);
  return matches[0] ?? null;
}
