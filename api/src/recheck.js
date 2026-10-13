/**
 * The re-check (D175): today's rules run over every saved transaction,
 * and each disagreement becomes a finding for a person to approve or
 * dismiss. It never edits anything itself.
 *
 * "Today's rules" are the household's own history, the same evidence
 * historical-category.js uses on import. The question is "what does
 * this merchant usually get?", leaving the row itself out of the count
 * so a row can't vouch for itself. So every correction a person makes
 * is also the lesson for every later row and import: nothing to train,
 * nothing to store beyond the edit.
 *
 * Hand-edited rows are questioned too (the owner asked for that), but
 * only on stronger evidence: 5+ other rows agreeing 90%, not 3+ at 80%.
 *
 * Pure: rows in, findings out. Tested in recheck.test.js.
 */

import { inflowType } from './inflow-type.js';

export const ZELLE_TXN_TYPE = { INTERNAL: 'transfer', SENT: 'purchase', RECEIVED: 'deposit' };

// Types that only make sense in one direction. Others (transfer,
// payment, fee, interest, savings) legitimately go either way.
const OUT_ONLY = new Set(['purchase']);
const IN_ONLY = new Set(['refund', 'deposit', 'cashback']);

// Money sent abroad: the owner counts it as spending, not money kept (D178).
const ABROAD = new Set(['Transfer to India']);

// Apple taking back Daily Cash after a return (D219): cashback, negative.
// It's the one cashback that is money out, so type_sign mustn't call it a purchase.
const DAILY_CASH = /^Daily Cash Adjustment\b/i;

/**
 * The types each of these categories can sensibly have (D208). The type
 * decides which total a row counts in; the category only labels it. When
 * they disagree, the type is the one doing the damage (a Cashback row
 * typed deposit is counted as income), so the type is what's flagged.
 * The first listed is the suggestion. Spend categories aren't listed:
 * type_sign already catches a purchase that's money in.
 *
 * Which side is wrong isn't always the type. A purchase filed under a
 * money category (Papa John's under Annual Fee) has the wrong category,
 * so the household picks one; a state tax refund filed as Refund belongs
 * in Tax-Refund. Otherwise the type is suggested.
 */
// [A-Z]{2}DOR: a state's Department of Revenue ("NCDOR", "TXDOR").
const TAX_REFUND = /\b(TAX ?(RFD|REFUND)|TAXRFD|IRS TREAS|[A-Z]{2}DOR|DEPT OF REVENUE)\b/i;
export const CATEGORY_TYPES = {
  Salary: ['deposit'],
  'Tax-Refund': ['deposit', 'refund'],
  Cashback: ['cashback'],
  Refund: ['refund'],
  'Card Payment': ['payment'],
  Interest: ['interest', 'refund', 'fee'], // a late fee filed with interest is still a fee
  'Annual Fee': ['fee', 'refund'],
  Loan: ['payment', 'fee'],
  Savings: ['savings', 'transfer'],
  Investment: ['transfer', 'savings'],
  'Balance Transfer': ['transfer', 'fee'],
  'Account Verification': ['transfer', 'deposit'],
};
const DAY = 86_400_000;
const days = (a, b) => Math.abs(new Date(a) - new Date(b)) / DAY;

const normalize = (s) => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const sign = (cents) => (cents < 0 ? '-' : '+');
/** What a row is "the same as": its merchant, else its whole printed line. */
const keyOf = (t) => (t.merchant ? `m:${t.merchant}` : `d:${normalize(t.description)}`);

function tally(rows, keyFn, valueFn) {
  const counts = new Map(); // key -> Map(value -> count)
  for (const r of rows) {
    const v = valueFn(r);
    if (v == null) continue;
    const k = keyFn(r);
    if (!counts.has(k)) counts.set(k, new Map());
    counts.get(k).set(v, (counts.get(k).get(v) ?? 0) + 1);
  }
  return counts;
}

/** The value history agrees on for this key, leaving `own` (the row's own value) out of the count. */
function consensus(counts, key, own, { min, share }) {
  const c = new Map(counts.get(key) ?? []);
  if (own != null && c.has(own)) c.set(own, c.get(own) - 1);
  const total = [...c.values()].reduce((a, b) => a + b, 0);
  if (total < min) return null;
  const [value, n] = [...c.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0];
  return n / total >= share ? { value, n, total } : null;
}

