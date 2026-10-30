/**
 * Two card alerts read off the newest statements (D361, the owner's ask after
 * the Robinhood Gold bill went unmentioned): a card using 30% or more of its
 * limit, and a card whose new charges are twice its usual or more. Pure;
 * tested in card-alerts.test.js; alerts.js does the reading and keeping.
 */

/** 30%: the share of a limit credit scores start to count against (the owner's pick over 50%). */
export const HIGH_USE_PCT = 30;
/** Twice the usual, and at least $200, so a quiet card's $40 month isn't news. */
export const SPEND_JUMP_RATIO = 2;
export const SPEND_JUMP_MIN_CENTS = 20000;
/** The usual: the average of up to three statements before; one is enough for a new card (Robinhood Gold's second statement). */
export const USUAL_OF = 3;

/**
 * Cards at or over HIGH_USE_PCT of their limit on their newest statement:
 * the limit it printed, else the one the household set (D354: Apple).
 * @param cards [{ account_id, account_name, mask, period_end, closing_balance_cents, credit_limit_cents, credit_limit_manual_cents }]
 * @returns [{ account_id, account_name, mask, period_end, used_cents, limit_cents, pct, manual }]
 */
export function highUse(cards) {
  const out = [];
  for (const c of cards) {
    const printed = c.credit_limit_cents == null ? null : Number(c.credit_limit_cents);
    const limit = printed ?? (c.credit_limit_manual_cents == null ? null : Number(c.credit_limit_manual_cents));
    const used = Math.max(0, Number(c.closing_balance_cents ?? 0));
    if (!limit || limit <= 0 || used === 0) continue;
    const pct = Math.round((100 * used) / limit);
    if (pct < HIGH_USE_PCT) continue;
    out.push({ account_id: c.account_id, account_name: c.account_name, mask: c.mask, period_end: c.period_end, used_cents: used, limit_cents: limit, pct, manual: printed == null });
  }
  return out.sort((a, b) => b.pct - a.pct);
}

/**
 * Cards whose newest statement's new charges are SPEND_JUMP_RATIO times their
 * usual or more. Totals print as sizes either way round (some readers store
 * spend negative), so sizes are compared.
 * @param cards [{ account_id, account_name, mask, period_end, spend_cents, earlier: [spend_cents, …] newest first }]
 * @returns [{ account_id, account_name, mask, period_end, spend_cents, usual_cents, ratio }]
 */
export function spendJumps(cards) {
  const out = [];
  for (const c of cards) {
    const spend = Math.abs(Number(c.spend_cents ?? 0));
    const earlier = (c.earlier ?? []).slice(0, USUAL_OF).filter((x) => x != null).map((x) => Math.abs(Number(x)));
    if (earlier.length < 1 || spend < SPEND_JUMP_MIN_CENTS) continue;
    const usual = Math.round(earlier.reduce((t, x) => t + x, 0) / earlier.length);
    if (usual <= 0 || spend < usual * SPEND_JUMP_RATIO) continue;
    out.push({ account_id: c.account_id, account_name: c.account_name, mask: c.mask, period_end: c.period_end, spend_cents: spend, usual_cents: usual, ratio: Math.round((spend / usual) * 10) / 10 });
  }
  return out.sort((a, b) => b.ratio - a.ratio);
}
