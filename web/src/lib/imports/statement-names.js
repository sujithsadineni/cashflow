/**
 * The people a statement prints sections for (D400): its holder, and every name a
 * reader read off a section of charges ("Transactions by …", a card member's part),
 * each once however it's spaced, with the card ending their rows printed most.
 * Names inside a row (a Zelle sender, a payee) aren't sections, so they never count.
 */
const key = (s) => (s ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

export function namesOnStatement(batch, rows = []) {
  const byKey = new Map();
  const add = (printed, ending = null) => {
    const k = key(printed);
    if (!k) return;
    const entry = byKey.get(k) ?? { printed: printed.trim().replace(/\s+/g, ' '), endings: new Map() };
    if (ending) entry.endings.set(ending, (entry.endings.get(ending) ?? 0) + 1);
    byKey.set(k, entry);
  };
  add(batch?.detected_holder ?? '');
  for (const r of rows) if (r.spender_name) add(r.spender_name, r.card_ending ?? null);
  return [...byKey.values()].map(({ printed, endings }) => ({
    printed,
    card_ending: [...endings].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
  }));
}

/** Where each name starts: the holder is the primary; a name with its own card is an additional member, else a co-owner. */
export const startingRole = (name, index) => (index === 0 ? 'owner' : name.card_ending ? 'additional' : 'co_owner');

export const ROLE_CHOICES = [
  { value: 'owner', label: 'Primary' },
  { value: 'co_owner', label: 'Co-owner' },
  { value: 'additional', label: 'Additional card member' },
];
