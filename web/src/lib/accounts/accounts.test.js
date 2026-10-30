import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupAccounts, forPerson, rowStatus, lastActivity, issuerChoices, lookAlikes, formOf, problemsOf, changesOf } from './accounts.js';

// Invented accounts with the real shapes: one bank spelled two ways, a card
// reopened as a new account with the same last four, a savings balance.
const card = (over) => ({ id: 1, person_id: 1, name: 'Everyday Card', issuer: 'Bank of America', account_type: 'CREDIT_CARD', mask: '1111', is_active: true, ...over });
const accounts = [
  card({ id: 1 }),
  card({ id: 2, name: 'Travel Card', issuer: 'BOFA', mask: '2222', person_id: 2 }),
  card({ id: 3, name: 'Store Card', issuer: 'Northwind', mask: '3333' }),
  { id: 4, person_id: 1, name: 'Main Checking', issuer: 'Chase', account_type: 'CHECKING', mask: '4444', is_active: true },
  { id: 5, person_id: 2, name: 'Rainy Day', issuer: 'Northwind', account_type: 'SAVINGS', mask: null, is_active: true, balance_cents: '1234567' },
];

test('cards first, then bank accounts; an empty group is left out', () => {
  assert.deepEqual(groupAccounts(accounts).map((g) => [g.key, g.rows.map((a) => a.id)]), [['cards', [1, 2, 3]], ['banks', [4, 5]]]);
  assert.deepEqual(groupAccounts(accounts.filter((a) => a.account_type === 'CHECKING')).map((g) => g.key), ['banks']);
});

test('a person filter keeps their accounts; null is everyone', () => {
  assert.deepEqual(forPerson(accounts, 2).map((a) => a.id), [2, 5]);
  assert.equal(forPerson(accounts, null).length, 5);
});

test('a card row says where its newest bill stands, briefly', () => {
  const due = (status, extra = {}) => rowStatus(card({ payment_due: { status, due_date: '2026-11-02', days_left: 5, ...extra } }));
  assert.deepEqual(due('due'), { text: 'Due Nov 2', tone: 'muted' });
  assert.deepEqual(due('due_soon', { days_left: 0 }), { text: 'Due today', tone: 'warn' });
  assert.deepEqual(due('overdue'), { text: 'Overdue', tone: 'spend' });
  assert.deepEqual(due('unconfirmed'), { text: 'Paid?', tone: 'warn' });
  assert.deepEqual(due('paid'), { text: 'Paid', tone: 'earn' });
  assert.equal(due('nothing_due'), null);
  assert.equal(rowStatus(card()), null);
});

test('a savings row shows its balance; checking shows nothing', () => {
  assert.deepEqual(rowStatus(accounts[4]), { text: '$12,345.67', tone: 'muted' });
  assert.equal(rowStatus(accounts[3]), null);
});

test('last activity, or none yet', () => {
  assert.equal(lastActivity({ last_posted: '2026-10-07' }), 'Last activity Oct 7');
  assert.equal(lastActivity({ last_posted: null }), 'No activity yet');
});

test('issuers to pick from: one spelling per bank, alphabetical', () => {
  assert.deepEqual(issuerChoices([...accounts, { issuer: '' }, { issuer: null }]), ['Bank of America', 'Chase', 'Northwind']);
});

test('look-alikes share the last four and a name or a bank', () => {
  const reopened = card({ id: 9, is_active: false });
  const otherBankSameDigits = card({ id: 10, name: 'Other', issuer: 'Elsewhere' });
  const spelledDifferently = card({ id: 11, name: 'Renamed', issuer: 'BOFA' });
  const all = [...accounts, reopened, otherBankSameDigits, spelledDifferently];
  assert.deepEqual(lookAlikes(accounts[0], all).map((a) => a.id), [9, 11]);
  assert.deepEqual(lookAlikes(accounts[4], all), []);
});

test('the form flags problems as they are typed', () => {
  const form = formOf(accounts[0]);
  assert.deepEqual(problemsOf(form), {});
  assert.deepEqual(problemsOf({ ...form, name: ' ', mask: '12', closing_day: '32', due_day: 'x' }), {
    name: 'Give it a name', mask: 'Exactly 4 digits', closing_day: 'A day from 1 to 31', due_day: 'A day from 1 to 31',
  });
  assert.deepEqual(problemsOf({ ...form, mask: '', closing_day: '', due_day: '31' }), {});
});

test('only changed fields are sent, in the API shape', () => {
  const before = formOf(card({ closing_day: 5 }));
  assert.deepEqual(changesOf(before, before), {});
  assert.deepEqual(changesOf(before, { ...before, name: ' New Name ', person_id: '2', closing_day: '', status: 'closed' }),
    { name: 'New Name', person_id: 2, closing_day: null, is_active: false });
});

test('a nickname is edited like any field; blank clears it back to the full name (D353)', () => {
  const before = formOf({ ...accounts[0], nickname: null });
  assert.equal(before.nickname, '');
  assert.deepEqual(changesOf(before, { ...before, nickname: ' BofA Custom ' }), { nickname: 'BofA Custom' });
  const named = formOf({ ...accounts[0], nickname: 'Everyday' });
  assert.deepEqual(changesOf(named, { ...named, nickname: '' }), { nickname: '' });
  assert.equal(problemsOf({ ...named, nickname: 'x'.repeat(25) }).nickname, 'Keep it to 24 characters');
});

test('a limit set by hand: typed in dollars, sent in cents, blank clears it, nonsense is refused (D354)', () => {
  const before = formOf({ ...accounts[0], credit_limit_manual_cents: null });
  assert.equal(before.credit_limit_manual, '');
  assert.deepEqual(changesOf(before, { ...before, credit_limit_manual: '5,000' }), { credit_limit_manual_cents: 500000 });
  const set = formOf({ ...accounts[0], credit_limit_manual_cents: 750000 });
  assert.equal(set.credit_limit_manual, '7,500.00');
  assert.deepEqual(changesOf(set, { ...set, credit_limit_manual: '' }), { credit_limit_manual_cents: null });
  assert.equal(problemsOf({ ...set, credit_limit_manual: 'lots' }).credit_limit_manual, 'A dollar amount, like 5,000');
  assert.equal(problemsOf({ ...set, credit_limit_manual: '0' }).credit_limit_manual, 'A dollar amount, like 5,000');
});
