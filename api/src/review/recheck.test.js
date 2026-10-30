import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recheck, signFixes } from './recheck.js';

let id = 0;
const row = (o) => ({ id: ++id, merchant: 'Costco', description: 'COSTCO WHSE', amount_cents: -5000, txn_type: 'purchase', category_name: 'Groceries', zelle_type: null, hand_edited: false, ...o });
const kinds = (findings, txnId) => findings.filter((f) => f.transaction_id === txnId).map((f) => f.check_kind);

test('a clean history raises nothing', () => {
  assert.deepEqual(recheck([row(), row(), row(), row()]), []);
});

test('missing type and category get the suggestion history agrees on', () => {
  const odd = row({ txn_type: null, category_name: null });
  const f = recheck([row(), row(), row(), odd]);
  assert.deepEqual(f.find((x) => x.check_kind === 'type_missing').suggested_value, 'purchase');
  // The category is checked against the type it has now (none), so there's no evidence: flagged, no suggestion.
  assert.deepEqual(f.find((x) => x.check_kind === 'category_missing').suggested_value, null);
});

test('history disagreement needs 3+ others at 80%; the row never counts for itself', () => {
  const odd = row({ category_name: 'Shopping' });
  assert.deepEqual(kinds(recheck([row(), row(), row(), odd]), odd.id), ['category_history']);
  const odd2 = row({ category_name: 'Shopping' });
  assert.deepEqual(kinds(recheck([row(), row(), odd2]), odd2.id), []); // only 2 others: not enough
});

test('a hand-edited row is questioned only on stronger evidence (5+ at 90%)', () => {
  const edited = row({ category_name: 'Shopping', hand_edited: true });
  assert.deepEqual(kinds(recheck([row(), row(), row(), row(), edited]), edited.id), []);
  const edited2 = row({ category_name: 'Shopping', hand_edited: true });
  const f = recheck([row(), row(), row(), row(), row(), edited2]);
  assert.deepEqual(kinds(f, edited2.id), ['category_history']);
  assert.match(f.find((x) => x.transaction_id === edited2.id).reason, /by hand/);
});

test('a type that contradicts the money direction', () => {
  const p = row({ amount_cents: 1999 }); // "purchase" but money came in
  assert.equal(recheck([p]).find((x) => x.transaction_id === p.id).suggested_value, 'refund');
  const d = row({ txn_type: 'deposit', amount_cents: -100 });
  assert.equal(recheck([d])[0].check_kind, 'type_sign');
});

test('a Zelle row follows its Zelle review, and is not judged by merchant history', () => {
  const z = row({ merchant: null, description: 'Zelle payment to SAM', zelle_type: 'SENT', txn_type: 'transfer', category_name: 'Zelle' });
  const f = recheck([z]);
  assert.equal(f[0].check_kind, 'type_zelle');
  assert.equal(f[0].suggested_value, 'purchase');
});

test('a received Zelle filed as a refund (a share of the rent paid back) is not re-typed as a deposit', () => {
  const z = row({ merchant: null, description: 'Zelle payment from SAM for "rent"', amount_cents: 80000, zelle_type: 'RECEIVED', txn_type: 'refund', category_name: 'Rent' });
  assert.deepEqual(kinds(recheck([z]), z.id), []);
});

test('a refund at the same merchant is compared with other refunds, not with purchases', () => {
  const refund = row({ amount_cents: 2000, txn_type: 'refund', category_name: 'Refund' });
  assert.deepEqual(kinds(recheck([row(), row(), row(), refund]), refund.id), []);
});


const acct = (o) => ({ account_id: 1, account_type: 'CHECKING', posted_date: '2026-01-10', merchant: null, hand_edited: false, zelle_type: null, ...o });
const today = '2026-09-01';

