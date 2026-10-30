/**
 * The gift card form's rules (D330), kept out of the component so they can
 * be tested. Money stays in cents: a field shows cents from their digits
 * (centsToInput) and is read back with dollarsToCents. Pure.
 */

import { dollarsToCents } from '../../api.js';
import { centsToInput } from '../loans/loan-edit.js';

/** Today in the browser's time zone, 'YYYY-MM-DD'. */
export const localToday = (now = new Date()) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

/** A gift card as the form holds it: strings throughout. `costIn` is 'dollars' or 'points'. */
export const giftCardForm = (g, today = localToday()) => ({
  account_id: g?.account_id != null ? String(g.account_id) : '',
  redeemed_on: g?.redeemed_on ?? today,
  brand: g?.brand ?? '',
  value: centsToInput(g?.value_cents),
  costIn: g?.points_used != null && g?.rewards_used_cents == null ? 'points' : 'dollars',
  cost: g?.points_used != null && g?.rewards_used_cents == null ? String(g.points_used) : centsToInput(g?.rewards_used_cents),
  note: g?.note ?? '',
});

/**
 * The form as the API wants it, or { error, field } for the first thing
 * missing. What it cost is optional, in dollars or points, never both.
 */
export function giftCardBody(form) {
  if (!form.account_id) return { error: 'Pick the card the rewards came from', field: 'account_id' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.redeemed_on)) return { error: 'Pick the day you got it', field: 'redeemed_on' };
  if (!form.brand.trim()) return { error: 'Name the gift card', field: 'brand' };
  const value = dollarsToCents(form.value);
  if (!(value > 0)) return { error: 'What is the gift card worth?', field: 'value' };
  const cost = form.cost.trim();
  let rewards_used_cents = null;
  let points_used = null;
  if (cost && form.costIn === 'dollars') {
    rewards_used_cents = dollarsToCents(cost);
    if (!(rewards_used_cents > 0)) return { error: 'Rewards used is an amount, like 20.00', field: 'cost' };
  }
  if (cost && form.costIn === 'points') {
    points_used = Number(cost.replace(/[, ]/g, ''));
    if (!Number.isInteger(points_used) || points_used <= 0) return { error: 'Points used is a whole number', field: 'cost' };
  }
  return {
    body: {
      account_id: Number(form.account_id), redeemed_on: form.redeemed_on, brand: form.brand.trim(),
      value_cents: value, rewards_used_cents, points_used, note: form.note.trim() || null,
    },
  };
}

/** What the gift card cost, and what it brought in on top: the line under its name. */
export function giftCardSub(g) {
  const pts = g.points_used != null ? `${g.points_used.toLocaleString('en-US')} points` : null;
  if (g.rewards_used_cents != null) {
    const extra = g.value_cents - g.rewards_used_cents;
    return { cost_cents: g.rewards_used_cents, points: pts, extra_cents: extra };
  }
  return { cost_cents: null, points: pts, extra_cents: null };
}
