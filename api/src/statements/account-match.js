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
  // The same last 4 printed with another product is another card (D412): Amex printed 5201 and 5202 on
  // Blue Cash Everyday and on Cash Magnet. A product change that kept the number is still found, by the
  // balance it carries over (pickAccountByContinuity), so only a clear clash is dropped here.
  if (detected.name) {
    const product = norm(detected.name);
    hits = hits.filter((a) => {
      const printed = (a.cards ?? []).filter((c) => c.mask === detected.mask && c.product).map((c) => norm(c.product));
      return printed.length === 0 || printed.includes(product);
    });
  }
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

/**
 * The account a statement's product name points to, when its last 4 found none (D409). Only an
 * account whose last 4 can't contradict it: two accounts named alike ("Adv SafeBalance Banking",
 * one per person) are different accounts once their last 4 differ, and a name alone picked the
 * wrong one, so a second statement read as "already uploaded".
 *
 * candidates: accounts with that name, [{ id, mask }]. Returns an id or null.
 */
export function pickAccountByName(candidates, detected) {
  // A reissued card prints a new last 4 under the same holder (D410): that's the same account.
  const printed = detected?.holder_name ?? detected?.holder;
  const sameHolder = (a) => printed && a.holder_name && norm(printed) === norm(a.holder_name);
  const fits = candidates.filter((a) => !detected?.mask || !a.mask || a.mask === detected.mask || sameHolder(a));
  return fits.length === 1 ? fits[0].id : null;
}

const DAY_MS = 86_400_000;
const dayGap = (later, earlier) => Math.round((Date.parse(later) - Date.parse(earlier)) / DAY_MS);
const bankKey = (s) => (s ?? '').toLowerCase().replace(/\b(bank|usa|n\.?a\.?|inc|corp(oration)?|co|of|the)\b/g, '').replace(/[^a-z]/g, '');

/**
 * The account a statement continues, by its balance (D411): the same card, reissued (expired,
 * lost, stolen, replaced), upgraded to another tier (Blue Cash Everyday to Preferred) or printing
 * no holder at all (old Zolve statements), still opens with exactly the balance its previous
 * statement closed with, starting the day after (or within a few days). Checked both ways, so an
 * older statement uploaded later finds its account too.
 *
 * candidates: accounts of the statement's bank and kind, [{ id, issuer, account_type, holder_name,
 *   statements: [{ period_start, period_end, opening_balance_cents, closing_balance_cents }] }]
 * stmt: { period_start, period_end, opening_balance_cents, closing_balance_cents, issuer, account_type, holder }
 * Returns an id when exactly one account carries the balance over, else null.
 */
export function pickAccountByContinuity(candidates, stmt) {
  if (!stmt?.period_start || !stmt?.period_end) return null;
  const opening = stmt.opening_balance_cents == null ? null : Number(stmt.opening_balance_cents);
  const closing = stmt.closing_balance_cents == null ? null : Number(stmt.closing_balance_cents);
  if (opening == null && closing == null) return null;
  const printed = stmt.holder ? norm(stmt.holder) : null;
  const fits = candidates.filter((a) => {
    if (stmt.issuer && a.issuer && bankKey(stmt.issuer) !== bankKey(a.issuer)) return false;
    if (stmt.account_type && a.account_type && (stmt.account_type === 'CREDIT_CARD') !== (a.account_type === 'CREDIT_CARD')) return false;
    if (printed && a.holder_name && norm(a.holder_name) !== printed) return false; // another person's card
    return (a.statements ?? []).some((s) => {
      const after = dayGap(stmt.period_start, s.period_end);
      const before = dayGap(s.period_start, stmt.period_end);
      return (after >= 0 && after <= 3 && opening != null && Number(s.closing_balance_cents) === opening)
        || (before >= 0 && before <= 3 && closing != null && Number(s.opening_balance_cents) === closing);
    });
  });
  return fits.length === 1 ? fits[0].id : null;
}

const overlaps = (a, b) => Date.parse(a.period_start) <= Date.parse(b.period_end) && Date.parse(b.period_start) <= Date.parse(a.period_end);

/**
 * Accounts that are one card under several numbers (D411): imported before the app could tell
 * (a reissue or an upgrade became a second account). A pair is the same card when the later one's
 * first statement carries over the earlier one's last balance (pickAccountByContinuity) and their
 * statements never overlap: two cards with statements in the same months are two cards.
 * accounts: as pickAccountByContinuity's candidates. Returns [{ from, into }], older into newer.
 */
export function mergeSuggestions(accounts) {
  const withStatements = accounts.filter((a) => (a.statements ?? []).length > 0);
  const first = (a) => [...a.statements].sort((x, y) => Date.parse(x.period_start) - Date.parse(y.period_start))[0];
  const out = [];
  for (const older of withStatements) {
    for (const newer of withStatements) {
      if (older.id === newer.id) continue;
      if (older.statements.some((s) => newer.statements.some((t) => overlaps(s, t)))) continue;
      const opening = first(newer);
      const continues = pickAccountByContinuity([older], {
        ...opening, issuer: newer.issuer, account_type: newer.account_type, holder: newer.holder_name,
      }) === older.id;
      if (continues && Date.parse(first(older).period_start) < Date.parse(opening.period_start)) out.push({ from: older.id, into: newer.id });
    }
  }
  return out;
}
