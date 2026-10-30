import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detect, matchBill, priceChanged, billStatus, monthView, rhythmOf, paymentsOf, variableBill, step, suggestionKey } from './bills.js';

let id = 0;
const c = (merchant, posted_date, amount_cents, o = {}) => ({ id: ++id, merchant, posted_date, amount_cents, account_id: 1, ...o });
const u = (merchant, posted_date, amount_cents, account_id = 1) => c(merchant, posted_date, amount_cents, { category: 'Utilities', account_id });
const bill = (o) => ({ status: 'ACTIVE', cadence: 'MONTHLY', match_name_contains: 'Netflix', expected_amount_cents: -1549, amount_varies: false, match_days_of_month: [4], ...o });

test('step: monthly lands on the day, clamped to short months; works backwards too', () => {
  assert.equal(step('2026-01-31', 'MONTHLY'), '2026-02-28');
  assert.equal(step('2026-02-28', 'MONTHLY', 1, 31), '2026-03-31');
  assert.equal(step('2026-03-17', 'MONTHLY', -1, 17), '2026-02-17');
  assert.equal(step('2026-09-01', 'ANNUAL'), '2027-09-01');
  assert.equal(step('2026-09-01', 'WEEKLY', 2), '2026-09-15');
});

test('rhythmOf: monthly with a skipped month is still monthly; weekly is weekly; noise is nothing', () => {
  assert.equal(rhythmOf(['2026-01-04', '2026-02-04', '2026-04-04', '2026-05-05']), 'MONTHLY');
  assert.equal(rhythmOf(['2026-01-01', '2026-01-08', '2026-01-15', '2026-01-22']), 'WEEKLY');
  assert.equal(rhythmOf(['2026-01-01', '2026-01-04', '2026-01-19', '2026-02-02', '2026-02-05']), null);
  assert.equal(rhythmOf(['2025-09-01', '2026-09-02']), 'ANNUAL');
});

test('paymentsOf: charges a few days apart are one payment; variableBill takes each month\'s largest', () => {
  const p = paymentsOf([u('Net', '2026-05-07', -2000), u('Net', '2026-05-07', -2000, 2), u('Net', '2026-06-18', -810), u('Net', '2026-06-19', -4000)]);
  assert.deepEqual(p.map((x) => [x.posted_date, x.amount_cents, x.parts.length]), [['2026-05-07', -4000, 2], ['2026-06-18', -4810, 2]]);
  const rent = paymentsOf([u('Rent', '2026-05-06', -25000), u('Rent', '2026-05-30', -180000), u('Rent', '2026-06-20', -25000), u('Rent', '2026-06-30', -185000), u('Rent', '2026-07-31', -190000)]);
  assert.deepEqual(variableBill(rent).payments.map((x) => x.amount_cents), [-180000, -185000, -190000]);
  assert.equal(variableBill(paymentsOf([u('X', '2026-01-05', -5000), u('X', '2026-06-05', -5000), u('X', '2026-12-05', -5000)])), null, 'three payments in a year is not monthly');
});

test('detect: Planet Fitness is a $25.05 monthly bill and a $49 yearly fee, nothing biweekly', () => {
  const s = detect([c('Planet Fitness', '2026-08-17', -2505), c('Planet Fitness', '2026-09-01', -4900), c('Planet Fitness', '2026-09-17', -2505)], [], { today: '2026-10-04' });
  assert.deepEqual(s.map((x) => [x.name, x.cadence, x.expected_amount_cents, x.day]), [
    ['Planet Fitness', 'MONTHLY', -2505, 17],
    ['Planet Fitness yearly fee', 'ANNUAL', -4900, 1],
  ]);
});

test('detect: two coffees a month apart on different days are not a bill; a stopped subscription is not suggested', () => {
  assert.deepEqual(detect([c('Starbucks', '2026-03-02', -545), c('Starbucks', '2026-03-30', -545)], [], { today: '2026-04-05' }), []);
  assert.deepEqual(detect([c('Chipotle', '2026-03-09', -1023), c('Chipotle', '2026-06-08', -1023)], [], { today: '2026-07-01' }), []); // same burrito, 3 months apart
  const old = [c('Hulu', '2025-01-05', -799), c('Hulu', '2025-02-05', -799), c('Hulu', '2025-03-05', -799)];
  assert.deepEqual(detect(old, [], { today: '2026-10-04' }), []);
});

