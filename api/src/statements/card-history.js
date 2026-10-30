/**
 * An account's cards over time (D275), read off its statements: each run
 * of statements printed with the same last 4 and product is one card.
 * A reissue (expired or lost) changes the last 4; an upgrade changes the
 * product too. Pure: tested in card-history.test.js.
 *
 * statements: [{ period_end: 'YYYY-MM-DD', card_mask, product_name }], any order
 * Returns [{ mask, product, from, to }] oldest first, `from`/`to` the first
 * and last statement's closing date; [] when the account has had one card.
 */
export function cardHistory(statements) {
  const runs = [];
  for (const s of [...statements].filter((x) => x.card_mask).sort((a, b) => a.period_end.localeCompare(b.period_end))) {
    const last = runs.at(-1);
    const product = s.product_name ?? last?.product ?? null;
    if (last && last.mask === s.card_mask && last.product === product) last.to = s.period_end;
    else runs.push({ mask: s.card_mask, product, from: s.period_end, to: s.period_end });
  }
  return runs.length > 1 ? runs : [];
}
