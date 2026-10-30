import { test } from 'node:test';
import assert from 'node:assert/strict';
import { balanceTransferStatus, balanceTransferSuggestions, paymentMonthsLeft } from './balance-transfer.js';

// An invented card, shaped like the real Frontier month: a transfer, its 3% fee, a payment.
const draw = { id: 1, posted_date: '2026-09-10', description: 'BT TO CK ACCT - 1234', amount_cents: -500000, txn_type: 'transfer', category_name: 'Balance Transfer' };
const fee = { id: 2, posted_date: '2026-09-10', description: 'BALANCE TRANSFER FEE', amount_cents: -15000, txn_type: 'fee', category_name: 'Balance Transfer' };
const pay = (id, date, cents) => ({ id, posted_date: date, description: 'Payment Received', amount_cents: cents, txn_type: 'payment', category_name: 'Card Payment' });
const stmt = (start, end, closing, payments) => ({ period_start: start, period_end: end, closing_balance_cents: closing, total_payments_cents: payments });
const promo = (end, extra = {}) => ({ kind: 'balance_transfer', label: 'Balance Transfer/Check Promotion', offer_id: null, apr_bps: 0, standard_apr_bps: 2974, end_date: end, balance_subject_cents: 400000, ...extra });

const october = stmt('2026-09-06', '2026-10-05', 497000, 18000);
const base = {
  loan: { start_date: null, deadline_date: null, effective_balance_cents: 497000 },
  statements: [october],
  promos: { '2026-10-05': [promo('2027-04-05')] },
  rows: [pay(3, '2026-09-11', 18000), draw, fee],
  today: '2026-10-08',
};

test('payment months left: this month counts only while its day is still ahead', () => {
  assert.equal(paymentMonthsLeft('2027-04-05', '2026-10-08'), 6); // Nov … Apr
  assert.equal(paymentMonthsLeft('2027-04-10', '2026-10-08'), 7); // Oct … Apr
  assert.equal(paymentMonthsLeft('2026-09-01', '2026-10-08'), 0);
});

test('the first month: what moved, what it cost, the end date off the statement, the pace needed', () => {
  const s = balanceTransferStatus(base);
  assert.equal(s.state, 'active');
  assert.equal(s.since, '2026-09-10');
  assert.equal(s.transferred_cents, 500000);
  assert.equal(s.fees_cents, 15000);
  assert.equal(s.paid_cents, 18000);
  assert.equal(s.end_date, '2027-04-05');
  assert.equal(s.end_source, 'statement');
  assert.equal(s.days_left, 179);
  assert.equal(s.needed_monthly_cents, Math.ceil(497000 / 6));
  // That statement's cycle began before the transfer, so its payment says nothing about the pace yet.
  assert.equal(s.pace, null);
  assert.deepEqual(s.warnings, []);
});

test('a payment before the transfer does not count toward it', () => {
  const s = balanceTransferStatus({ ...base, rows: [pay(4, '2026-09-08', 9900), ...base.rows] });
  assert.equal(s.paid_cents, 18000);
});

test('the pace: a full cycle after the transfer, paying enough or not', () => {
  const november = stmt('2026-10-06', '2026-11-05', 397000, 100000);
  const input = { ...base, statements: [october, november], promos: { ...base.promos, '2026-11-05': [promo('2027-04-05')] }, loan: { ...base.loan, effective_balance_cents: 397000 }, today: '2026-11-08' };
  // 5 months left (Dec … Apr): 397000 / 5 = 79400 needed; 100000 paid.
  assert.equal(balanceTransferStatus(input).pace, 'on_track');
  assert.equal(balanceTransferStatus({ ...input, statements: [october, { ...november, total_payments_cents: 5000 }] }).pace, 'behind');
});

test('a hand-typed deadline is the fallback, and is flagged when the statement disagrees', () => {
  const manual = balanceTransferStatus({ ...base, promos: {}, loan: { ...base.loan, deadline_date: '2027-03-01' } });
  assert.equal(manual.end_source, 'manual');
  assert.equal(manual.end_date, '2027-03-01');

  const both = balanceTransferStatus({ ...base, loan: { ...base.loan, deadline_date: '2027-03-01' } });
  assert.equal(both.end_date, '2027-04-05'); // the statement wins
  assert.deepEqual(both.warnings, [{ kind: 'manual_date_differs', manual: '2027-03-01', statement: '2027-04-05' }]);

  assert.equal(balanceTransferStatus({ ...base, promos: {} }).state, 'no_end_date');
});

