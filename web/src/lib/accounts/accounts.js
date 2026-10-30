/**
 * Settings → Accounts (D297): the words and rules behind the split view,
 * kept out of the components so they can be tested. Pure: no fetching, no
 * React. Tested in accounts.test.js.
 */

import { formatMoney } from '../../api.js';
import { bankBrandFor } from '../cards/bankBrands.js';
import { centsToInput } from '../loans/loan-edit.js';
import { dollarsToCents } from '../../api.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (iso) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;

export const isCard = (a) => a.account_type === 'CREDIT_CARD';
const holdsBalance = (a) => a.account_type === 'SAVINGS' || a.account_type === 'INVESTMENT';

/** Cards, then bank accounts; a group with nothing in it isn't shown. */
export function groupAccounts(accounts) {
  return [
    { key: 'cards', label: 'Cards', rows: accounts.filter(isCard) },
    { key: 'banks', label: 'Bank accounts', rows: accounts.filter((a) => !isCard(a)) },
  ].filter((g) => g.rows.length > 0);
}

/** One person's accounts, or everyone's for null. */
export const forPerson = (accounts, personId) =>
  (personId == null ? accounts : accounts.filter((a) => a.person_id === personId));

/**
 * The one thing a row says on its trailing edge, or null: where a card's
 * newest bill stands, or a savings balance. Short on purpose; the detail
 * says the rest. Tone is a token name: spend, warn, earn or muted.
 */
export function rowStatus(account) {
  if (isCard(account)) {
    const due = account.payment_due;
    if (!due) return null;
    const when = due.due_date ? shortDate(due.due_date) : null;
    switch (due.status) {
      case 'overdue': return { text: 'Overdue', tone: 'spend' };
      case 'due_soon': return { text: due.days_left === 0 ? 'Due today' : `Due ${when}`, tone: 'warn' };
      case 'due': return { text: `Due ${when}`, tone: 'muted' };
      case 'unconfirmed': return { text: 'Paid?', tone: 'warn' };
      case 'minimum_paid': return { text: 'Minimum paid', tone: 'warn' };
      case 'paid': return { text: 'Paid', tone: 'earn' };
      default: return null;
    }
  }
  if (holdsBalance(account) && account.balance_cents != null) {
    return { text: formatMoney(Number(account.balance_cents)), tone: 'muted' };
  }
  return null;
}

/** "Last activity Oct 7", "No activity yet". */
export function lastActivity(account) {
  return account.last_posted ? `Last activity ${shortDate(account.last_posted)}` : 'No activity yet';
}

/**
 * Issuers to choose from: every one on file, each bank under one spelling
 * ("BOFA" and "Bank of America" are one choice), alphabetical.
 */
export function issuerChoices(accounts) {
  const byKey = new Map();
  for (const a of accounts) {
    const key = issuerKey(a.issuer);
    if (key && !byKey.has(key)) byKey.set(key, bankBrandFor(a.issuer)?.name ?? a.issuer.trim());
  }
  return [...byKey.values()].sort((x, y) => x.localeCompare(y));
}

/** One key per bank however it's spelled: a known brand's key, else the lowercased name. */
const issuerKey = (issuer) => (issuer?.trim() ? bankBrandFor(issuer)?.key ?? issuer.trim().toLowerCase() : null);
const sameName = (a, b) => a.name.trim().toLowerCase() === b.name.trim().toLowerCase();

/**
 * Other accounts that look like this one: the same last four and either the
 * same name or the same issuer. Usually a card reopened as a new account
 * while the old one stays closed.
 */
export function lookAlikes(account, all) {
  if (!account.mask) return [];
  const issuer = issuerKey(account.issuer);
  return all.filter((b) => b.id !== account.id && b.mask === account.mask
    && (sameName(account, b) || (issuer != null && issuerKey(b.issuer) === issuer)));
}

/* ------------------------------------------------------------------
   The edit form: what it holds, what's wrong with it, what changed
   ------------------------------------------------------------------ */

/** An account's editable fields as the form holds them: strings, and status for is_active. */
export const formOf = (a) => ({
  person_id: String(a.person_id ?? ''),
  name: a.name ?? '',
  nickname: a.nickname ?? '',
  issuer: a.issuer ?? '',
  account_type: a.account_type,
  mask: a.mask ?? '',
  holder_name: a.holder_name ?? '',
  closing_day: a.closing_day == null ? '' : String(a.closing_day),
  due_day: a.due_day == null ? '' : String(a.due_day),
  // A limit set by hand for a card whose statements print none (D354), in dollars as typed.
  credit_limit_manual: centsToInput(a.credit_limit_manual_cents),
  // The card's payment network set by hand (D416); '' is automatic, its product's.
  network: a.network ?? '',
  status: a.is_active === false ? 'closed' : 'active',
});

export const dayValid = (v) => v.trim() === '' || (/^\d{1,2}$/.test(v.trim()) && Number(v) >= 1 && Number(v) <= 31);
export const maskValid = (v) => v.trim() === '' || /^\d{4}$/.test(v.trim());

/** What's wrong with the form, field by field, as it's typed. Empty when it can be saved. */
export function problemsOf(form) {
  const out = {};
  if (!form.name.trim()) out.name = 'Give it a name';
  if (!maskValid(form.mask)) out.mask = 'Exactly 4 digits';
  if ((form.nickname ?? '').trim().length > 24) out.nickname = 'Keep it to 24 characters';
  const limit = (form.credit_limit_manual ?? '').trim();
  if (limit !== '' && !(dollarsToCents(limit) > 0)) out.credit_limit_manual = 'A dollar amount, like 5,000';
  if (form.closing_day != null && !dayValid(form.closing_day)) out.closing_day = 'A day from 1 to 31';
  if (form.due_day != null && !dayValid(form.due_day)) out.due_day = 'A day from 1 to 31';
  return out;
}

/** Only what changed, in the API's shape, so the audit log records just those fields. */
export function changesOf(before, after) {
  const out = {};
  for (const key of ['person_id', 'name', 'nickname', 'issuer', 'account_type', 'mask', 'holder_name']) {
    if ((after[key] ?? '').trim() !== (before[key] ?? '').trim()) out[key] = key === 'person_id' ? Number(after[key]) : after[key].trim();
  }
  // A card's days (D270): blank clears it, so the next statement can set it again.
  for (const key of ['closing_day', 'due_day']) {
    if (after[key].trim() !== before[key].trim()) out[key] = after[key].trim() === '' ? null : Number(after[key]);
  }
  // Blank clears it (D354).
  const limitOf = (f) => (f.credit_limit_manual ?? '').trim();
  if (limitOf(after) !== limitOf(before)) out.credit_limit_manual_cents = limitOf(after) === '' ? null : dollarsToCents(limitOf(after));
  if ((after.network ?? '') !== (before.network ?? '')) out.network = after.network || null;
  if (after.status !== before.status) out.is_active = after.status === 'active';
  return out;
}