test("a card bill with no card on the other end is left alone (D199); once counted as spending and the card arrives, it goes back", () => {
  const bill = acct({ id: 900, description: 'BARCLAYCARD PMT', amount_cents: -50000, txn_type: 'payment', category_name: 'Card Payment' });
  assert.deepEqual(recheck([bill], { today }), []);
  const cardLeg = acct({ id: 901, account_id: 2, account_type: 'CREDIT_CARD', description: 'PAYMENT THANK YOU', amount_cents: 50000, txn_type: 'payment', category_name: 'Card Payment', posted_date: '2026-01-12' });
  const counted = { ...bill, txn_type: 'purchase' };
  assert.equal(recheck([counted, cardLeg], { today }).find((f) => f.transaction_id === 900).check_kind, 'card_now_tracked');
});

test('money sent abroad is spending; a deposit that is the other half of an own-account move is a transfer', () => {
  const india = acct({ id: 903, description: 'REMITLY', amount_cents: -100000, txn_type: 'transfer', category_name: 'Transfer to India' });
  assert.equal(recheck([india], { today })[0].check_kind, 'abroad');
  const out = acct({ id: 904, description: 'TRANSFER OUT', amount_cents: -10000, txn_type: 'transfer', category_name: 'Transfers' });
  const inn = acct({ id: 905, account_id: 3, description: 'BANK OF AMERICA', amount_cents: 10000, txn_type: 'deposit', category_name: 'Transfers', posted_date: '2026-01-12' });
  assert.equal(recheck([out, inn], { today }).find((f) => f.transaction_id === 905).check_kind, 'income_internal');
  // A friend's Zelle that happens to match a purchase elsewhere is NOT an internal move.
  const buy = { ...out, txn_type: 'purchase' };
  assert.equal(recheck([buy, inn], { today }).find((f) => f.transaction_id === 905)?.check_kind, undefined);
});

test('signFixes: exactly one row whose flip makes the statement add up', () => {
  const s = { diff_cents: 5700000, rows: [{ transaction_id: 1, amount_cents: 2850000 }, { transaction_id: 2, amount_cents: -5000 }] };
  assert.deepEqual(signFixes([s]).map((f) => [f.transaction_id, f.suggested_value]), [[1, '-2850000']]);
  assert.deepEqual(signFixes([{ diff_cents: 100, rows: [{ transaction_id: 1, amount_cents: 50 }, { transaction_id: 2, amount_cents: 50 }] }]), []); // ambiguous
});

test('a card reward typed as a refund is flagged as cashback, even against a mislabelled history', () => {
  const offer = (id) => acct({ id, account_type: 'CREDIT_CARD', description: 'FOOD LION 7777 - Amex Offer Credit', merchant: 'Food Lion', amount_cents: 700, txn_type: 'refund', category_name: 'Refund' });
  const f = recheck([offer(990), offer(991), offer(992), offer(993)], { today });
  assert.deepEqual([...new Set(f.map((x) => x.check_kind))], ['type_reward']);
  const cashback = { ...offer(994), txn_type: 'cashback', category_name: 'Cashback' };
  assert.equal(recheck([offer(990), offer(991), offer(992), cashback], { today }).find((x) => x.transaction_id === 994), undefined); // history says refund; the rule wins
});

test('an offer credit the statement marked stays cashback, whatever the merchant usually is (D303)', () => {
  // The merchant line alone ("WAL-MART.COM") reads as a refund; the "Amex Offer Credit" line under it made it cashback.
  const ret = (id) => acct({ id, account_type: 'CREDIT_CARD', description: 'WAL-MART.COM', merchant: 'Walmart', amount_cents: 2500, txn_type: 'refund', category_name: 'Refund' });
  const offer = { ...ret(999), amount_cents: 1000, txn_type: 'cashback', category_name: 'Cashback' };
  assert.equal(recheck([ret(995), ret(996), ret(997), ret(998), offer], { today }).find((x) => x.transaction_id === 999), undefined);
});

test('a Zelle that paid back a card payment is a payment, and its Zelle rule stays quiet (D200)', () => {
  const z = acct({ id: 950, description: 'Zelle Payment to Alex', amount_cents: -100000, txn_type: 'purchase', category_name: 'Zelle', zelle_type: 'SENT', card_payback: 'Alex' });
  const [f] = recheck([z], { today });
  assert.deepEqual([f.check_kind, f.suggested_value], ['zelle_card_payment', 'payment']);
  assert.deepEqual(recheck([{ ...z, txn_type: 'payment' }], { today }).filter((x) => x.field === 'txn_type'), []);
});

