/**
 * Shared cards (D344): who's on a card besides its owner, and the words
 * Settings → Accounts uses for them. Pure; tested in members.test.js.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthYear = (iso) => (iso ? `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : null);

/**
 * The people a shared card's badge shows: its owner first, then each other
 * active member, as people records (so avatars and nicknames follow).
 * null when nobody else is on the card.
 */
export function sharedPeople(account, people) {
  const others = (account?.members ?? []).filter((m) => m.person_id !== account.person_id);
  if (others.length === 0) return null;
  const find = (id, name) => people.find((p) => p.id === id) ?? { id, name };
  return [find(account.person_id, account.person_name), ...others.map((m) => find(m.person_id, m.person_name))];
}

export const ROLE_LABELS = { owner: 'Owner', co_owner: 'Co-owner', additional: 'Additional card member' };

/** "Co-owner since Jan 2026", "Additional card ··1234 · since Oct 2024", "Additional card member · waiting for their first statement". */
export function memberLine(m) {
  const since = monthYear(m.since);
  if (m.role === 'additional' && m.card_ending) return [`Additional card ··${m.card_ending}`, since && `since ${since}`].filter(Boolean).join(' · ');
  if (m.role !== 'owner' && !m.printed_name && !m.card_ending) return `${ROLE_LABELS[m.role]} · waiting for their first statement`;
  return [ROLE_LABELS[m.role], since && `since ${since}`].filter(Boolean).join(' ');
}

/** A name a statement prints that no member accounts for: "MORGAN ALEX ··1234 · 12 rows since Mar 2026". */
export function proposedLine(p) {
  const rows = `${p.rows} ${p.rows === 1 ? 'row' : 'rows'}`;
  return [p.printed_name, p.card_ending && `··${p.card_ending}`].filter(Boolean).join(' ') + ` · ${rows} since ${monthYear(p.first)}`;
}

/**
 * What adding a proposed name as a member sends: the card's owner printed
 * another way stays its owner; someone else with their own card is an
 * additional member, without one a co-owner.
 */
export function memberFromProposal(p, personId, ownerId) {
  const id = Number(personId);
  return {
    person_id: id,
    role: id === ownerId ? 'owner' : p.card_ending ? 'additional' : 'co_owner',
    printed_name: p.printed_name ?? null,
    card_ending: p.card_ending ?? null,
    since: p.first ?? null,
  };
}

/** People who could still be added to the card: not its owner, not already an active member. */
export function addablePeople(account, members, people) {
  const on = new Set(members.filter((m) => m.is_active).map((m) => m.person_id));
  return people.filter((p) => p.id !== account.person_id && !on.has(p.id));
}

/** Two letters, first and last name ("Alex Morgan" → "AM"): the badge tells apart two people who share a first initial. */
export function twoInitials(name) {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return (words[0][0] + (words.length > 1 ? words.at(-1)[0] : '')).toUpperCase();
}

/** A person's cards: the ones they own, and shared cards they're on. `personId` is a string id, as filters keep it. */
export const onCard = (a, personId) =>
  String(a.person_id) === personId || (a.members ?? []).some((m) => String(m.person_id) === personId);
