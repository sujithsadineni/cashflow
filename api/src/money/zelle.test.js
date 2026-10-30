import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zelleKind, personOf, zelleYear } from './zelle.js';

test('a Zelle row by its review, and who it was with', () => {
  assert.equal(zelleKind({ zelle_type: 'SENT' }), 'sent');
  assert.equal(zelleKind({ zelle_type: 'INTERNAL' }), 'internal');
  assert.equal(zelleKind({ zelle_type: null }), 'unreviewed');
  assert.equal(personOf({ contact_id: 3, contact_name: 'Jordan Lee', contact_nickname: 'Jordan' }).name, 'Jordan');
  assert.equal(personOf({ zelle_person: 'Honey' }).key, 'n:honey');
  assert.equal(personOf({}).key, 'unknown');
});

test('months count what moved, sent and received; between you is shown but not counted (D288)', () => {
  const accounts = [{ id: 1, name: 'Checking' }];
  const row = (id, date, cents, zelle_type, contact_id, contact_name) => ({ id, account_id: 1, posted_date: date, amount_cents: cents, zelle_type, contact_id, contact_name, description: 'Zelle' });
  const y = zelleYear({ accounts, year: '2026', rows: [
    row(1, '2026-03-02', -100000, 'SENT', 7, 'Jordan'),
    row(2, '2026-03-05', 100000, 'RECEIVED', 7, 'Jordan'),
    row(3, '2026-03-09', -50000, 'INTERNAL', 9, 'Alex'),
    row(5, '2026-03-10', 50000, 'INTERNAL', 9, 'Alex'),
    row(4, '2026-04-01', 20000, 'RECEIVED', 8, 'Sam'),
  ] });
  assert.equal(y.months[2].total, 200000, 'March moved $2,000, not a net $0');
  assert.equal(y.months[2].internal, 50000, 'between you is what moved, not its $0 net');
  assert.deepEqual([y.by_kind.sent, y.by_kind.received, y.by_kind.internal], [-100000, 120000, 50000]);
  assert.equal(y.total_cents, 220000);
  assert.deepEqual(y.people.map((p) => [p.name, p.sent_cents, p.received_cents, p.count]), [
    ['Jordan', -100000, 100000, 2], ['Sam', 0, 20000, 1], ['Alex', 0, 0, 2],
  ], 'most money moved first, either way');
});