test('an end date that moves between statements is reported, not swapped silently', () => {
  const november = stmt('2026-10-06', '2026-11-05', 397000, 100000);
  const s = balanceTransferStatus({ ...base, statements: [october, november], promos: { ...base.promos, '2026-11-05': [promo('2027-05-05')] }, today: '2026-11-08' });
  assert.equal(s.end_date, '2027-05-05');
  assert.deepEqual(s.warnings.find((w) => w.kind === 'end_date_moved'), { kind: 'end_date_moved', from: '2027-04-05', to: '2027-05-05' });
});

test('two promos on one card: the one ending first is the deadline', () => {
  const s = balanceTransferStatus({ ...base, promos: { '2026-10-05': [promo('2027-10-13', { kind: 'cash_advance', offer_id: 'B' }), promo('2027-04-05', { offer_id: 'A' }), promo('2027-01-01', { kind: 'purchase' })] } });
  assert.equal(s.end_date, '2027-04-05');
  assert.equal(s.promos.length, 2); // a purchase promo isn't the transfer's
});

test('ending soon, then ended: the rate it reverts to comes from the same table', () => {
  assert.equal(balanceTransferStatus({ ...base, today: '2027-02-20' }).state, 'ending_soon');
  const ended = balanceTransferStatus({ ...base, today: '2027-04-06' });
  assert.equal(ended.state, 'promo_ended');
  assert.equal(ended.needed_monthly_cents, null);
  assert.deepEqual(ended.warnings.find((w) => w.kind === 'promo_ended'), { kind: 'promo_ended', standard_apr_bps: 2974 });
});

test('once the issuer stops printing the promo, the last printed end date still holds', () => {
  const may = stmt('2027-04-06', '2027-05-05', 100000, 50000);
  const s = balanceTransferStatus({ ...base, statements: [october, may], loan: { ...base.loan, effective_balance_cents: 100000 }, today: '2027-05-08' });
  assert.equal(s.end_date, '2027-04-05');
  assert.equal(s.state, 'promo_ended');
});

test('paid off: the card balance reached zero after the transfer', () => {
  const s = balanceTransferStatus({ ...base, loan: { ...base.loan, effective_balance_cents: 0 }, today: '2027-03-08' });
  assert.equal(s.state, 'paid_off');
  assert.equal(s.needed_monthly_cents, null);
});

test('warnings: interest, a late fee, purchases on the card, a stale statement', () => {
  const rows = [
    ...base.rows,
    { id: 5, posted_date: '2026-10-01', description: 'INTEREST CHARGE ON PURCHASES', amount_cents: -1234, txn_type: 'interest', category_name: 'Interest' },
    { id: 6, posted_date: '2026-10-02', description: 'LATE PAYMENT FEE', amount_cents: -4100, txn_type: 'fee', category_name: null },
    { id: 7, posted_date: '2026-10-03', description: 'CHIPOTLE', amount_cents: -1100, txn_type: 'purchase', category_name: 'Dining' },
  ];
  const s = balanceTransferStatus({ ...base, rows, today: '2026-12-01' });
  assert.deepEqual(s.warnings.map((w) => w.kind), ['interest_charged', 'late_fee', 'purchases_on_card', 'statement_stale']);
  assert.equal(s.fees_cents, 15000); // a late fee isn't the transfer's cost
});

test('a draw saved with the old positive sign still counts, and is flagged for its fix', () => {
  const s = balanceTransferStatus({ ...base, rows: [pay(3, '2026-09-11', 18000), { ...draw, amount_cents: 500000 }, fee] });
  assert.equal(s.transferred_cents, 500000);
  assert.equal(s.paid_cents, 18000); // a positive draw is not a payment
  assert.deepEqual(s.warnings, [{ kind: 'draw_sign', transaction_ids: [1] }]);
});

