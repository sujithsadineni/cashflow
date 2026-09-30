/**
 * Suggests a category for a freshly-parsed row using the household's
 * own transaction history — never a model call, never a guess without
 * real evidence, same reasoning as merchant-review.js and
 * parse/bilt-rent.js: this app already has the answer sitting in its
 * own data, so asking an LLM (or leaving it blank) would be strictly
 * worse than just looking it up.
 *
 * Two tiers, both requiring an EXACT match against real history,
 * never fuzzy — a wrong category is worse than a blank one:
 *
 *   1. merchant + txn_type — the strongest signal, once the local
 *      parser (or the AI path) has already cleaned a merchant name.
 *      Scoped by txn_type too, not just merchant, because the same
 *      merchant can mean two different things: a Costco *purchase* is
 *      "Costco", a Costco *refund* is "Refund" — confirmed against
 *      real household data, not assumed.
 *   2. normalized full description — the fallback for a row with no
 *      merchant yet, which the local parser leaves genuinely often
 *      (it only cleans a small, known set of names on purpose, see
 *      local-merchants.js). An online-only merchant's printed
 *      description rarely varies between statements ("WWW.KOHLS.COM
 *      #1234 OH" every time) — an EXACT normalized match on the whole
 *      line is still real repeated evidence, not a coincidence, and
 *      is why this doesn't try to substring-match a store-numbered,
 *      city-varying description like a Costco purchase's.
 *
 * A merchant or description never seen before returns nothing —
 * there's nothing to base a suggestion on.
 */

const normalizeDescription = (s) =>
  (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Picks the most common category per key; ties broken by category name so the result is deterministic. */
function pickBestPerKey(rows, keyFn) {
  const byKey = new Map(); // key -> Map(category_name -> count)
  for (const row of rows) {
    const key = keyFn(row);
    if (!byKey.has(key)) byKey.set(key, new Map());
    const counts = byKey.get(key);
    counts.set(row.category_name, (counts.get(row.category_name) ?? 0) + row.count);
  }
  const best = new Map();
  for (const [key, counts] of byKey) {
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    // A tie for first place means the household itself categorized
    // this exact merchant/description two different ways in the past
    // (a real case: "ATM PAYMENT ANYTOWN NC" once as Cash Deposit, once
    // as Card Payment) — genuinely ambiguous evidence, not a clear
    // signal, so this skips it rather than picking one arbitrarily.
    // Same rule as everywhere else in this pass: no guess beats a
    // confident-looking wrong one.
    if (sorted.length > 1 && sorted[0][1] === sorted[1][1]) continue;
    best.set(key, sorted[0][0]);
  }
  return best;
}

/**
 * @param rows - staged/parsed rows, each { merchant, description, txn_type }
 * @param client - a db client/pool with .query()
 * Returns a Map from the row's array index to a suggested category name.
 */
export async function suggestHistoricalCategories(rows, client) {
  const suggestions = new Map();

  const withMerchant = rows
    .map((r, i) => ({ ...r, index: i }))
    .filter((r) => r.merchant);
  const merchants = [...new Set(withMerchant.map((r) => r.merchant))];

  const withoutMerchant = rows
    .map((r, i) => ({ ...r, index: i }))
    .filter((r) => !r.merchant && r.description);
  const normDescriptions = [...new Set(withoutMerchant.map((r) => normalizeDescription(r.description)))];

  const [byMerchant, byDescription] = await Promise.all([
    merchants.length === 0
      ? { rows: [] }
      : client.query(
          `SELECT merchant, txn_type, c.name AS category_name, COUNT(*)::int AS count
             FROM transaction t
             JOIN category c ON c.id = t.category_id
            WHERE t.merchant = ANY($1)
            GROUP BY t.merchant, t.txn_type, c.name`,
          [merchants]
        ),
    normDescriptions.length === 0
      ? { rows: [] }
      : client.query(
          `SELECT lower(regexp_replace(t.description, '[^a-zA-Z0-9]+', ' ', 'g')) AS norm_desc,
                  c.name AS category_name, COUNT(*)::int AS count
             FROM transaction t
             JOIN category c ON c.id = t.category_id
            WHERE lower(regexp_replace(t.description, '[^a-zA-Z0-9]+', ' ', 'g')) = ANY($1)
            GROUP BY norm_desc, c.name`,
          [normDescriptions]
        ),
  ]);

  const bestByMerchant = pickBestPerKey(byMerchant.rows, (r) => `${r.merchant}|${r.txn_type}`);
  const bestByDescription = pickBestPerKey(
    byDescription.rows.map((r) => ({ ...r })),
    (r) => r.norm_desc
  );

  for (const row of withMerchant) {
    const category = bestByMerchant.get(`${row.merchant}|${row.txn_type}`);
    if (category) suggestions.set(row.index, category);
  }
  for (const row of withoutMerchant) {
    if (suggestions.has(row.index)) continue;
    const category = bestByDescription.get(normalizeDescription(row.description));
    if (category) suggestions.set(row.index, category);
  }

  return suggestions;
}