test('detect: a variable utility is one bill with a range; charges a live bill accepts are not re-suggested; ignored stays ignored', () => {
  const util = [u('Duke Energy', '2026-06-08', -8812), u('Duke Energy', '2026-07-08', -10540), u('Duke Energy', '2026-08-09', -9377), u('Duke Energy', '2026-09-08', -11020)];
  const [s] = detect(util, [], { today: '2026-09-20' });
  assert.equal(s.kind, 'variable');
  assert.equal(s.amount_varies, true);
  assert.ok(s.match_amount_min_cents < -11020 && s.match_amount_max_cents > -8812);
  const live = { ...s, status: 'ACTIVE', match_name_contains: 'Duke Energy' };
  assert.deepEqual(detect(util, [live], { today: '2026-09-20' }), []);
  assert.equal(suggestionKey(s), 'duke energy|MONTHLY|variable', 'a variable bill is ignored whatever it costs next');
  assert.deepEqual(detect(util, [], { today: '2026-09-20', ignored: new Set([suggestionKey(s).toLowerCase()]) }), []); // stored lowercased, as the ignore route saves it
  assert.deepEqual(detect(util, [], { today: '2026-09-20', ignored: new Set(['duke energy']) }), []); // an old merchant-wide ignore still holds
});

test('detect (D364): a membership among a cinema\'s tickets is one bill, its price rise kept as history', () => {
  const rows = [];
  for (const m of ['01', '02', '03', '04']) rows.push(c('Cinema', `2026-${m}-20`, -1190, { category: 'Entertainment' }));
  for (const m of ['05', '06', '07', '08', '09']) rows.push(c('Cinema', `2026-${m}-20`, -1286, { category: 'Entertainment' }));
  for (const [d, a] of [['2026-02-03', -1745], ['2026-03-14', -2290], ['2026-05-02', -1745], ['2026-07-19', -890]]) rows.push(c('Cinema', d, a, { category: 'Entertainment' }));
  const [s, ...rest] = detect(rows, [], { today: '2026-10-01' });
  assert.equal(rest.length, 0, 'tickets are not a bill');
  assert.deepEqual([s.kind, s.cadence, s.expected_amount_cents, s.count, s.confidence], ['fixed', 'MONTHLY', -1286, 9, 'high']);
  assert.deepEqual(s.prices, [{ from: '2026-01-20', cents: -1190 }, { from: '2026-05-20', cents: -1286 }]);
});

test('detect (D364): internet paid from several cards, sometimes in two parts, with tiny charges between, is one monthly bill', () => {
  const rows = [u('Net', '2026-01-22', -4000, 1), u('Net', '2026-02-16', -4000, 2), u('Net', '2026-03-15', -4000, 3), u('Net', '2026-04-14', -2000, 4), u('Net', '2026-04-14', -2000, 5),
    u('Net', '2026-05-17', -40, 4), u('Net', '2026-05-18', -4000, 4), u('Net', '2026-07-20', -6000, 1), u('Net', '2026-08-20', -4000, 1)];
  const [s] = detect(rows, [], { today: '2026-09-01' });
  assert.deepEqual([s.kind, s.cadence, s.count, s.accounts, s.split_payments], ['variable', 'MONTHLY', 7, 5, 1]);
  assert.ok(!s.charges.some((x) => x.amount_cents === -40), 'a 40-cent check is not part of the bill');
});

test('detect (D364, D368): a new utility with two payments a month apart is asked about, with low confidence, at its average; a restaurant is not', () => {
  const [s] = detect([u('Power', '2026-07-31', -40000), u('Power', '2026-09-08', -2556, 2)], [], { today: '2026-10-01' });
  assert.deepEqual([s.kind, s.confidence, s.expected_amount_cents], ['variable', 'low', -Math.round(42556 / 3)], 'its average a month since first seen (D368)');
  assert.deepEqual(detect([c('Diner', '2026-07-31', -4000, { category: 'Dining' }), c('Diner', '2026-09-02', -3500, { category: 'Dining' }), c('Diner', '2026-10-01', -3800, { category: 'Dining' })], [], { today: '2026-10-05' }), []);
  assert.deepEqual(detect([c('Cafe', '2026-09-01', -545), c('Cafe', '2026-09-08', -545), c('Cafe', '2026-09-15', -545), c('Cafe', '2026-09-22', -545)], [], { today: '2026-09-25' }), [], 'a weekly coffee is not a bill');
});