/**
 * @param rows - every transaction: { id, account_id, account_type, posted_date ('YYYY-MM-DD'), merchant,
 *   description, amount_cents, txn_type, category_name, zelle_type, hand_edited }
 * @returns findings: { transaction_id, check_kind, field, current_value, suggested_value, reason }
 */
// (Its `today` option went with the retired card_untracked rule, D199 / D223.)
export function recheck(rows) {
  // Every row by amount, to find the other half of a move between the household's own accounts.
  const byAmount = new Map();
  for (const r of rows) {
    if (!byAmount.has(r.amount_cents)) byAmount.set(r.amount_cents, []);
    byAmount.get(r.amount_cents).push(r);
  }
  const otherHalf = (t, maxDays, test = () => true) =>
    (byAmount.get(-t.amount_cents) ?? []).some(
      (o) => o.account_id !== t.account_id && t.posted_date && o.posted_date && days(o.posted_date, t.posted_date) <= maxDays && test(o)
    );
  const onCard = (o) => o.account_type === 'CREDIT_CARD';

  const typeKey = (t) => `${keyOf(t)}|${sign(t.amount_cents)}`;
  const catKey = (t) => `${keyOf(t)}|${t.txn_type ?? ''}`;
  const types = tally(rows, typeKey, (t) => t.txn_type);
  const cats = tally(rows, catKey, (t) => t.category_name);
  const out = [];

  for (const t of rows) {
    const bar = t.hand_edited ? { min: 5, share: 0.9 } : { min: 3, share: 0.8 };
    const add = (check_kind, field, suggested_value, reason) =>
      out.push({
        transaction_id: t.id,
        check_kind,
        field,
        current_value: field === 'txn_type' ? t.txn_type ?? null : t.category_name ?? null,
        suggested_value: suggested_value ?? null,
        // Only where it's your edit being questioned, not for a value that was never set.
        reason: t.hand_edited && check_kind.endsWith('_history') ? `${reason} (you edited this row by hand)` : reason,
      });

    // --- type ---
    const typeHistory = consensus(types, typeKey(t), t.txn_type, bar);
    const zelleType = t.zelle_type ? ZELLE_TXN_TYPE[t.zelle_type] : null;
    const cardBill = t.category_name === 'Card Payment' && t.account_type !== 'CREDIT_CARD' && t.amount_cents < 0;
    // A card bill with no card-side match is no longer re-typed as a purchase
    // (card_untracked, retired D199): it was almost always a card statement not
    // uploaded yet, and Review's Payments tab now says exactly which one.
    if (!t.txn_type) {
      add('type_missing', 'txn_type', zelleType ?? typeHistory?.value, 'No type was set');
    } else if (t.card_payback && t.txn_type !== 'payment') {
      // Zelle paying back someone who paid one of the household's cards (D200):
      // the card's purchases are already spending, so this isn't spending again.
      add('zelle_card_payment', 'txn_type', 'payment', `Paid ${t.card_payback} back for a card payment they made, so it isn't spending`);
    } else if (t.card_payback) {
      // Already a payment: its Zelle and history rules don't apply to it.
    } else if (t.account_type === 'CREDIT_CARD' && t.txn_type === 'deposit' && t.amount_cents > 0 && t.category_name !== 'Cash Deposit') {
      // Cash the household received and paid straight into a card at an ATM
      // is income, the same as an ATM cash deposit into checking (D218), so a
      // card deposit filed as Cash Deposit is intended. Any other card deposit is a payment.
      add('card_deposit', 'txn_type', 'payment', "Money in on a credit card pays it down. It isn't income");
    } else if (cardBill && t.txn_type === 'purchase' && otherHalf(t, 7, onCard)) {
      add('card_now_tracked', 'txn_type', 'payment',
        "That card's statement is in the app now, so its purchases are counted there. Counting this bill too would count them twice");
    } else if (ABROAD.has(t.category_name) && t.txn_type === 'transfer' && t.amount_cents < 0) {
      add('abroad', 'txn_type', 'purchase', 'Money sent abroad counts as spending, not money kept');
    } else if (DAILY_CASH.test(t.description ?? '') && t.amount_cents < 0) {
      if (t.txn_type !== 'cashback') {
        add('daily_cash', 'txn_type', 'cashback', 'Daily Cash Apple took back after a return. It is cashback given back, not a purchase');
      }
    } else if (t.txn_type === 'refund' && t.amount_cents > 0 && inflowType(t.description) === 'cashback') {
      // A card reward (Amex Offer, streaming credit) isn't the merchant refunding you (D189).
      add('type_reward', 'txn_type', 'cashback', 'A card reward, not a refund: it shouldn\'t lower your spending');
    } else if (t.txn_type === 'deposit' && t.amount_cents > 0 && otherHalf(t, 4, (o) => ['transfer', 'savings', 'payment'].includes(o.txn_type))) {
      add('income_internal', 'txn_type', 'transfer', 'The other half of a move between your own accounts, so it isn\'t income');
    } else if (zelleType && t.txn_type !== zelleType) {
      add('type_zelle', 'txn_type', zelleType, `Its Zelle review says ${t.zelle_type.toLowerCase()}, which is a ${zelleType}`);
    } else if (OUT_ONLY.has(t.txn_type) && t.amount_cents > 0) {
      add('type_sign', 'txn_type', 'refund', 'A purchase, but money came in');
    } else if (IN_ONLY.has(t.txn_type) && t.amount_cents < 0) {
      add('type_sign', 'txn_type', 'purchase', `A ${t.txn_type}, but money went out`);
    } else if (CATEGORY_TYPES[t.category_name] && !CATEGORY_TYPES[t.category_name].includes(t.txn_type) && !t.type_dismissed) {
      // A type the household already decided in Review isn't asked about again under a new rule.
      if (t.txn_type === 'purchase') {
        out.push({ transaction_id: t.id, check_kind: 'type_category', field: 'category', current_value: t.category_name, suggested_value: null,
          reason: `A purchase filed as ${t.category_name}. Pick the category it belongs in` });
      } else if (t.category_name === 'Refund' && t.txn_type === 'deposit' && TAX_REFUND.test(t.description)) {
        out.push({ transaction_id: t.id, check_kind: 'type_category', field: 'category', current_value: t.category_name, suggested_value: 'Tax-Refund',
          reason: 'A tax refund filed as a shop refund' });
      } else {
        add('type_category', 'txn_type', CATEGORY_TYPES[t.category_name][0],
          `Filed as ${t.category_name}, but typed ${t.txn_type}, so it counts in the wrong total`);
      }
    } else if (!zelleType && typeHistory && typeHistory.value !== t.txn_type
               && !(t.amount_cents > 0 && inflowType(t.description) === t.txn_type)) { // the reward rule beats a mislabelled history
      add('type_history', 'txn_type', typeHistory.value, `${typeHistory.n} of ${typeHistory.total} others like it are ${typeHistory.value}`);
    }

    // --- category --- (against the type the row has now)
    const catHistory = consensus(cats, catKey(t), t.category_name, bar);
    if (DAILY_CASH.test(t.description ?? '') && t.amount_cents < 0) {
      // Its merchant is the shop it was returned to, so history would say Shopping.
      if (t.category_name !== 'Cashback') add('daily_cash_category', 'category', 'Cashback', 'Daily Cash taken back belongs with Cashback');
    } else if (!t.category_name) {
      add('category_missing', 'category', catHistory?.value, 'No category was set');
    } else if (catHistory && catHistory.value !== t.category_name) {
      add('category_history', 'category', catHistory.value, `${catHistory.n} of ${catHistory.total} others like it are ${catHistory.value}`);
    }
  }
  return out;
}

/**
 * A row recorded with the wrong sign (D178): a statement that doesn't
 * add up, where flipping exactly one of its rows makes it add up to the
 * cent. A balance transfer read as a +$28,500 credit instead of new
 * debt is off by exactly $57,000.
 *
 * @param statements - { diff_cents (rows − expected), rows: [{ transaction_id, amount_cents }] }
 */
export function signFixes(statements) {
  const out = [];
  for (const s of statements) {
    if (!s.diff_cents) continue;
    // Flipping a row changes the rows' total by −2 × its amount.
    const hits = s.rows.filter((r) => r.transaction_id && r.amount_cents !== 0 && 2 * r.amount_cents === s.diff_cents);
    if (hits.length !== 1) continue;
    const r = hits[0];
    out.push({
      transaction_id: r.transaction_id,
      check_kind: 'amount_sign',
      field: 'amount',
      current_value: String(r.amount_cents),
      suggested_value: String(-r.amount_cents),
      reason: "Its statement doesn't add up, and flipping this one amount makes it add up to the cent",
    });
  }
  return out;
}
