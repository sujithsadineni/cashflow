import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cashLocation, covered, matchPayments, namedSource, namesIssuer } from './payment-match.js';

// Invented rows shaped like the Blue Cash Preferred months.
const AMEX = 'American Express';
const pay = (id, date, cents, description = 'MOBILE PAYMENT - THANK YOU') => ({ id, account_id: 9, posted_date: date, amount_cents: cents, description, issuer: AMEX });
const out = (id, account_id, date, cents, description = 'AMEX EPAYMENT ACH PMT', extra = {}) => ({ id, account_id, posted_date: date, amount_cents: -cents, description, txn_type: 'payment', category_name: 'Card Payment', ...extra });
const period = (start, end) => ({ period_start: start, period_end: end });
const sofi = { id: 8, periods: [period('2026-05-01', '2026-05-31'), period('2026-06-01', '2026-06-30'), period('2026-07-01', '2026-07-31'), period('2026-08-01', '2026-08-31')] };
const chase = { id: 7, periods: [period('2026-05-01', '2026-09-30')] };

test('issuer names as banks print them', () => {
  assert.equal(namesIssuer('AMEX EPAYMENT ACH PMT', AMEX), true);
  assert.equal(namesIssuer('American Express ACH Pmt M7350', AMEX), true);
  assert.equal(namesIssuer('Applecard Gsbank Payment', 'Goldman Sachs Bank USA'), true);
  assert.equal(namesIssuer('BARCLAYCARD US CREDITCARD', 'Barclays'), true);
  assert.equal(namesIssuer('CHIPOTLE', AMEX), false);
});

test('statement coverage across back-to-back periods, and a gap', () => {
  assert.equal(covered(sofi.periods, '2026-06-28', '2026-07-03'), true);
  assert.equal(covered(sofi.periods, '2026-08-28', '2026-09-02'), false);
  assert.equal(covered([], '2026-06-01', '2026-06-02'), false);
});

test('verified: same amount, a few days later, from the bank that names the issuer', () => {
  const [m] = matchPayments({ payments: [pay(1, '2026-06-18', 71823)], bankRows: [out(10, 8, '2026-06-22', 71823)], bankAccounts: [sofi, chase] });
  assert.deepEqual(m, { card_transaction_id: 1, bank_transaction_id: 10, part_ids: [10], status: 'verified', reason: null, via: 'bank', detail: { bank_account_id: 8, days: 4 } });
});

test('outside the window, or not a card bill: no match', () => {
  const late = matchPayments({ payments: [pay(1, '2026-06-18', 71823)], bankRows: [out(10, 8, '2026-06-25', 71823)], bankAccounts: [sofi, chase] })[0];
  assert.equal(late.status, 'unverified');
  // A slow issuer (Zolve) posts the payment days after the bank sent it.
  const early = matchPayments({ payments: [pay(1, '2025-12-30', 161419)], bankRows: [out(10, 7, '2025-12-26', 161419)], bankAccounts: [sofi, chase] })[0];
  assert.equal(early.status, 'verified');
  // The same amount spent on coffee doesn't verify a payment.
  const coffee = out(11, 7, '2026-06-18', 662, 'STARBUCKS', { txn_type: 'purchase', category_name: 'Dining' });
  assert.equal(matchPayments({ payments: [pay(2, '2026-06-18', 662)], bankRows: [coffee], bankAccounts: [sofi, chase] })[0].status, 'unverified');
});

test('naming the issuer beats a closer date; a true tie is ambiguous', () => {
  const named = out(10, 8, '2026-06-20', 5000);
  const unnamed = out(11, 7, '2026-06-18', 5000, 'ONLINE TRANSFER');
  assert.equal(matchPayments({ payments: [pay(1, '2026-06-18', 5000)], bankRows: [unnamed, named], bankAccounts: [sofi, chase] })[0].bank_transaction_id, 10);

  const twin = out(12, 7, '2026-06-20', 5000);
  const tie = matchPayments({ payments: [pay(1, '2026-06-18', 5000)], bankRows: [named, twin], bankAccounts: [sofi, chase] })[0];
  assert.equal(tie.reason, 'ambiguous');
  assert.deepEqual(tie.detail.candidate_ids, [10, 12]);
});