test('money in on a credit card typed as a deposit is a payment, unless it is cash filed as Cash Deposit', () => {
  const credit = acct({ id: 951, account_type: 'CREDIT_CARD', description: 'STATEMENT ADJUSTMENT', amount_cents: 140000, txn_type: 'deposit', category_name: null });
  assert.equal(recheck([credit], { today })[0].check_kind, 'card_deposit');
  // Cash received and paid in at an ATM, filed as Cash Deposit, is income on purpose (D218).
  const atm = { ...credit, id: 952, description: 'ATM PAYMENT RIVERTON NC', category_name: 'Cash Deposit' };
  assert.deepEqual(recheck([atm], { today }).filter((f) => f.check_kind === 'card_deposit'), []);
});

test("a type that doesn't fit its category is flagged, unless its type was already decided (D208)", () => {
  const bonus = acct({ id: 960, description: 'CASH BACK BONUS', amount_cents: 40000, txn_type: 'deposit', category_name: 'Cashback' });
  const [f] = recheck([bonus], { today });
  assert.deepEqual([f.check_kind, f.suggested_value], ['type_category', 'cashback']);
  assert.deepEqual(recheck([{ ...bonus, type_dismissed: true }], { today }).filter((x) => x.check_kind === 'type_category'), []);
  // A fitting type, or a category with no rule, says nothing.
  assert.deepEqual(recheck([{ ...bonus, txn_type: 'cashback' }], { today }).filter((x) => x.check_kind === 'type_category'), []);
  assert.deepEqual(recheck([acct({ id: 961, description: 'CAFE', amount_cents: -500, txn_type: 'purchase', category_name: 'Dining' })], { today }), []);
});

test('when the category is the wrong side: a purchase under a money category, a tax refund filed as Refund', () => {
  const pizza = acct({ id: 962, description: 'PF JOHNS', amount_cents: -100, txn_type: 'purchase', category_name: 'Annual Fee' });
  const [a] = recheck([pizza], { today }).filter((f) => f.check_kind === 'type_category');
  assert.deepEqual([a.field, a.suggested_value], ['category', null]);
  const tax = acct({ id: 963, description: 'Txdor Ind Income Txsttaxrfd PPD', amount_cents: 12300, txn_type: 'deposit', category_name: 'Refund' });
  const [b] = recheck([tax], { today }).filter((f) => f.check_kind === 'type_category');
  assert.deepEqual([b.field, b.suggested_value], ['category', 'Tax-Refund']);
  // A late fee filed with interest keeps its fee type.
  assert.deepEqual(recheck([acct({ id: 964, description: 'LATE FEE FOR PAYMENT DUE', amount_cents: -2400, txn_type: 'fee', category_name: 'Interest' })], { today }).filter((f) => f.check_kind === 'type_category'), []);
});

test('Daily Cash taken back is cashback, negative: flagged when saved as a purchase, quiet when right (D219)', () => {
  const adj = (o) => row({ merchant: 'Target', description: 'Daily Cash Adjustment · TARGET T-0001 CEDAR PARK GA USA (RETURN)', amount_cents: -114, ...o });
  const wrong = adj({ txn_type: 'purchase', category_name: 'Shopping' });
  const target = (o) => row({ merchant: 'Target', description: 'TARGET T-0001', category_name: 'Shopping', ...o });
  const f = recheck([target(), target(), target(), wrong]).filter((x) => x.transaction_id === wrong.id);
  assert.deepEqual(f.map((x) => [x.check_kind, x.suggested_value]), [['daily_cash', 'cashback'], ['daily_cash_category', 'Cashback']]);
  const right = adj({ txn_type: 'cashback', category_name: 'Cashback' });
  assert.deepEqual(kinds(recheck([right]), right.id), []); // no "a cashback, but money went out"
});

