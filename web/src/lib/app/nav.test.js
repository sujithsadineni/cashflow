import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nearestPage, pageTitle } from './nav.js';

test('a typo finds the page it meant', () => {
  assert.equal(nearestPage('/transactons')?.to, '/transactions');
  assert.equal(nearestPage('/Setings')?.to, '/settings');
  assert.equal(nearestPage('/card/12')?.to, '/cards');
});

test('an unrelated address suggests nothing', () => {
  assert.equal(nearestPage('/banana'), null);
  assert.equal(nearestPage('/'), null);
});

test('page titles name the page, its settings tab and its count', () => {
  assert.equal(pageTitle('/transactions'), 'Transactions · cashflow');
  assert.equal(pageTitle('/review', '?tab=payments', { '/review': 46 }), 'Review (46) · cashflow');
  assert.equal(pageTitle('/alerts', '', { '/alerts': 0 }), 'Alerts · cashflow');
  assert.equal(pageTitle('/settings', '?tab=loans'), 'Loans · Settings · cashflow');
  assert.equal(pageTitle('/settings', '?tab=icons'), 'Merchants · Settings · cashflow');
  assert.equal(pageTitle('/transactons'), 'Page not found · cashflow');
  assert.equal(pageTitle('/'), 'cashflow');
});
