/**
 * Money back, counted when it's received (D283).
 *
 * Cards report rewards two ways. Most hold them as a balance (BofA, Samsung,
 * Amex) and pay out when redeemed: "CASH REWARDS STATEMENT CREDIT", "YOUR CASH
 * REWARD/REFUND IS". Apple pays Daily Cash out at once to Apple Cash, so its
 * printed "Total Daily Cash to account" is money received the day it's earned,
 * and its "Daily Cash redemption" is Apple Cash being spent on the card.
 *
 * Adding a card's printed "earned" to its later redemption counted the same
 * money twice ($273.48 in 2026, $256.73 in 2023). So: a card that holds a
 * balance counts its redemptions; a card that pays out at once counts its
 * printed figure and not its redemptions. Printed "earned" on a card that holds
 * a balance isn't lost: its latest printed balance, less what was paid out
 * after the day it stood, is shown as waiting.
 *
 * Offers and statement credits (Amex Offers, the Disney credit, BankAmeriDeals),
 * bank bonuses, and Apple's Daily Cash clawbacks on a return always count.
 *
 * Rewards taken as a gift card (D330, entered by hand: no statement shows
 * them) count the gift card's value on the day it was received. What it
 * cost in reward dollars comes off the card's waiting balance when the
 * gift card is newer than the balance printed.
 */

import { STATEMENT_CASHBACK_SQL } from './flat-cashback.js';

// The card paying out rewards it was holding. POSIX-compatible, so SQL can use the same text.
export const REDEEMED_SOURCE =
  'CASH REWARD/REFUND|Redeem Cash Back|CASH REWARDS STATEMENT CREDIT|CASH REWARDS - STMT CRD|DES:CASHREWARD|Daily Cash redemption|Rewards Redemption';
const REDEEMED = new RegExp(REDEEMED_SOURCE, 'i');
const CLAWBACK = /Daily Cash Adjustment/i;
const BONUS = /\bBonus\b|For New Checking/i;

/** What kind of money back a cashback row is: 'rewards' | 'offer' | 'bonus' | 'clawback'. */
export function cashbackKind(description) {
  const d = description ?? '';
  if (REDEEMED.test(d)) return 'rewards';
  if (CLAWBACK.test(d)) return 'clawback';
  if (BONUS.test(d)) return 'bonus';
  return 'offer';
}

/**
 * Accounts that pay rewards out at once: they print an amount earned, and
 * never a rewards balance. A card with a flat rate (D330) is one too: its
 * earned is worked out per statement. As SQL, for the summary queries.
 */
export const PAID_OUT_ACCOUNTS_SQL = `(SELECT account_id FROM statement GROUP BY account_id
   HAVING COUNT(cashback_earned_cents) > 0 AND COUNT(cashback_balance_cents) = 0
   UNION SELECT id FROM account WHERE cashback_rate_bps IS NOT NULL)`;

/**
 * Money back that isn't a transaction, dated when it's received: a paid-out
 * card's statement figure (printed, or worked out at a flat rate) on its
 * closing day, and a gift card (D330) on the day it came. Columns
 * account_id, period_end, cashback_earned_cents, so the Overview queries
 * sum it the way they summed statements.
 */
export const OFF_LEDGER_CASHBACK_SQL = `(SELECT account_id, period_end, cashback_earned_cents
     FROM ${STATEMENT_CASHBACK_SQL} st WHERE account_id IN ${PAID_OUT_ACCOUNTS_SQL}
   UNION ALL
   SELECT account_id, redeemed_on, value_cents FROM reward_redemption WHERE voided_at IS NULL)`;

/** A redemption on a paid-out card: the same money as its printed figure. `t` is the transaction alias. */
export const SPENT_PAYOUT_SQL = `(t.description ~* '${REDEEMED_SOURCE}' AND t.account_id IN ${PAID_OUT_ACCOUNTS_SQL})`;

/**
 * The year's money back, from the ledger's cashback rows and statements.
 * Pure, so it's tested without a database.
 *
 * @param rows - cashback rows: { id, account_id, posted_date 'YYYY-MM-DD', amount_cents, description, merchant }
 * @param statements - { id, account_id, period_end 'YYYY-MM-DD', cashback_earned_cents, cashback_balance_cents, cashback_balance_as_of?, calculated?, rate_bps? }
 * @param interest - interest earned rows: { id, account_id, posted_date, amount_cents, description, merchant }
 * @param accounts - { id, name, issuer, mask, account_type, image_path, color }
 * @param redemptions - gift cards (D330): { id, account_id, redeemed_on, brand, value_cents, rewards_used_cents, points_used, note }
 * @param year - 'YYYY'
 */
