import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detect, matchBill, billStatus, monthView, rhythmOf, splitByPrice, step, suggestionKey } from './bills.js';

let id = 0;
const c = (merchant, posted_date, amount_cents) => ({ id: ++id, merchant, posted_date, amount_cents, account_id: 1 });
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

test('splitByPrice: exact repeats first, the rest one variable bill only when three or more', () => {
  const g = splitByPrice([c('PF', '2026-08-17', -2505), c('PF', '2026-09-01', -4900), c('PF', '2026-09-17', -2505)]);
  assert.deepEqual(g.map((x) => x.map((t) => t.amount_cents)), [[-2505, -2505], [-4900]]);
  const util = splitByPrice([c('Power', '2026-01-08', -8812), c('Power', '2026-02-08', -10540), c('Power', '2026-03-08', -9377)]);
  assert.equal(util.length, 1);
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
  const util = [c('Duke Energy', '2026-06-08', -8812), c('Duke Energy', '2026-07-08', -10540), c('Duke Energy', '2026-08-09', -9377), c('Duke Energy', '2026-09-08', -11020)];
  const [s] = detect(util, [], { today: '2026-09-20' });
  assert.equal(s.amount_varies, true);
  assert.ok(s.match_amount_min_cents < -11020 && s.match_amount_max_cents > -8812);
  const live = { ...s, status: 'ACTIVE', match_name_contains: 'Duke Energy' };
  assert.deepEqual(detect(util, [live], { today: '2026-09-20' }), []);
  assert.deepEqual(detect(util, [], { today: '2026-09-20', ignored: new Set([suggestionKey(s).toLowerCase()]) }), []); // stored lowercased, as the ignore route saves it
  assert.deepEqual(detect(util, [], { today: '2026-09-20', ignored: new Set(['duke energy']) }), []); // an old merchant-wide ignore still holds
});

test('matchBill: same merchant, amount within 3% (min $1), closest price wins, ended bills never match', () => {
  const monthly = bill({ id: 1, match_name_contains: 'Planet Fitness', expected_amount_cents: -2505 });
  const yearly = bill({ id: 2, match_name_contains: 'Planet Fitness', cadence: 'ANNUAL', expected_amount_cents: -4900 });
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
