import { test } from 'node:test';
import assert from 'node:assert/strict';
import { investKind, indiaKind, investmentYear } from './category-flows.js';
import { explorerResponse } from './year-explorer.js';

test('investment by how it moved', () => {
  assert.equal(investKind({ amount_cents: -50000, description: 'ROBINHOOD DES:DEBITS ID:X' }), 'pulled');
  assert.equal(investKind({ amount_cents: -50000, description: 'Robinhood Debits 531 Web ID: 5326' }), 'pulled');
  assert.equal(investKind({ amount_cents: -100000, description: 'Instant Payment; Robinhood Securities Payment Request' }), 'instant');
  assert.equal(investKind({ amount_cents: -200000, description: '08/10 Online Realtime Payment To Robinhood Se' }), 'instant');
  assert.equal(investKind({ amount_cents: 7000, description: 'Inter-Entity Transfer from Robinhood Investing' }), 'back');
});

test('to India by the service that carried it', () => {
  assert.equal(indiaKind({ merchant: 'Tribe', description: 'Fbo Frex (Tradit Tribe - Tr Web ID: 1' }), 'tribe');
  assert.equal(indiaKind({ merchant: 'Frex', description: 'Fbo Frex (Tradit Frex - Tra Web ID: 1' }), 'frex');
  assert.equal(indiaKind({ merchant: null, description: 'Payment Sent 03/12 Rmtly* R4C63 Remitly.Com W' }), 'remitly');
  assert.equal(indiaKind({ merchant: null, description: 'CYBRID-CROBO.MON a1b2' }), 'crobo');
});

test('an explorer response: the year, the year before to the same month, the years on file (D286)', () => {
  const rows = [
    { id: 1, account_id: 1, posted_date: '2025-03-01', amount_cents: -1000, description: 'ROBINHOOD DES:DEBITS' },
    { id: 2, account_id: 1, posted_date: '2025-11-01', amount_cents: -4000, description: 'ROBINHOOD DES:DEBITS' },
    { id: 3, account_id: 1, posted_date: '2026-02-01', amount_cents: -2500, description: 'Instant Payment' },
  ];
  const r = explorerResponse({ year: '2026', build: (y) => investmentYear({ rows, accounts: [{ id: 1, name: 'Checking' }], year: y }), dates: rows.map((x) => x.posted_date), today: new Date(2026, 4, 10) });
  assert.equal(r.total_cents, -2500);
  assert.equal(r.through_month, 5);
  assert.deepEqual(r.previous_year, { year: 2025, total_cents: -5000, to_date_cents: -1000 });
  assert.deepEqual(r.years, [2026, 2025]);
  assert.equal(r.by_kind.instant, -2500);
});