test('one withdrawal verifies one payment; one already linked elsewhere is off limits', () => {
  const ms = matchPayments({ payments: [pay(1, '2026-06-18', 5000), pay(2, '2026-06-19', 5000)], bankRows: [out(10, 8, '2026-06-18', 5000)], bankAccounts: [sofi, chase] });
  assert.equal(ms[0].bank_transaction_id, 10);
  assert.equal(ms[1].status, 'unverified');
  assert.equal(matchPayments({ payments: [pay(1, '2026-06-18', 5000)], bankRows: [out(10, 8, '2026-06-18', 5000)], bankAccounts: [sofi, chase], taken: [10] })[0].status, 'unverified');
});

test("not found: the likely bank's statement isn't uploaded yet, picked by payment kind", () => {
  const payments = [
    pay(1, '2026-07-18', 37343, 'AUTOPAY PAYMENT RECEIVED'),
    pay(2, '2026-08-17', 123443, 'AUTOPAY PAYMENT RECEIVED'),
    pay(3, '2026-06-10', 2000),
    pay(4, '2026-09-18', 662, 'AUTOPAY PAYMENT RECEIVED'),
  ];
  const bankRows = [out(10, 8, '2026-07-20', 37343), out(11, 8, '2026-08-18', 123443), out(12, 7, '2026-06-10', 2000)];
  const m = matchPayments({ payments, bankRows, bankAccounts: [sofi, chase] })[3];
  assert.equal(m.reason, 'statement_missing');
  assert.equal(m.detail.likely_account_id, 8); // autopays come from SoFi, not Chase
  assert.equal(m.detail.covered_until, '2026-08-31');
  assert.equal(m.detail.covered_from, '2026-05-01');
});

test("a likely bank that's covered doesn't make it no_match while another bank's statement is missing", () => {
  const payments = [pay(1, '2026-06-10', 2000), pay(2, '2026-09-15', 7183)];
  const m = matchPayments({ payments, bankRows: [out(12, 7, '2026-06-10', 2000)], bankAccounts: [sofi, chase] })[1];
  assert.equal(m.reason, 'statement_missing'); // usually Chase, which is covered; SoFi isn't
  assert.equal(m.detail.likely_account_id, 8);
  assert.deepEqual(m.detail.uncovered_account_ids, [8]);
});

test('not found with every bank covered: paid from somewhere not in the app', () => {
  const m = matchPayments({ payments: [pay(1, '2026-07-10', 4100)], bankRows: [], bankAccounts: [sofi, chase] })[0];
  assert.equal(m.reason, 'no_match');
  assert.deepEqual(m.detail.uncovered_account_ids, []);
});

// --- bills from a bank that no card payment matched (step 3) ---
import { explainUnlinkedBills } from './payment-match.js';

test('unmatched card bills, grouped by card and month, each with why', () => {
  const amexCard = { id: 9, name: 'Blue Cash Preferred', issuer: AMEX, mask: '5507', periods: [period('2025-11-25', '2026-09-24')] };
  const bills = [
    { id: 1, posted_date: '2025-06-02', amount_cents: -10848, description: 'AMEX EPAYMENT ACH PMT' },
    { id: 2, posted_date: '2025-06-20', amount_cents: -5000, description: 'American Express ACH Pmt' },
    { id: 3, posted_date: '2026-03-02', amount_cents: -4489, description: 'AMERICAN EXPRESS DES:ACH PMT' },
    { id: 4, posted_date: '2025-07-28', amount_cents: -15242, description: 'Barclaycard US Creditcard' },
    { id: 5, posted_date: '2025-07-28', amount_cents: -999, description: 'ONLINE PMT 1234' },
  ];
  const groups = explainUnlinkedBills({ bills, cards: [amexCard] });
  const by = Object.fromEntries(groups.map((g) => [g.key, g]));
  assert.deepEqual(Object.keys(by).sort(), [
    'card_not_in_app|Barclays|2025-07',
    'card_statement_missing|9|2025-06',
    'not_on_card|9|2026-03',
    'unknown_card|other|2025-07',
  ]);
  const june = by['card_statement_missing|9|2025-06'];
  assert.equal(june.count, 2);
  assert.equal(june.total_cents, 15848);
  assert.equal(june.covered_from, '2025-11-25');
});