// D272: Amex's adjustment pairs cancel out, so each half is a transfer.
test('a debit and credit adjustment for the same amount on the same day are suggested as transfers', () => {
  const base = { merchant: null, account_id: 7, posted_date: '2024-03-25', category_name: null };
  const debit = row({ ...base, description: 'DEBIT ADJUSTMENT', amount_cents: -15000, txn_type: 'purchase' });
  const credit = row({ ...base, description: 'CREDIT ADJUSTMENT', amount_cents: 15000, txn_type: 'refund', category_name: 'Refund' });
  const out = recheck([debit, credit]);
  for (const t of [debit, credit]) assert.deepEqual(out.filter((f) => f.transaction_id === t.id && f.check_kind === 'adjustment_pair').map((f) => f.suggested_value), ['transfer']);
  const lone = row({ ...base, description: 'DEBIT ADJUSTMENT', amount_cents: -999, txn_type: 'purchase' });
  assert.equal(recheck([lone]).some((f) => f.check_kind === 'adjustment_pair'), false, 'no twin, no suggestion');
});

test("$0.00 interest lines don't outvote a real payment with the same name (D282)", () => {
  const zeros = Array.from({ length: 10 }, () => row({ merchant: 'Bank of America', amount_cents: 0, txn_type: 'interest', category_name: 'Interest' }));
  const payment = row({ merchant: 'Bank of America', amount_cents: 71831, txn_type: 'payment', category_name: 'Card Payment' });
  assert.deepEqual(recheck([...zeros, payment]).filter((f) => f.check_kind === 'type_history'), []);
  // Among themselves, $0.00 rows still have a history.
  const odd = row({ merchant: 'Bank of America', amount_cents: 0, txn_type: 'fee', category_name: 'Interest' });
  assert.equal(recheck([...zeros, odd]).find((f) => f.transaction_id === odd.id && f.check_kind === 'type_history')?.suggested_value, 'interest');
});

test('a bank fee filed as a balance transfer fee goes to Review as Interest (D308)', () => {
  const fx = acct({ id: 1001, account_type: 'CREDIT_CARD', description: 'FOREIGN TRANSACTION FEE 3620 0001', merchant: 'Bank of America', amount_cents: -846, txn_type: 'fee', category_name: 'Balance Transfer' });
  const bt = { ...fx, id: 1002, description: 'DIRECT DEPOSIT - TRANSACTION FEE', amount_cents: -6000 };
  const f = recheck([fx, bt], { today });
  assert.deepEqual(f.map((x) => [x.transaction_id, x.check_kind, x.suggested_value]), [[1001, 'type_category', 'Interest']]);
});

test("a line that names its category for certain outvotes a history learned from one wrong row (D337)", () => {
  const ins = (id, category_name) => ({ id, account_id: 1, account_type: 'CREDIT_CARD', posted_date: '2026-01-0' + id, amount_cents: -12000,
    txn_type: 'purchase', merchant: 'Acme Mutual', description: 'ACME MUTUAL INSURANCE BLOOMINGTON IL', category_name });
  const rows = [1, 2, 3, 4].map((id) => ins(id, 'Parking & Tolls'));
  const found = recheck(rows).filter((f) => f.check_kind === 'category_keyword');
  assert.equal(found.length, 4);
  assert.equal(found[0].suggested_value, 'Insurance');
  assert.equal(recheck([ins(1, 'Insurance'), ins(2, 'Insurance')]).filter((f) => f.check_kind === 'category_keyword').length, 0);
});

test("Zolve taking back a pending return is a refund that is money out, and isn't flagged (D337)", () => {
  const row = { id: 1, account_id: 1, account_type: 'CREDIT_CARD', posted_date: '2026-01-01', amount_cents: -500, txn_type: 'refund',
    merchant: null, description: 'Reversal Transaction [Pending Credit Transaction- POS Signature Return]', category_name: 'Refund' };
  assert.equal(recheck([row]).filter((f) => f.check_kind === 'type_sign').length, 0);
});
