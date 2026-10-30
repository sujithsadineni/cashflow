/**
 * Which category moved Spent the most since last month (D381), for the Spent
 * card's "vs last month" line. `current` and `previous` are /summary/where's
 * categories (spend_cents negative). Named only when one category explains the
 * change: at least half of it, and not much more than all of it. A change spread
 * across many categories, or a small net change hiding big moves that cancel
 * out ($15 less overall, $900 less on one thing and $885 more elsewhere), gets
 * no name rather than a misleading one. `cardChange` is the Spent card's own
 * change in cents (positive: spent more).
 */
export function spendDriver(current = [], previous = [], cardChange) {
  const spend = (rows) => new Map(rows.map((r) => [r.category_id ?? 'none', { name: r.name, cents: -Number(r.spend_cents) }]));
  const now = spend(current), before = spend(previous);
  const change = (m) => [...m.values()].reduce((s, c) => s + c.cents, 0);
  // Measured against the card's own change when given (it nets refunds), so the words match the number beside them.
  const total = cardChange ?? change(now) - change(before);
  if (total === 0) return null;
  let best = null;
  for (const key of new Set([...now.keys(), ...before.keys()])) {
    const delta = (now.get(key)?.cents ?? 0) - (before.get(key)?.cents ?? 0);
    if (Math.sign(delta) === Math.sign(total) && (!best || Math.abs(delta) > Math.abs(best.delta))) {
      best = { name: (now.get(key) ?? before.get(key)).name, delta };
    }
  }
  const share = best ? Math.abs(best.delta) / Math.abs(total) : 0;
  return share >= 0.5 && share <= 1.5 ? best.name : null;
}