test('matchBill: same merchant, amount within 3% (min $1), closest price wins, ended bills never match', () => {
  const monthly = bill({ id: 1, match_name_contains: 'Planet Fitness', expected_amount_cents: -2505, match_days_of_month: [17] });
  const yearly = bill({ id: 2, match_name_contains: 'Planet Fitness', cadence: 'ANNUAL', expected_amount_cents: -4900, match_days_of_month: [1] });
  assert.equal(matchBill(c('Planet Fitness', '2026-10-17', -2505), [monthly, yearly]).id, 1);
  assert.equal(matchBill(c('PLANET FITNESS', '2027-09-01', -4900), [monthly, yearly]).id, 2);
  assert.equal(matchBill(c('Planet Fitness', '2026-10-17', -9999), [monthly, yearly]), null);
  assert.equal(matchBill(c('Planet Fitness', '2026-10-17', -2505), [{ ...monthly, status: 'ENDED' }]), null);
});

test('billStatus: due, late after the grace, stopped after two cycles, and six cycles of history', () => {
  const charges = ['2026-05-04', '2026-06-04', '2026-08-04', '2026-09-04'].map((d) => c('Netflix', d, -1549));
  const due = billStatus(bill(), charges, '2026-09-30');
  assert.equal(due.next_date, '2026-10-04');
  assert.equal(due.state, 'due');
  assert.deepEqual(due.history.map((h) => h.paid), [null, true, true, false, true, true]); // Apr-Sep: Apr before the first charge, Jul missed
  // Oct 4 is due but still inside its grace on Oct 6: not shown as missed, the window still ends at Sep.
  assert.equal(billStatus(bill(), charges, '2026-10-06').history.at(-1).date, '2026-09-04');
  assert.equal(billStatus(bill(), charges, '2026-10-12').history.at(-1).paid, false); // past the grace: missed
  assert.equal(billStatus(bill(), charges, '2026-10-08').state, 'due'); // within the 5-day grace
  assert.equal(billStatus(bill(), charges, '2026-10-12').state, 'late');
  assert.equal(billStatus(bill(), charges, '2026-12-20').state, 'stopped');
  assert.equal(billStatus(bill({ status: 'PAUSED' }), charges, '2026-12-20').state, 'paused');
  assert.equal(billStatus(bill({ cadence: 'ANNUAL', expected_amount_cents: -4900 }), [], '2026-10-04').monthly_cents, 408);
});


test('monthView: paid, due within the grace, missed after it, and nothing before the bill began', () => {
  const charges = ['2026-07-04', '2026-09-03'].map((d) => c('Netflix', d, -1549));
  const sep = monthView(bill(), charges, '2026-09', '2026-10-04');
  assert.deepEqual(sep.occurrences.map((o) => [o.date, o.state]), [['2026-09-04', 'paid']]);
  assert.equal(sep.paid_cents, -1549);
  assert.equal(monthView(bill(), charges, '2026-08', '2026-10-04').status, 'missed');
  const oct = monthView(bill(), charges, '2026-10', '2026-10-06'); // Oct 4, inside its 5-day grace
  assert.equal(oct.status, 'due');
  assert.equal(oct.due_cents, -1549);
  assert.equal(monthView(bill(), charges, '2026-10', '2026-10-12').status, 'missed');
  assert.equal(monthView(bill(), charges, '2026-05', '2026-10-04').status, 'none'); // before the first charge
});

