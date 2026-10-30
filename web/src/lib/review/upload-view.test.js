import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clueFor, missingStatements, paymentsToTrace } from './upload-view.js';

test('a missing statement says why in one line, the strongest clue first (D310)', () => {
  const facts = [{ kind: 'held_bill', cents: 8079, date: '2025-02-18' }, { kind: 'paid', cents: 8079, date: '2025-01-21', from: 'Checking' }, { kind: 'carried', cents: 8079 }];
  assert.equal(clueFor({ facts }), 'Paid $80.79 on Jan 21');
  assert.equal(clueFor({ facts: [{ kind: 'carried', cents: 8306 }] }), 'Owed $83.06 going in');
  assert.equal(clueFor({ facts: [{ kind: 'text' }] }), 'Activity that month');
});

test('missing statements per card, newest first, named the bank\'s way (D310)', () => {
  const [card] = missingStatements([{ account_id: 17, name: 'Frontier', mask: '5111', cycles: [
    { start: '2025-01-06', end: '2025-02-05', facts: [{ kind: 'carried', cents: 8079 }] },
    { start: '2025-09-06', end: '2025-10-05', facts: [] },
  ] }]);
  assert.equal(card.count, 2);
  assert.equal(card.span, 'Feb – Oct 2025');
  assert.deepEqual(card.statements.map((s) => [s.month, s.dates]), [['Oct 2025', 'Sep 6 – Oct 5'], ['Feb 2025', 'Jan 6 – Feb 5']]);
});

test('payments to trace: grouped by the account to upload, each line says where the money went (D310)', () => {
  const payments = [{ transaction_id: 1, posted_date: '2024-03-04', amount_cents: 25000, account_name: 'Blue Cash', account_mask: '5105',
    payment_source: { status: 'unverified', likely: { account_id: 7, account_name: 'Checking', mask: '5101' } } }];
  const bills = [{ card: { id: 17, name: 'Frontier', mask: '5111' }, candidates: [], bills: [
    { id: 9, date: '2025-03-04', cents: 18329, account_name: 'Checking', mask: '5115' },
    { id: 10, date: '2025-04-17', cents: 2150, account_name: 'Checking', mask: '5115' },
  ] }];
  const [frontier, bank] = paymentsToTrace(payments, bills);
  assert.deepEqual([frontier.name, frontier.count, frontier.cents, frontier.range], ['Frontier', 2, 20479, 'Mar 2025 – Apr 2025']);
  assert.deepEqual(frontier.months[0].lines[0], { key: 'b10', date: '2025-04-17', cents: 2150, text: 'From Checking ··5115', waiting: false });
  assert.equal(bank.months[0].lines[0].text, 'To Blue Cash ··5105');
});

test('payments no upload can match are set apart, with no account to upload (D310)', () => {
  const payments = [{ transaction_id: 5, posted_date: '2023-06-02', amount_cents: 45000, account_name: 'Blue Cash', account_mask: '5105',
    payment_source: { status: 'unverified', reason: 'no_match', likely: { account_id: 4, account_name: 'Checking', mask: '5115' } } }];
  const bills = [{ reason: 'unknown_card', issuer: null, candidates: [], bills: [{ id: 6, date: '2023-06-03', cents: 45000, account_name: 'Checking', mask: '5115' }] }];
  const groups = paymentsToTrace(payments, bills);
  assert.deepEqual(groups.map((g) => [g.name, g.uploadable]).sort(), [['A card the bank didn\'t name', false], ['Paid from an account not in the app', false]]);
});
