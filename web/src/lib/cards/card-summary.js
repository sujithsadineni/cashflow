/**
 * The Cards page's category bar and totals box (D198), as plain data.
 * The API adds up each category (GET /transactions/category-summary);
 * this picks which buttons show and words the totals for the account
 * type. Money stays in cents. Pure: tested in card-summary.test.js.
 */

/** A category's key in the filter: its id, or 'none' for uncategorised rows. */
export const chipKey = (c) => (c.category_id == null ? 'none' : c.category_id);

/** In minus out: positive is money in on checking, a balance paid down on a card. */
export const netOf = (c) => c.in_cents - c.out_cents;

/**
 * How big a picked category is against the whole card (D203): its share
 * of all money in, or of all money out, whichever way it mostly goes.
 * "Salary is 91% of all money in on this account."
 * @returns { pct, direction: 'in' | 'out' } | null
 */
export function shareOf(category, total) {
  if (!category) return null;
  const net = netOf(category);
  const direction = net >= 0 ? 'in' : 'out';
  const whole = direction === 'in' ? total.in_cents : total.out_cents;
  const part = direction === 'in' ? category.in_cents : category.out_cents;
  if (!whole || !part) return null;
  return { pct: Math.round((part / whole) * 100), direction };
}

/**
 * The totals strip's three figures (the last is the net, set heavier). A card's balance is money owed, so its
 * words differ: money out is spent, money in is paid or credited back,
 * and the net is how much the amount owed went up or down.
 * @returns [{ label, cents, tone, net? }] — tone: 'spend' | 'earn' | 'ink'
 */
export function totalLines(total, accountType) {
  const net = total.in_cents - total.out_cents;
  if (accountType === 'CREDIT_CARD') {
    return [
      { label: 'Spent', cents: -total.out_cents, tone: 'spend' },
      { label: 'Paid & credits', cents: total.in_cents, tone: 'earn' },
      // Owed goes up when more was spent than paid: show that as +.
      { label: 'Owed change', cents: -net, tone: net < 0 ? 'spend' : net > 0 ? 'earn' : 'ink', net: true },
    ];
  }
  return [
    { label: 'In', cents: total.in_cents, tone: 'earn' },
    { label: 'Out', cents: -total.out_cents, tone: 'spend' },
    { label: 'Net', cents: net, tone: net < 0 ? 'spend' : net > 0 ? 'earn' : 'ink', net: true },
  ];
}
