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
process.env.ACCOUNT_IMAGES_DIR = path.join(statements, 'data', 'account-images');
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

test('a shared statement creates its people, members and limit in one go (D400)', { skip }, async () => {
  const owner = (await query(`SELECT id FROM person WHERE name = 'Sam Sample'`)).rows[0];
  const batch = await (await upload('fresh-d.csv', BANK_CSV.replace('3200.00', '2900.00'))).json();
  await send('POST', `/imports/${batch.id}/parse`);
  const res = await send('POST', `/imports/${batch.id}/account`, { create: {
    name: 'Shared Card', account_type: 'CREDIT_CARD', credit_limit_cents: 500000,
    members: [
      { printed_name: 'SAM SAMPLE', role: 'owner', person_id: owner.id },
      { printed_name: 'RIO SAMPLE', role: 'additional', new_person: 'Rio Sample', card_ending: '4321' },
    ],
  } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.new_people.length, 1);
  const account = (await query('SELECT person_id, credit_limit_manual_cents FROM account WHERE id = $1', [body.account_id])).rows[0];
  assert.equal(account.person_id, owner.id, 'the primary owns it');
  assert.equal(Number(account.credit_limit_manual_cents), 500000);
  const members = (await query('SELECT role, printed_name, card_ending FROM account_member WHERE account_id = $1 ORDER BY role DESC', [body.account_id])).rows;
  assert.deepEqual(members.map((m) => [m.role, m.printed_name, m.card_ending]), [['owner', 'SAM SAMPLE', null], ['additional', 'RIO SAMPLE', '4321']]);
  assert.equal((await query(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'account.member_added' AND entity_id = $1`, [body.account_id])).rows[0].n, 2);
});

test('a shared statement needs one primary and a different person per name', { skip }, async () => {
  const owner = (await query(`SELECT id FROM person WHERE name = 'Sam Sample'`)).rows[0];
  const batch = await (await upload('fresh-e.csv', BANK_CSV.replace('3200.00', '2800.00'))).json();
  await send('POST', `/imports/${batch.id}/parse`);
  const twice = await send('POST', `/imports/${batch.id}/account`, { create: { name: 'X', account_type: 'CREDIT_CARD', members: [
    { printed_name: 'A', role: 'owner', person_id: owner.id }, { printed_name: 'B', role: 'additional', person_id: owner.id }] } });
  assert.equal(twice.status, 400);
  const noPrimary = await send('POST', `/imports/${batch.id}/account`, { create: { name: 'X', account_type: 'CREDIT_CARD', members: [
    { printed_name: 'A', role: 'co_owner', person_id: owner.id }, { printed_name: 'B', role: 'co_owner', new_person: 'Bo Sample' }] } });
  assert.equal(noPrimary.status, 400);
  assert.equal((await query(`SELECT count(*)::int AS n FROM person WHERE name = 'Bo Sample'`)).rows[0].n, 0, 'nothing half-made');
});

test('a known card can wear its picture from the app\'s card art, like an upload (D407)', { skip }, async () => {
  const owner = (await query(`SELECT id FROM person WHERE name = 'Sam Sample'`)).rows[0];
  const card = await (await send('POST', '/accounts', { person_id: owner.id, name: 'Apple Card', issuer: 'Goldman Sachs Bank USA', account_type: 'CREDIT_CARD', mask: '7777' })).json();
  const res = await send('POST', `/accounts/${card.id}/card-art`, { key: 'apple-card' });
  assert.equal(res.status, 201);
  assert.match((await res.json()).image_path, new RegExp(`^data/account-images/${card.id}-[0-9a-f]{16}\\.png$`));
  assert.equal((await query(`SELECT detail->>'card_art' AS art FROM audit_log WHERE action = 'account.image_updated' AND entity_id = $1`, [card.id])).rows[0].art, 'apple-card');
  assert.equal((await send('POST', `/accounts/${card.id}/card-art`, { key: 'no-such-card' })).status, 400);
});
