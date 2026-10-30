/**
 * One year of a small Overview card, pure (D286): rows sorted into kinds,
 * by month, by account and in total, in the shape the web's shared explorer
 * reads (MoneyExplorer.jsx). Fees & Interest, Investment and To India build
 * on it; Cashback has its own (money/cashback.js), since part of its money
 * comes off statements rather than rows.
 *
 * @param rows - { id, account_id, posted_date 'YYYY-MM-DD', amount_cents, txn_type, description, merchant, category_name }
 * @param accounts - { id, name, issuer, mask, account_type, image_path, color }
 * @param kinds - every kind key, in order
 * @param kindOf - row => one of `kinds`
 * @param amountOf - row => the amount represented in the explorer totals (defaults to amount_cents)
 * @param uncounted - kinds shown but left out of the totals (Zelle between the household's own accounts)
 */
export function explorerYear({ rows, accounts, year, kinds, kindOf, amountOf = (r) => r.amount_cents, uncounted = [] }) {
  const blank = () => Object.fromEntries(kinds.map((k) => [k, 0]));
  const months = Array.from({ length: 12 }, (_, i) => ({ month: `${year}-${String(i + 1).padStart(2, '0')}`, ...blank(), total: 0 }));
  const cards = new Map();
  const items = [];
  for (const r of rows) {
    if (!r.posted_date.startsWith(year)) continue;
    const kind = kindOf(r);
    const amount = amountOf(r);
    const m = months[Number(r.posted_date.slice(5, 7)) - 1];
    m[kind] += amount;
    if (!uncounted.includes(kind)) m.total += amount;
    if (!cards.has(r.account_id)) {
      const a = accounts.find((x) => x.id === r.account_id) ?? {};
      cards.set(r.account_id, { account_id: r.account_id, name: a.name ?? null, issuer: a.issuer ?? null, mask: a.mask ?? null,
        account_type: a.account_type ?? null, image_path: a.image_path ?? null, color: a.color ?? null, total_cents: 0 });
    }
    cards.get(r.account_id).total_cents += amount;
    items.push({ ...r, kind, measure_cents: amount });
  }
  const by_kind = blank();
  for (const m of months) for (const k of kinds) by_kind[k] += m[k];
  return {
    year: Number(year),
    total_cents: months.reduce((a, m) => a + m.total, 0),
    by_kind,
    months,
    cards: [...cards.values()].sort((a, b) => Math.abs(b.total_cents) - Math.abs(a.total_cents)),
    items: items.sort((a, b) => b.posted_date.localeCompare(a.posted_date) || a.amount_cents - b.amount_cents),
  };
}

/**
 * The response every explorer endpoint sends: the year, the year before to
 * the same month, how far into the year it is, and which years have any.
 * `build(year)` returns explorerYear's shape.
 */
export function explorerResponse({ year, build, dates, today = new Date() }) {
  const current = build(year);
  const before = build(String(Number(year) - 1));
  const through = Number(year) === today.getFullYear() ? today.getMonth() + 1 : 12;
  return {
    ...current,
    through_month: through,
    previous_year: { year: before.year, total_cents: before.total_cents, to_date_cents: before.months.slice(0, through).reduce((a, m) => a + m.total, 0) },
    years: [...new Set(dates.map((d) => Number(d.slice(0, 4))))].sort((a, b) => b - a),
  };
}
