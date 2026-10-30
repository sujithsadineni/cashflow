/**
 * What changed in a card's terms between two statements (D349): its purchase
 * APR or its credit limit, as each printed them. A figure either statement
 * didn't print isn't a change (Zolve's 2026 layout stopped printing its
 * limit; that's not a cut to nothing). Pure; tested in terms-change.test.js.
 *
 * newest, previous: { apr_purchase_bps, credit_limit_cents }
 * Returns [{ field: 'apr' | 'limit', from, to }], empty when nothing changed.
 */
export function termsChanges(newest, previous) {
  if (!newest || !previous) return [];
  const out = [];
  const changed = (a, b) => a != null && b != null && Number(a) !== Number(b);
  if (changed(previous.apr_purchase_bps, newest.apr_purchase_bps)) {
    out.push({ field: 'apr', from: Number(previous.apr_purchase_bps), to: Number(newest.apr_purchase_bps) });
  }
  if (changed(previous.credit_limit_cents, newest.credit_limit_cents)) {
    out.push({ field: 'limit', from: Number(previous.credit_limit_cents), to: Number(newest.credit_limit_cents) });
  }
  return out;
}