// --- D200: cash, split, a person, named on the statement ---

const sofiAcct = { ...sofi, issuer: 'SoFi', mask: '5506' };
const bofa5504 = { id: 4, issuer: 'Bank of America', mask: '5504', periods: [period('2025-12-17', '2026-09-16')] };
const bofa5508 = { id: 11, issuer: 'Bank of America', mask: '5508', periods: [period('2025-12-13', '2026-09-14')] };
const banks = [sofiAcct, bofa5504, bofa5508, { ...chase, issuer: 'Chase', mask: '5505' }];
const zelle = (id, date, cents, person = 'Alex') => ({ id, account_id: 8, posted_date: date, amount_cents: -cents, description: `Zelle® Payment to ${person}`, txn_type: 'purchase', category_name: 'Zelle', zelle_type: 'SENT', zelle_person: person, contact_id: 12, contact_name: person });
const bofaPay = (id, date, cents) => ({ id, account_id: 2, posted_date: date, amount_cents: cents, description: 'BA ELECTRONIC PAYMENT', issuer: 'BOFA' });

test('someone else paid the card and was Zelled back, in one or several parts', () => {
  const payments = [bofaPay(1, '2026-08-04', 300000), bofaPay(2, '2026-08-11', 100000), bofaPay(3, '2026-08-24', 100000)];
  const bankRows = [zelle(10, '2026-08-05', 250000), zelle(11, '2026-08-06', 50000), zelle(12, '2026-08-12', 100000), zelle(13, '2026-08-17', 100000)];
  const [a, b, c] = matchPayments({ payments, bankRows, bankAccounts: banks });
  assert.deepEqual([a.via, a.status, a.part_ids, a.detail.person], ['person', 'verified', [10, 11], 'Alex']);
  assert.deepEqual(b.part_ids, [12]); // the closer Zelle
  assert.deepEqual(c.part_ids, [13]);
});

test("a Zelle never stands in for a payment the card says came from the household's own bank", () => {
  const p = { ...bofaPay(1, '2026-08-04', 100000), description: 'PAYMENT FROM CHK 5504 CONF#zqhv' };
  const [m] = matchPayments({ payments: [p], bankRows: [zelle(10, '2026-08-05', 100000)], bankAccounts: banks });
  assert.equal(m.via, 'statement');
});

test('cash at an ATM is verified by its own line', () => {
  assert.equal(cashLocation('ATM PAYMENT   RIVERTON   NC'), 'Riverton, NC');
  const [m] = matchPayments({ payments: [{ ...bofaPay(1, '2025-12-26', 140000), description: 'ATM PAYMENT RIVERTON NC' }], bankRows: [], bankAccounts: banks });
  assert.deepEqual([m.via, m.status, m.detail.location], ['cash', 'verified', 'Riverton, NC']);
});

test('two bank rows from one account that add up to one payment', () => {
  const [m] = matchPayments({ payments: [pay(1, '2026-06-18', 30000)], bankRows: [out(10, 8, '2026-06-18', 20000), out(11, 8, '2026-06-19', 10000)], bankAccounts: banks });
  assert.deepEqual([m.via, m.status, m.part_ids, m.detail.split], ['bank', 'verified', [10, 11], true]);
});

test('named on the statement: the source the card line prints, before its bank statement is here', () => {
  assert.deepEqual(namedSource('Online payment from CHK 5504', banks), { account_id: 4, issuer: 'Bank of America' });
  assert.deepEqual(namedSource('Payment Received SOFI BANK, NA', banks), { account_id: 8, issuer: 'SoFi' });
  assert.deepEqual(namedSource('Bill Payment from Bank of America', banks), { account_id: null, issuer: 'Bank of America' });
  assert.equal(namedSource('BA ELECTRONIC PAYMENT', banks), null);
  const [m] = matchPayments({ payments: [{ ...bofaPay(1, '2025-03-10', 8700), description: 'Online payment from CHK 5504' }], bankRows: [], bankAccounts: banks });
  assert.deepEqual([m.status, m.via, m.reason, m.detail.likely_account_id, m.detail.covered_from], ['named', 'statement', 'statement_missing', 4, '2025-12-17']);
});
