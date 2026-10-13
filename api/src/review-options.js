/**
 * Ranked choices for a Review finding (D249), so fixing a row is a tap on
 * a likely answer instead of a hunt through a list. recheck.js only
 * suggests when 3+ rows from the same merchant agree; a merchant seen
 * once got no suggestion at all, which was most of the queue.
 *
 * Every option says why it's offered. Nothing here decides: a person
 * still picks, and the pick is saved and becomes history (D175).
 *
 * Pure: rows in, options out. Tested in review-options.test.js.
 */

import { inflowType } from './inflow-type.js';
import { ZELLE_TXN_TYPE, CATEGORY_TYPES } from './recheck.js';

const MAX = 4;

/**
 * Type options for one transaction, from what the money did: out or in,
 * on a card or a bank, Zelle or not.
 * @param t - { amount_cents, account_type, description, zelle_type }
 * @param suggested - recheck's history-based suggestion, if it had one
 */
export function typeOptions(t, suggested = null) {
  const out = [];
  const add = (value, why) => { if (value && !out.some((o) => o.value === value)) out.push({ value, why }); };
  const card = t.account_type === 'CREDIT_CARD';

  add(suggested, 'What this merchant usually gets');
  if (t.zelle_type && ZELLE_TXN_TYPE[t.zelle_type]) add(ZELLE_TXN_TYPE[t.zelle_type], 'Zelle, by who it went to');
  if (t.amount_cents < 0) {
    add('purchase', card ? 'Money out on a card' : 'Money out');
    if (card) { add('fee', 'A charge from the card itself'); add('interest', 'Interest the card charged'); }
    else { add('transfer', 'Moved to another of your accounts'); add('payment', 'Paid a card or a loan'); }
  } else if (t.amount_cents > 0) {
    const back = inflowType(t.description);
    add(back, back === 'cashback' ? 'Reads like a card reward' : 'Money back from a merchant');
    if (card) add('payment', 'A payment to this card');
    else { add('deposit', 'Money received'); add('transfer', 'From another of your accounts'); }
  }
  return out.slice(0, MAX);
}

// Words that say nothing about what was bought.
const STOP = new Set([
  'aplpay', 'apple', 'pay', 'pos', 'purchase', 'debit', 'credit', 'card', 'visa', 'mastercard', 'llc', 'inc', 'ltd', 'corp',
  'the', 'and', 'www', 'com', 'net', 'org', 'store', 'shop', 'online', 'payment', 'recurring', 'tst', 'sqsp', 'paypal',
  'usa', 'intl', 'international', 'checkcard', 'withdrawal', 'deposit', 'ach', 'web', 'mobile',
]);

export const wordsOf = (t) =>
  [...new Set(
    String(t.merchant || t.description || '')
      .toLowerCase()
      .replace(/[^a-z]+/g, ' ')
      .split(' ')
      .filter((w) => w.length >= 3 && !STOP.has(w))
      // The name comes first on a statement line; a Zelle memo or a city after it says less.
      .slice(0, 4)
  )];

/** Who a row is: its merchant name, else the first two words of its line. */
export const merchantKey = (t) =>
  t.merchant ? `m:${t.merchant.toLowerCase().trim()}` : `d:${wordsOf(t).slice(0, 2).join(' ')}`;

/**
 * An index over every labelled transaction, built once per request.
 * @param rows - { id, merchant, description, category_name, txn_type }
 */
