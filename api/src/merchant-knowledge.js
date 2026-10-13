/**
 * The merchant knowledge base (D189): everything the household's own
 * transactions say about each merchant, in one place.
 *
 *   aliases    the bank lines it's recognised by (merchant-learning.js keys)
 *   out / back its usual type and category for money out, and for money back
 *              (a refund, or a card reward: cashback)
 *   count, first_seen, last_seen
 *
 * Computed from the transactions on every read, never stored: it's the
 * same history the import learns from (merchant names, learned types,
 * historical categories), shown so a person can see what the app will
 * do. A fix anywhere in the ledger is the knowledge base's next answer.
 * Pure: rows in, entries out.
 */
import { descKeys } from './merchant-learning.js';

const most = (values) => {
  const counts = new Map();
  for (const v of values) if (v != null) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0]?.[0] ?? null;
};

/**
 * @param rows transactions with a merchant: { merchant, description, amount_cents, txn_type, category_name, posted_date }
 * @returns entries, most-used first
 */
export function buildKnowledge(rows) {
  const byMerchant = new Map();
  for (const r of rows) {
    if (!r.merchant || /^zelle$/i.test(r.merchant)) continue;
    if (!byMerchant.has(r.merchant)) byMerchant.set(r.merchant, []);
    byMerchant.get(r.merchant).push(r);
  }
  return [...byMerchant].map(([merchant, list]) => {
    const out = list.filter((r) => r.amount_cents < 0);
    const back = list.filter((r) => r.amount_cents > 0);
    const aliasCounts = new Map();
    for (const r of list) {
      const k = descKeys(r.description).exact;
      if (k) aliasCounts.set(k, (aliasCounts.get(k) ?? 0) + 1);
    }
    const dates = list.map((r) => r.posted_date).filter(Boolean).sort();
    return {
      merchant,
      count: list.length,
      first_seen: dates[0] ?? null,
      last_seen: dates.at(-1) ?? null,
      aliases: [...aliasCounts.entries()].sort((a, b) => b[1] - a[1]).map(([line, n]) => ({ line, n })),
      out: out.length ? { type: most(out.map((r) => r.txn_type)), category: most(out.map((r) => r.category_name)), n: out.length } : null,
      back: back.length ? { type: most(back.map((r) => r.txn_type)), category: most(back.map((r) => r.category_name)), n: back.length } : null,
    };
  }).sort((a, b) => b.count - a.count || a.merchant.localeCompare(b.merchant));
}