test("the loan's own start date bounds it, so an older transfer on the same card is left out", () => {
  const old = { ...draw, id: 9, posted_date: '2025-01-13', amount_cents: -710000 };
  const s = balanceTransferStatus({ ...base, loan: { ...base.loan, start_date: '2026-09-01' }, rows: [old, ...base.rows] });
  assert.equal(s.transferred_cents, 500000);
});

// --- suggestions (D194) ---

const card = { id: 17, name: 'Frontier Airlines World Mastercard', issuer: 'Barclays', statements: [october], promos: base.promos, rows: base.rows };

test('a card with a live promo and no loan is suggested, prefilled from its statement', () => {
  assert.deepEqual(balanceTransferSuggestions({ cards: [card], loans: [], today: '2026-10-08' }), [{
    key: '17:2027-04-05', account_id: 17, account_name: 'Frontier Airlines World Mastercard', issuer: 'Barclays',
    draw_cents: 500000, draw_date: '2026-09-10', end_date: '2027-04-05', apr_bps: 0, standard_apr_bps: 2974, balance_cents: 497000,
  }]);
});

test('not suggested: already tracked, dismissed, or nothing current', () => {
  const tracked = [{ loan_type: 'balance_transfer', linked_account_id: 17, is_active: true }];
  assert.deepEqual(balanceTransferSuggestions({ cards: [card], loans: tracked, today: '2026-10-08' }), []);
  assert.deepEqual(balanceTransferSuggestions({ cards: [card], loans: [], dismissed: ['17:2027-04-05'], today: '2026-10-08' }), []);
  // A closed loan doesn't count as tracking it.
  assert.equal(balanceTransferSuggestions({ cards: [card], loans: [{ ...tracked[0], is_active: false }], today: '2026-10-08' }).length, 1);
  // Promo over and the draw long past: history, not a loan to start now.
  assert.deepEqual(balanceTransferSuggestions({ cards: [card], loans: [], today: '2027-06-01' }), []);
});

test('a recent draw with no promo table read is still suggested, keyed by its date', () => {
  const [s] = balanceTransferSuggestions({ cards: [{ ...card, promos: {} }], loans: [], today: '2026-10-08' });
  assert.equal(s.key, '17:2026-09-10');
  assert.equal(s.end_date, null);
});

test('a closed loan counts only its own period: a later transfer on the same card is another loan (D308)', () => {
  const row = (id, posted_date, amount_cents, txn_type, category_name = 'Balance Transfer', description = 'DIRECT DEPOSIT') => ({ id, posted_date, amount_cents, txn_type, category_name, description });
  const rows = [
    row(1, '2024-12-16', -500000, 'transfer'), row(2, '2024-12-16', -20000, 'fee', 'Balance Transfer', 'DIRECT DEPOSIT - TRANSACTION FEE'),
    row(3, '2025-12-01', 520000, 'payment', 'Card Payment', 'BA ELECTRONIC PAYMENT'),
    row(4, '2026-09-08', -2850000, 'transfer'), row(5, '2026-09-08', -114000, 'fee', 'Balance Transfer', 'DIRECT DEPOSIT - TRANSACTION FEE'),
  ];
  const old = balanceTransferStatus({ loan: { start_date: '2024-12-16', deadline_date: '2026-01-13', effective_balance_cents: 0, until: '2026-01-13' }, rows, today: '2026-10-18' });
  assert.equal(old.transferred_cents, 500000);
  assert.equal(old.fees_cents, 20000);
  assert.equal(old.paid_cents, 520000);
  assert.equal(old.state, 'paid_off');
  const open = balanceTransferStatus({ loan: { start_date: '2024-12-16', deadline_date: '2026-01-13', effective_balance_cents: 0 }, rows, today: '2026-10-18' });
  assert.equal(open.transferred_cents, 3350000, 'without an end, the 2026 transfer is counted too');
});