test('monthView: a weekly bill has several dates a month; a yearly one is "none" in other months', () => {
  const weekly = bill({ cadence: 'WEEKLY', match_days_of_month: null });
  const charges = ['2026-09-01', '2026-09-08', '2026-09-22'].map((d) => c('Gym', d, -1000));
  const v = monthView(weekly, charges, '2026-09', '2026-10-04');
  assert.deepEqual(v.occurrences.map((o) => o.state), ['paid', 'paid', 'missed', 'paid', 'missed']);
  const yearly = bill({ cadence: 'ANNUAL', match_days_of_month: [1], expected_amount_cents: -4900 });
  assert.equal(monthView(yearly, [c('PF', '2026-09-01', -4900)], '2026-10', '2026-10-04').status, 'none');
  assert.equal(monthView(yearly, [c('PF', '2026-09-01', -4900)], '2026-09', '2026-10-04').status, 'paid');
});

test('matchBill (D364): a fixed bill at a new price is matched on its day, but not twice in one cycle and not off its day', () => {
  const club = bill({ id: 7, match_name_contains: 'Cinema', expected_amount_cents: -1000, match_days_of_month: [20] });
  const rise = c('Cinema', '2026-05-20', -1290);
  assert.equal(matchBill(rise, [club]), club, 'a new price on the bill\'s day');
  assert.equal(priceChanged(rise, club), true);
  assert.equal(matchBill(c('Cinema', '2026-05-09', -1290), [club], new Map()), null, 'off its day: a ticket');
  assert.equal(matchBill(c('Cinema', '2026-05-21', -1500), [club], new Map([[7, ['2026-05-20']]])), null, 'that cycle is already paid');
  assert.equal(matchBill(c('Cinema', '2026-05-20', -4500), [club]), null, 'more than double is not the same bill');
  assert.equal(matchBill(c('Cinema', '2026-05-20', -2000), [{ ...club, amount_varies: true, match_amount_min_cents: -1500, match_amount_max_cents: -500 }]), null, 'a variable bill keeps its range');
  assert.equal(matchBill(c('Cinema', '2026-06-01', -1290), [{ ...club, match_days_of_month: [30] }])?.id, 7, 'the 30th and the 1st are two days apart');
});

test('monthView (D364): a variable bill paid in two parts counts whole', () => {
  const net = bill({ cadence: 'MONTHLY', expected_amount_cents: -4000, amount_varies: true, match_amount_min_cents: -9000, match_amount_max_cents: 0, match_days_of_month: [7] });
  const v = monthView(net, [{ id: 1, posted_date: '2026-04-07', amount_cents: -4000 }, { id: 2, posted_date: '2026-05-07', amount_cents: -2000 }, { id: 3, posted_date: '2026-05-08', amount_cents: -2000 }], '2026-05', '2026-05-30');
  assert.deepEqual(v.occurrences.map((o) => [o.state, o.charge?.amount_cents]), [['paid', -4000]]);
  assert.equal(v.paid_cents, -4000);
});

test('matchBill (D365): a membership is charged on its day, once a cycle; tickets at the same counter are not it', () => {
  const club = bill({ id: 9, match_name_contains: 'Cinema', expected_amount_cents: -1286, match_days_of_month: [21] });
  assert.equal(matchBill(c('Cinema', '2026-03-21', -1286), [club], new Map())?.id, 9);
  assert.equal(matchBill(c('Cinema', '2026-03-09', -1290), [club], new Map()), null, 'a ticket within $1 of the price, off the day');
  assert.equal(matchBill(c('Cinema', '2026-03-23', -1286), [club], new Map([[9, ['2026-03-21']]])), null, 'a second one in the same cycle');
  assert.equal(matchBill(c('Cinema', '2026-03-18', -905), [club], new Map([[9, ['2026-03-21']]])), null, 'a ticket three days before a paid cycle');
  assert.equal(matchBill(c('Cinema', '2026-03-18', -905), [club], new Map(), { pass: 'close' }), null, 'price changes wait for the last pass');
  assert.equal(matchBill(c('Cinema', '2026-03-16', -1250), [club], new Map(), { pass: 'cents' }), null, 'a near price waits for the exact one');
  const util = bill({ id: 4, match_name_contains: 'Power', amount_varies: true, match_amount_min_cents: -50000, match_amount_max_cents: 0, match_days_of_month: [20] });
  assert.equal(matchBill(c('Power', '2026-03-08', -2556), [util], new Map([[4, ['2026-03-01']]]))?.id, 4, 'a bill paid by hand, any day, any number of parts');
});
