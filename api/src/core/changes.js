/**
 * What an edit actually did, for an audit entry's detail (D142): for
 * each field the request touched, its value before and after — and
 * only the fields whose value really changed, so re-saving an
 * unchanged form records nothing misleading.
 *
 * Before D142 the five PATCH handlers recorded only `changed: [field
 * names]`, which is why the Activity page could never say "Groceries →
 * Dining". Old entries stay as they are; the page handles both shapes.
 *
 * Pure (no db) so it's unit-tested on its own — see changes.test.js.
 */
export function changesBetween(before, after, fields) {
  const changes = {};
  for (const field of fields) {
    const from = before?.[field] ?? null;
    const to = after?.[field] ?? null;
    if (JSON.stringify(from) !== JSON.stringify(to)) changes[field] = { from, to };
  }
  return changes;
}