test('cash paid into the card at an ATM counts toward paying it down (D308)', () => {
  const rows = [
    { id: 1, posted_date: '2025-01-01', amount_cents: -100000, txn_type: 'transfer', category_name: 'Balance Transfer', description: 'DIRECT DEPOSIT' },
    { id: 2, posted_date: '2025-06-01', amount_cents: 40000, txn_type: 'deposit', category_name: 'Cash Deposit', description: 'ATM PAYMENT' },
    { id: 3, posted_date: '2025-07-01', amount_cents: 60000, txn_type: 'payment', category_name: 'Card Payment', description: 'ONLINE PAYMENT' },
  ];
  const s = balanceTransferStatus({ loan: { start_date: '2025-01-01', deadline_date: '2026-01-01', effective_balance_cents: 0, until: '2026-01-01' }, rows, today: '2026-10-18' });
  assert.equal(s.paid_cents, 100000);
});

test('interest says what it was charged on, when the statement names it (D308)', () => {
  const rows = [
    { id: 1, posted_date: '2025-01-01', amount_cents: -100000, txn_type: 'transfer', category_name: 'Balance Transfer', description: 'DIRECT DEPOSIT' },
    { id: 2, posted_date: '2025-02-13', amount_cents: -24, txn_type: 'interest', category_name: 'Interest', description: 'INTEREST CHARGED ON PURCHASES' },
  ];
  const loan = { start_date: '2025-01-01', deadline_date: '2026-01-01', effective_balance_cents: 0, until: '2026-01-01' };
  assert.equal(balanceTransferStatus({ loan, rows, today: '2026-10-18' }).warnings.find((w) => w.kind === 'interest_charged').on, 'purchases');
  const promo = [...rows, { id: 3, posted_date: '2025-03-13', amount_cents: -900, txn_type: 'interest', category_name: 'Interest', description: 'INTEREST CHARGED ON DIR DEP&CHK CASHADV' }];
  assert.equal(balanceTransferStatus({ loan, rows: promo, today: '2026-10-18' }).warnings.find((w) => w.kind === 'interest_charged').on, 'promo');
});

test('a two-phase plan: the minimum for eight months, then four even payments (D309)', async () => {
  const { payoffPlan } = await import('./balance-transfer.js');
  // $29,608.98 owed on Oct 18, 2026; 0% ends Oct 13, 2027; minimum $296; minimum through June 2027.
  const p = payoffPlan({ minimumUntil: '2027-06-01', endDate: '2027-10-13', today: '2026-10-18', balance: 2960898, minimum: 29600, monthsLeft: 12 });
  assert.deepEqual(
    [p.phase, p.minimum_months_left, p.bulk_from, p.bulk_months, p.projected_bulk_cents, p.bulk_monthly_cents],
    ['minimum', 8, '2027-07-01', 4, 2724098, 681025],
  );
  const later = payoffPlan({ minimumUntil: '2027-06-01', endDate: '2027-10-13', today: '2027-07-20', balance: 2700000, minimum: 27000, monthsLeft: 3 });
  assert.deepEqual([later.phase, later.bulk_months, later.bulk_monthly_cents], ['bulk', 3, 900000]);
});

test('in the minimum phase, paying the minimum is on track (D309)', () => {
  const statements = [
    { period_start: '2026-08-14', period_end: '2026-09-13', closing_balance_cents: 2843201, total_payments_cents: 80000, minimum_payment_cents: 28400 },
    { period_start: '2026-09-14', period_end: '2026-10-13', closing_balance_cents: 2960898, total_payments_cents: 38303, minimum_payment_cents: 29600 },
  ];
  const rows = [{ id: 1, posted_date: '2026-09-08', amount_cents: -2850000, txn_type: 'transfer', category_name: 'Balance Transfer', description: 'DIRECT DEPOSIT' }];
  const base = { start_date: '2026-09-08', deadline_date: '2027-10-13', effective_balance_cents: 2960898 };
  const even = balanceTransferStatus({ loan: base, statements, rows, today: '2026-10-18' });
  assert.equal(even.pace, 'behind');
  const planned = balanceTransferStatus({ loan: { ...base, minimum_until: '2027-06-01' }, statements, rows, today: '2026-10-18' });
  assert.equal(planned.pace, 'on_track');
  assert.equal(planned.needed_monthly_cents, 29600);
  assert.equal(planned.plan.bulk_months, 4);
});