export function cashbackYear({ rows, statements, interest, accounts, redemptions = [], year }) {
  const paidOut = new Set();
  const byAccount = Map.groupBy(statements, (s) => s.account_id);
  for (const [id, list] of byAccount) {
    if (list.some((s) => s.cashback_earned_cents != null) && list.every((s) => s.cashback_balance_cents == null)) paidOut.add(id);
  }
  const inYear = (date) => date.startsWith(year);
  const month = (date) => Number(date.slice(5, 7));

  const months = Array.from({ length: 12 }, (_, i) => ({ month: `${year}-${String(i + 1).padStart(2, '0')}`, rewards: 0, offer: 0, bonus: 0, interest: 0, clawback: 0, giftcard: 0, total: 0 }));
  const cards = new Map();
  const card = (id) => {
    if (!cards.has(id)) {
      const a = accounts.find((x) => x.id === id) ?? {};
      cards.set(id, { account_id: id, name: a.name ?? null, issuer: a.issuer ?? null, mask: a.mask ?? null, account_type: a.account_type ?? null,
        image_path: a.image_path ?? null, color: a.color ?? null,
        received_cents: 0, rewards: 0, offer: 0, bonus: 0, interest: 0, clawback: 0, giftcard: 0, count: 0, waiting_cents: null, waiting_as_of: null, how: null });
    }
    return cards.get(id);
  };
  const add = (accountId, date, kind, cents) => {
    const m = months[month(date) - 1];
    m[kind] += cents;
    m.total += cents;
    const c = card(accountId);
    c[kind] += cents;
    c.received_cents += cents;
  };

  const items = [];
  for (const r of rows) {
    const kind = cashbackKind(r.description);
    const spent = kind === 'rewards' && paidOut.has(r.account_id);
    if (!inYear(r.posted_date) || spent) continue;
    add(r.account_id, r.posted_date, kind, r.amount_cents);
    card(r.account_id).count += 1;
    items.push({ ...r, kind });
  }
  for (const s of statements) {
    if (!paidOut.has(s.account_id) || s.cashback_earned_cents == null || !inYear(s.period_end)) continue;
    add(s.account_id, s.period_end, 'rewards', s.cashback_earned_cents);
    card(s.account_id).count += 1;
    // Not a transaction: read off the statement, so it has no row to open.
    items.push({ id: `statement-${s.id}`, statement_id: s.id, account_id: s.account_id, posted_date: s.period_end, amount_cents: s.cashback_earned_cents, kind: 'rewards', source: 'statement',
      ...(s.calculated && { calculated: true, rate_bps: s.rate_bps }) });
  }
  for (const r of interest) {
    if (!inYear(r.posted_date) || r.amount_cents <= 0) continue;
    add(r.account_id, r.posted_date, 'interest', r.amount_cents);
    items.push({ ...r, kind: 'interest' });
  }

  for (const r of redemptions) {
    if (!inYear(r.redeemed_on)) continue;
    add(r.account_id, r.redeemed_on, 'giftcard', r.value_cents);
    card(r.account_id).count += 1;
    items.push({ ...r, id: `redemption-${r.id}`, redemption_id: r.id, posted_date: r.redeemed_on, amount_cents: r.value_cents, kind: 'giftcard', source: 'redemption' });
  }

  // What's still held on each card: its newest statement's printed balance, if it prints one,
  // less the reward dollars a gift card took after the day it stood (D330). Amex prints its
  // balance as of the previous closing date (D331), and a payout ("YOUR CASH REWARD/REFUND IS")
  // after that day is still in it, so it comes off too. Not on a balance as of the closing date
  // (BofA): a redemption leaves it at once, and its credit can post the day after.
  const yearEnd = `${year}-12-31`;
  for (const [id, list] of byAccount) {
    if (paidOut.has(id)) continue;
    const newest = list.filter((s) => s.period_end <= yearEnd).sort((a, b) => b.period_end.localeCompare(a.period_end))[0];
    const printed = list.filter((s) => s.cashback_balance_cents != null && s.period_end <= yearEnd)
      .sort((a, b) => b.period_end.localeCompare(a.period_end))[0];
    if (!printed || printed.cashback_balance_cents <= 0) continue;
    const asOf = printed.cashback_balance_as_of ?? printed.period_end;
    const after = (date) => date > asOf && date <= yearEnd;
    const paid = printed.cashback_balance_as_of == null ? 0 : rows
      .filter((r) => r.account_id === id && cashbackKind(r.description) === 'rewards' && after(r.posted_date))
      .reduce((a, r) => a + r.amount_cents, 0);
    const spent = redemptions
      .filter((r) => r.account_id === id && after(r.redeemed_on))
      .reduce((a, r) => a + (r.rewards_used_cents ?? 0), 0);
    if (printed.cashback_balance_cents - paid - spent <= 0) continue;
    const c = card(id);
    c.waiting_cents = printed.cashback_balance_cents - paid - spent;
    c.waiting_as_of = asOf;
    c.waiting_paid_since_cents = paid + spent;
    c.waiting_stale = newest.period_end !== printed.period_end;
  }
  for (const c of cards.values()) c.how = paidOut.has(c.account_id) ? 'paid_out' : 'redeemed';

  const sum = (k) => months.reduce((a, m) => a + m[k], 0);
  return {
    year: Number(year),
    total_cents: sum('total'),
    by_kind: { rewards: sum('rewards'), offer: sum('offer'), bonus: sum('bonus'), interest: sum('interest'), clawback: sum('clawback'), giftcard: sum('giftcard') },
    months,
    cards: [...cards.values()].filter((c) => c.received_cents !== 0 || c.waiting_cents)
      .sort((a, b) => b.received_cents - a.received_cents || (b.waiting_cents ?? 0) - (a.waiting_cents ?? 0)),
    waiting_cents: [...cards.values()].reduce((a, c) => a + (c.waiting_cents ?? 0), 0),
    items: items.sort((a, b) => b.posted_date.localeCompare(a.posted_date) || b.amount_cents - a.amount_cents),
  };
}
