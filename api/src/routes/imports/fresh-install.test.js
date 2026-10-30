/**
 * A new install's first statement, from an empty database: no people, no
 * accounts. The owner is added with the account, a bank CSV keeps its own
 * signs whatever its words, and its rows get types. Every other route test
 * starts with people and accounts already there, which is how these broke
 * unseen. Real Express app, throwaway database, statements in a temp folder.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { dbAvailable, migrate, teardown } from '../../testing/db.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

// Stored paths read data/statements/…, resolved two folders above STATEMENTS_DIR.
const statements = mkdtempSync(path.join(tmpdir(), 'cashflow-fresh-'));
process.env.STATEMENTS_DIR = path.join(statements, 'data', 'statements');
let base, server, query;

before(async () => {
  if (!dbAvailable) return;
  await migrate();
  ({ query } = await import('../../core/db.js'));
  const { app } = await import('../../index.js');
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(async () => {
  server?.close();
  await teardown();
  rmSync(statements, { recursive: true, force: true });
});

const send = (method, p, body) => fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
const upload = (name, text, accountId) => {
  const form = new FormData();
  form.append('statement', new Blob([text], { type: 'text/csv' }), name);
  if (accountId) form.append('account_id', String(accountId));
  return fetch(`${base}/imports`, { method: 'POST', body: form });
};
const skip = !dbAvailable && 'needs a local Postgres';

// A bank's export whose card payment reads like a card's own ("THANK YOU").
const BANK_CSV = 'Date,Description,Amount\n' +
  '10/01/2026,PAYROLL SAMPLE CO DIRECT DEP,3200.00\n' +
  '10/02/2026,SAMPLE APARTMENTS RENT,-1500.00\n' +
  '10/18/2026,SAMPLE CARD ONLINE PAYMENT THANK YOU,-640.55\n';

test('on an empty database the first CSV waits for an account, and a missing owner gets a plain message', { skip }, async () => {
  assert.equal((await query('SELECT count(*)::int AS n FROM person')).rows[0].n, 0);
  const batch = await (await upload('fresh-a.csv', BANK_CSV)).json();
  const parsed = await send('POST', `/imports/${batch.id}/parse`);
  assert.equal((await parsed.json()).status, 'NEEDS_ACCOUNT');

  const res = await send('POST', `/imports/${batch.id}/account`, { create: { person_id: '', name: 'Sample Checking', account_type: 'CHECKING' } });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'Pick whose account it is');
});

test('attached to a new checking account, the first CSV keeps the bank\'s signs and gets types', { skip }, async () => {
  const person = await (await send('POST', '/people', { name: 'Sam Sample' })).json();
  const batch = await (await upload('fresh-b.csv', BANK_CSV.replace('3200.00', '3100.00'))).json();
  await send('POST', `/imports/${batch.id}/parse`);
  const res = await send('POST', `/imports/${batch.id}/account`, { create: { person_id: person.id, name: 'Sample Checking', account_type: 'CHECKING' } });
  assert.equal(res.status, 200);
  const { rows } = await query('SELECT amount_cents, txn_type FROM staged_transaction WHERE import_batch_id = $1 ORDER BY posted_date, id', [batch.id]);
  assert.deepEqual(rows.map((r) => [r.amount_cents, r.txn_type]), [[310000, 'deposit'], [-150000, 'purchase'], [-64055, 'purchase']]);
});

test('uploaded onto a known checking account, a CSV is never flipped', { skip }, async () => {
  const { rows: [acct] } = await query(`SELECT id FROM account WHERE account_type = 'CHECKING' LIMIT 1`);
  const batch = await (await upload('fresh-c.csv', BANK_CSV.replace('3200.00', '3000.00'), acct.id)).json();
  await send('POST', `/imports/${batch.id}/parse`);
  const { rows } = await query('SELECT amount_cents, txn_type FROM staged_transaction WHERE import_batch_id = $1 ORDER BY posted_date, id', [batch.id]);
  assert.deepEqual(rows.map((r) => [r.amount_cents, r.txn_type]), [[300000, 'deposit'], [-150000, 'purchase'], [-64055, 'purchase']]);
});

test('two people can\'t share one name, on add or rename', { skip }, async () => {
  const res = await send('POST', '/people', { name: '  sam sample ' });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error, 'Someone with that name is already here');
  const other = await (await send('POST', '/people', { name: 'Jo Sample' })).json();
  assert.equal((await send('PATCH', `/people/${other.id}`, { name: 'Sam Sample' })).status, 409);
  assert.equal((await send('PATCH', `/people/${other.id}`, { name: 'Jo Sample' })).status, 200, 'keeping one\'s own name is fine');
});