export function buildCategoryIndex(rows) {
  const labelled = rows.filter((r) => r.category_name);
  const byWord = new Map(); // word -> { n, cats: Map(category -> { n, example }) }
  const byType = new Map(); // txn_type -> Map(category -> n)
  const byMerchant = new Map(); // merchantKey -> Map(category -> { n, ids })
  // Towns: a word that ends the printed line for 3+ different merchants
  // ("… RIVERTON", "… LAKEVIEW") names a place, not what was bought.
  const lastWordOf = new Map(); // word -> Set(merchantKey)
  for (const r of rows) {
    // The last long word: a trailing state code ("… LAKEVIEW NC") doesn't count.
    const last = String(r.description ?? '').toLowerCase().replace(/[^a-z]+/g, ' ').trim().split(' ').filter((w) => w.length >= 3).at(-1);
    if (last) {
      if (!lastWordOf.has(last)) lastWordOf.set(last, new Set());
      lastWordOf.get(last).add(merchantKey(r));
    }
  }
  const places = new Set([...lastWordOf].filter(([, keys]) => keys.size >= 3).map(([w]) => w));
  for (const r of labelled) {
    const mk = merchantKey(r);
    if (mk.length > 2) {
      if (!byMerchant.has(mk)) byMerchant.set(mk, new Map());
      const m = byMerchant.get(mk).get(r.category_name) ?? { n: 0, ids: new Set() };
      m.n++;
      m.ids.add(r.id);
      byMerchant.get(mk).set(r.category_name, m);
    }
    for (const w of wordsOf(r)) {
      if (!byWord.has(w)) byWord.set(w, { n: 0, cats: new Map() });
      const entry = byWord.get(w);
      entry.n++;
      const c = entry.cats.get(r.category_name) ?? { n: 0, example: r.merchant || r.description, id: r.id };
      c.n++;
      entry.cats.set(r.category_name, c);
    }
    const type = r.txn_type ?? '';
    if (!byType.has(type)) byType.set(type, new Map());
    byType.get(type).set(r.category_name, (byType.get(type).get(r.category_name) ?? 0) + 1);
  }
  return { byWord, byType, byMerchant, places, total: labelled.length };
}

const short = (text) => { const s = String(text).replace(/\s+/g, ' ').trim(); return s.length > 32 ? `${s.slice(0, 31)}…` : s; };

const TYPE_WORD = { purchase: 'purchases', refund: 'refunds', deposit: 'deposits', transfer: 'transfers', payment: 'payments', fee: 'fees', interest: 'interest', cashback: 'cashback', savings: 'savings' };

/**
 * Category options for one transaction, strongest evidence first:
 *   1. the same merchant's other rows, even just one ("Like your other Ross rows");
 *   2. rows that share its rarer words ("Like Biryani N Bowl"); a word seen
 *      once is a coincidence and one spread over many categories (a city)
 *      says nothing, so neither votes;
 *   3. the categories most used for its type.
 * A category that contradicts the row's type (Card Payment for a purchase,
 * by recheck's CATEGORY_TYPES) is never offered.
 * @param t - { id, merchant, description, txn_type, amount_cents }
 * @param valid - category names that exist now (never a deleted one)
 */
export function categoryOptions(t, index, { suggested = null, valid = null } = {}) {
  const type = t.txn_type ?? (t.amount_cents < 0 ? 'purchase' : null);
  const fits = (cat) => !type || !CATEGORY_TYPES[cat] || CATEGORY_TYPES[cat].includes(type);
  const out = [];
  // Uncategorized is the absence of an answer, never one to offer.
  const add = (value, why) => {
    if (value && value !== 'Uncategorized' && (!valid || valid.has(value)) && fits(value) && !out.some((o) => o.value === value)) out.push({ value, why });
  };
  add(suggested, 'What this merchant usually gets');

  // 1. The same merchant, leaving this row out.
  const same = index.byMerchant.get(merchantKey(t));
  if (same) {
    [...same.entries()]
      .map(([cat, m]) => [cat, m.n - (m.ids.has(t.id) ? 1 : 0)])
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1])
      .forEach(([cat, n]) => add(cat, n === 1 ? 'Like your other row from here' : `Like your other ${n} rows from here`));
  }

  // 2. Shared rarer words.
  const scores = new Map(); // category -> { score, example, weight }
  for (const w of wordsOf(t)) {
    const entry = index.byWord.get(w);
    if (index.places?.has(w) || !entry || entry.n < 2 || Math.max(...[...entry.cats.values()].map((c) => c.n)) / entry.n < 0.75) continue;
    const weight = Math.log((index.total + 1) / entry.n);
    for (const [cat, c] of entry.cats) {
      if (c.id === t.id && c.n === 1) continue; // a row can't vouch for itself
      const s = scores.get(cat) ?? { score: 0, example: c.example, weight: 0 };
      s.score += weight * (c.n / entry.n);
      if (weight > s.weight && c.id !== t.id) { s.weight = weight; s.example = c.example; }
      scores.set(cat, s);
    }
  }
  [...scores.entries()]
    .filter(([, s]) => s.score > 0.5)
    .sort((a, b) => b[1].score - a[1].score)
    .forEach(([cat, s]) => add(cat, `Like ${short(s.example)}`));

  // 3. What this type usually gets.
  [...(index.byType.get(type ?? '') ?? new Map()).entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([cat]) => add(cat, `Often used for ${TYPE_WORD[type] ?? 'rows like this'}`));
  return out.slice(0, MAX);
}
