/**
 * Review → Payments, as one to-do (D249): which statements to upload. A
 * card payment with no traced source and a bank card bill with no card
 * payment both come down to a statement that isn't in the app yet. Grouped
 * by account, with the months each one is missing and what uploading it
 * would clear. Pure; tested in uploads-needed.test.js.
 */

const monthOf = (date) => String(date).slice(0, 7);

/**
 * @param payments - review payments ({ posted_date, amount_cents, payment_source: { status, likely } })
 * @param cardBills - review card_bills ({ card, month, count, total_cents })
 * @returns [{ key, kind: 'bank'|'card'|'unknown', name, mask, months: ['2026-03', …], payments, bills, waiting, cents, items }]
 *   most to clear first; months newest first
 */
export function uploadsNeeded(payments = [], cardBills = []) {
  const groups = new Map();
  const group = (key, init) => {
    if (!groups.has(key)) groups.set(key, { key, months: new Set(), payments: 0, bills: 0, waiting: 0, cents: 0, items: [], ...init });
    return groups.get(key);
  };

  for (const p of payments) {
    const src = p.payment_source ?? {};
    if (src.status !== 'unverified' && src.status !== 'named') continue;
    const bank = src.likely;
    const g = bank
      ? group(`bank:${bank.account_id}`, { kind: 'bank', name: bank.account_name, mask: bank.mask, issuer: bank.issuer })
      : group('unknown', { kind: 'unknown', name: 'A bank account', mask: null, issuer: null });
    g.months.add(monthOf(p.posted_date));
    if (src.status === 'named') g.waiting++;
    else g.payments++;
    g.cents += Math.abs(p.amount_cents);
    g.items.push({ kind: src.status === 'named' ? 'waiting' : 'payment', date: p.posted_date, cents: p.amount_cents, account: p.account_name, mask: p.account_mask });
  }

  for (const b of cardBills) {
    // Pinned to one card, or only to an issuer whose cards it could be ("Zolve": either Zolve card).
    const names = [...new Set(b.candidates ?? [])];
    const g = b.card
      ? group(`card:${b.card.id}`, { kind: 'card', name: b.card.name, mask: b.card.mask, issuer: b.issuer ?? null })
      : group(`issuer:${b.issuer ?? names.join('|')}`, {
        kind: 'card',
        name: names.length === 1 ? names[0] : names.length > 1 ? names.join(' or ') : `A ${b.issuer ?? ''} card`.replace('  ', ' '),
        mask: null,
        issuer: b.issuer ?? null,
      });
    g.months.add(b.month);
    g.bills += b.count ?? 1;
    g.cents += Math.abs(b.total_cents ?? 0);
    g.items.push({ kind: 'bill', date: `${b.month}-01`, month: b.month, cents: -(b.total_cents ?? 0), count: b.count ?? 1 });
  }

  return [...groups.values()]
    .map((g) => ({ ...g, months: [...g.months].sort().reverse(), items: g.items.sort((a, b) => String(b.date).localeCompare(String(a.date))) }))
    .sort((a, b) => (b.payments + b.bills) - (a.payments + a.bills) || b.waiting - a.waiting || a.name.localeCompare(b.name));
}

/** "Mar 2026" from "2026-03". */
export const monthLabel = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
};
