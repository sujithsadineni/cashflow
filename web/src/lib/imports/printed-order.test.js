import { test } from 'node:test';
import assert from 'node:assert/strict';
import { printedOrder, printedSections, sectionFigures } from './printed-order.js';

const row = (id, extra = {}) => ({ id, amount_cents: -100, txn_type: 'purchase', review_status: 'PENDING', ...extra });

test('rows follow the pages; one with no line stays after the row saved before it', () => {
  const rows = [row(1), row(2), row(3), row(4)];
  const located = { 1: { page: 2, top: 0.5 }, 2: { page: 1, top: 0.8 }, 4: { page: 1, top: 0.2 } };
  assert.deepEqual(printedOrder(rows, located).map((r) => r.id), [4, 2, 3, 1]);
  assert.deepEqual(printedOrder([row(3), row(1), row(2)], null).map((r) => r.id), [1, 2, 3], 'no pages: the reader\'s order');
});

test('a shared card\'s runs; one person\'s card gets no dividers', () => {
  const pay = row(1, { txn_type: 'payment', amount_cents: 500 });
  const a = (id) => row(id, { person_id: 1, person_name: 'Alex', card_ending: '1111' });
  const j = (id) => row(id, { person_id: 2, person_name: 'Jo', card_ending: '2222' });
  const runs = printedSections([pay, a(2), a(3), j(4)]);
  assert.deepEqual(runs.map((s) => [s.key, s.name, s.rows.length]), [[null, null, 1], ['p1', 'Alex', 2], ['p2', 'Jo', 1]]);
  assert.deepEqual(printedSections([pay, a(2)]).map((s) => s.key), [null]);
});

test('each section checked against its printed total', () => {
  const a = (id, cents, extra = {}) => row(id, { person_id: 1, card_ending: '1111', amount_cents: cents, ...extra });
  const j = (id, cents) => row(id, { person_id: 2, card_ending: '2222', amount_cents: cents });
  const runs = printedSections([a(1, -250), a(2, -100), a(3, 50, { txn_type: 'refund' }), j(4, -400), a(5, -999, { review_status: 'REJECTED' })]);
  const printed = [{ card_ending: '1111', total_cents: -350, kind: 'charges' }, { card_ending: '2222', total_cents: -401, kind: 'charges' }];
  assert.deepEqual(sectionFigures(runs[1], runs, printed), { count: 1, total_cents: -400, check: { ok: false, printed_cents: -401 } });
  // Alex is printed in two runs: checked once, on the last, over both (charges only; a skipped line doesn't count).
  assert.equal(sectionFigures(runs[0], runs, printed).check, null);
  assert.deepEqual(sectionFigures(runs[2], runs, printed).check, { ok: true, printed_cents: -350 });
});

test('Apple: matched by printed name, everything but payments', () => {
  const s = (id, cents, type = 'purchase') => row(id, { person_id: 1, spender_name: 'Alex Lee', amount_cents: cents, txn_type: type });
  const other = row(9, { person_id: 2, spender_name: 'Jo Lee' });
  const runs = printedSections([s(1, -900), s(2, 100, 'refund'), other]);
  assert.deepEqual(sectionFigures(runs[0], runs, [{ printed_name: 'ALEX  LEE', card_ending: null, total_cents: -800, kind: 'all' }]).check, { ok: true, printed_cents: -800 });
  assert.equal(sectionFigures(runs[1], runs, []).check, null, 'nothing printed, nothing to check');
});
