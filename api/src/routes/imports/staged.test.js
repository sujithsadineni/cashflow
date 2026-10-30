/**
 * A statement line's review (D335): skip one (it's the same purchase as a
 * saved one), bring it back, give a dateless line its date, and read what a
 * flagged line may duplicate. Real Express app, throwaway database.
 */
import { dbAvailable, migrate, teardown } from '../../testing/db.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

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
});

const send = (method, path, body) => fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
const one = async (sql, params) => (await query(sql, params)).rows[0];
const skip = !dbAvailable && 'needs a local Postgres';

async function statementWithRows(hash) {
  const person = await one(`INSERT INTO person (name) VALUES ('Alex') RETURNING id`);
  const card = await one(`INSERT INTO account (person_id, name, account_type, issuer, mask) VALUES ($1, 'Test Card', 'CREDIT_CARD', 'Barclays', '1111') RETURNING id`, [person.id]);
  const batch = await one(
    `INSERT INTO import_batch (original_filename, stored_path, file_type, file_hash, status, account_id, parse_method, rows_parsed)
     VALUES ('t.pdf', 'data/t.pdf', 'PDF', $1, 'REVIEW', $2, 'local', 2) RETURNING id`, [hash, card.id]);
  const rows = (await query(
    `INSERT INTO staged_transaction (import_batch_id, posted_date, description, amount_cents, txn_type)
     VALUES ($1, '2026-09-02', 'CHIPOTLE 123', -1250, 'purchase'), ($1, NULL, 'SHELL OIL 55', -4000, 'purchase') RETURNING id`, [batch.id])).rows;
  return { card, batch, rows };
}

test('a skipped line stays out of Approve all, is audited, and can come back', { skip }, async () => {
  const { batch, rows: [kept, skipped] } = await statementWithRows('d335-a');
  const res = await send('POST', `/imports/${batch.id}/staged/${skipped.id}/skip`);
  assert.equal(res.status, 200);
  assert.equal((await one('SELECT review_status FROM staged_transaction WHERE id = $1', [skipped.id])).review_status, 'REJECTED');
  assert.equal((await one(`SELECT COUNT(*)::int AS n FROM audit_log WHERE action = 'staged_transaction.skipped'`)).n, 1);
  assert.equal((await send('POST', `/imports/${batch.id}/staged/${skipped.id}/skip`)).status, 404, 'only a pending line can be skipped');

  assert.equal((await send('POST', `/imports/${batch.id}/approve`, { all: true })).status, 200, 'the dateless line no longer blocks Approve all');
  const saved = await one('SELECT COUNT(*)::int AS n FROM transaction WHERE import_batch_id = $1', [batch.id]);
  assert.equal(saved.n, 1, 'only the kept line became a transaction');
  assert.equal((await one('SELECT review_status FROM staged_transaction WHERE id = $1', [kept.id])).review_status, 'APPROVED');

  assert.equal((await send('POST', `/imports/${batch.id}/staged/${skipped.id}/restore`)).status, 200);
  assert.equal((await one('SELECT review_status FROM staged_transaction WHERE id = $1', [skipped.id])).review_status, 'PENDING');
  assert.equal((await one(`SELECT COUNT(*)::int AS n FROM audit_log WHERE action = 'staged_transaction.restored'`)).n, 1);
});

test('a statement whose every line is skipped can still be marked done', { skip }, async () => {
  const { batch, rows } = await statementWithRows('d335-b');
  for (const r of rows) assert.equal((await send('POST', `/imports/${batch.id}/staged/${r.id}/skip`)).status, 200);
  assert.equal((await send('POST', `/imports/${batch.id}/approve`, { all: true })).status, 200);
  assert.equal((await one('SELECT status FROM import_batch WHERE id = $1', [batch.id])).status, 'APPROVED');
});

test('a dateless line takes a date from its review panel, and only a real one', { skip }, async () => {
  const { batch, rows: [, dateless] } = await statementWithRows('d335-c');
  assert.equal((await send('PATCH', `/imports/${batch.id}/staged/${dateless.id}`, { posted_date: 'Sep 3' })).status, 400);
  const res = await send('PATCH', `/imports/${batch.id}/staged/${dateless.id}`, { posted_date: '2026-09-03' });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).posted_date, '2026-09-03');
});

test('a flagged line says what it may duplicate: merchant, amount and the statement it came from', { skip }, async () => {
  const { card, batch, rows: [row] } = await statementWithRows('d335-d');
  const earlier = await one(
    `INSERT INTO import_batch (original_filename, stored_path, file_type, file_hash, status, account_id, parse_method, period_start, period_end)
     VALUES ('e.pdf', 'data/e.pdf', 'PDF', 'd335-e', 'APPROVED', $1, 'local', '2026-08-06', '2026-09-05') RETURNING id`, [card.id]);
  await query(
    `INSERT INTO transaction (account_id, import_batch_id, posted_date, description, merchant, amount_cents, txn_type, dedupe_hash)
     VALUES ($1, $2, '2026-09-01', 'CHIPOTLE 123', 'Chipotle', -1250, 'purchase', 'd335-hash')`, [card.id, earlier.id]);
  const body = await (await fetch(`${base}/imports/${batch.id}/staged`)).json();
  const flagged = body.rows.find((r) => r.id === row.id);
  assert.ok(flagged.duplicate_of_id, 'the fuzzy check flagged it');
  assert.equal(flagged.duplicate_merchant, 'Chipotle');
  assert.equal(flagged.duplicate_amount_cents, -1250);
  assert.equal(flagged.duplicate_batch_id, earlier.id);
  assert.equal(flagged.duplicate_period_end, '2026-09-05');
});

test("the statement's own numbers come with its rows: saved once approved, else as read", { skip }, async () => {
  const { card, batch } = await statementWithRows('d335-f');
  await query(`UPDATE import_batch SET detected_summary = $2 WHERE id = $1`, [batch.id, JSON.stringify({ opening_balance_cents: 1000, closing_balance_cents: 6250, cashback_earned_cents: 12, payment_due_date: '2026-10-28' })]);
  let body = await (await fetch(`${base}/imports/${batch.id}/staged`)).json();
  assert.equal(body.summary.opening_cents, 1000, 'read off the page before approval');
  assert.equal(body.summary.due_date, '2026-10-28');
  assert.equal(body.summary.spend_cents, null, 'what the page did not print stays null');
  await query(`INSERT INTO statement (import_batch_id, account_id, period_start, period_end, opening_balance_cents, closing_balance_cents, total_spend_cents, payment_due_date)
               VALUES ($1, $2, '2026-08-06', '2026-09-05', 2000, 7250, 5250, '2026-10-01')`, [batch.id, card.id]);
  body = await (await fetch(`${base}/imports/${batch.id}/staged`)).json();
  assert.equal(body.summary.opening_cents, 2000, 'the saved statement wins');
  assert.equal(body.summary.spend_cents, 5250);
  assert.equal(body.summary.due_date, '2026-10-01');
});
