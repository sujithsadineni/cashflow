/**
 * Zelle by year and by person (D288). Every Zelle row is reviewed by hand
 * (routes/zelle.js): sent to someone, received from someone, or between
 * the household's own accounts. Between-you moves are shown but counted
 * in neither direction, as everywhere else. A month's total is how much
 * moved by Zelle, sent and received together: a net would draw a month
 * that sent $1,000 and received $1,000 as empty.
 */

import { explorerYear } from './year-explorer.js';

const KINDS = ['sent', 'received', 'internal', 'unreviewed'];
const BY_TYPE = { SENT: 'sent', RECEIVED: 'received', INTERNAL: 'internal' };

export const zelleKind = (t) => BY_TYPE[t.zelle_type] ?? 'unreviewed';

/** Who a row is with: its contact, else the name typed in review, else unknown. */
export function personOf(t) {
  if (t.contact_id) return { key: `c${t.contact_id}`, name: t.contact_nickname || t.contact_name, image_path: t.contact_image_path ?? null, contact_id: t.contact_id };
  if (t.zelle_person) return { key: `n:${t.zelle_person.toLowerCase()}`, name: t.zelle_person, image_path: null, contact_id: null };
  return { key: 'unknown', name: 'Not named yet', image_path: null, contact_id: null };
}

export function zelleYear({ rows, accounts, year }) {
  const withPeople = rows.map((r) => {
    const p = personOf(r);
    return { ...r, person_key: p.key, person_name: p.name };
  });
  const y = explorerYear({ rows: withPeople, accounts, year, kinds: KINDS, kindOf: zelleKind, uncounted: ['internal', 'unreviewed'] });
  // Between you nets to $0 (each move has an out and an in half), so it's shown as what moved: the halves that arrived.
  const internalIn = new Array(12).fill(0);
  for (const i of y.items) if (i.kind === 'internal' && i.amount_cents > 0) internalIn[Number(i.posted_date.slice(5, 7)) - 1] += i.amount_cents;
  y.months.forEach((m, k) => { m.total = m.received - m.sent; m.internal = internalIn[k]; });
  y.by_kind.internal = internalIn.reduce((a, c) => a + c, 0);
  const people = new Map();
  for (const i of y.items) {
    const p = personOf(i);
    if (!people.has(p.key)) people.set(p.key, { ...p, sent_cents: 0, received_cents: 0, count: 0 });
    const e = people.get(p.key);
    e.count += 1;
    if (i.kind === 'sent') e.sent_cents += i.amount_cents;
    if (i.kind === 'received') e.received_cents += i.amount_cents;
  }
  return {
    ...y,
    total_cents: y.months.reduce((a, m) => a + m.total, 0),
    // Most money moved first, either way (sent is negative, so received − sent is the volume).
    people: [...people.values()].sort((a, b) => (b.received_cents - b.sent_cents) - (a.received_cents - a.sent_cents) || b.count - a.count),
  };
}
