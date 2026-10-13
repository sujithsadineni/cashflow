/**
 * Route tests for the endpoints that write money data (D209): approving
 * an import, approving a Review finding, and setting a payment's source
 * by hand. Each runs the real Express app against a throwaway database
 * built from the real migrations (testing/db.js).
 */
import { dbAvailable, migrate, teardown } from '../testing/db.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

let base, server, query;

before(async () => {
  if (!dbAvailable) return;
  await migrate();
  ({ query } = await import('../db.js'));
  const { app } = await import('../index.js');
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(async () => {
  server?.close();
  await teardown();
});

const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
const one = async (sql, params) => (await query(sql, params)).rows[0];
const skip = !dbAvailable && 'needs a local Postgres';

async function fixtures() {
  const person = await one(`INSERT INTO person (name) VALUES ('Alex') RETURNING id`);
  const card = await one(`INSERT INTO account (person_id, name, account_type, issuer, mask) VALUES ($1, 'Test Card', 'CREDIT_CARD', 'Barclays', '1111') RETURNING id`, [person.id]);
  const bank = await one(`INSERT INTO account (person_id, name, account_type, issuer, mask) VALUES ($1, 'Test Checking', 'CHECKING', 'SoFi', '2222') RETURNING id`, [person.id]);
  return { person, card, bank };
}

test('approving an import moves its rows into transactions, audits it, and reports what changed', { skip }, async () => {
  const { card } = await fixtures();
  const batch = await one(
    `INSERT INTO import_batch (original_filename, stored_path, file_type, file_hash, status, account_id, parse_method)
     VALUES ('t.pdf', 'data/t.pdf', 'PDF', 'hash-1', 'REVIEW', $1, 'local') RETURNING id`, [card.id]);
  await query(
    `INSERT INTO staged_transaction (import_batch_id, posted_date, description, amount_cents, txn_type, suggested_category)
     VALUES ($1, '2026-09-02', 'CHIPOTLE 123', -1250, 'purchase', 'Dining'),
            ($1, '2026-09-10', 'PAYMENT THANK YOU', 50000, 'payment', 'Card Payment')`, [batch.id]);

  const res = await post(`/imports/${batch.id}/approve`, { all: true });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.rows_approved, 2);
  assert.ok(body.follow_up, 'the re-check and re-match ran and reported back');

  const saved = (await query('SELECT amount_cents, txn_type FROM transaction WHERE account_id = $1 ORDER BY posted_date', [card.id])).rows;
  assert.deepEqual(saved, [{ amount_cents: -1250, txn_type: 'purchase' }, { amount_cents: 50000, txn_type: 'payment' }]);
  assert.equal((await one(`SELECT COUNT(*)::int AS n FROM staged_transaction WHERE import_batch_id = $1 AND review_status = 'PENDING'`, [batch.id])).n, 0);
  assert.ok(await one(`SELECT 1 FROM audit_log WHERE action = 'import.approved' AND entity_id = $1`, [batch.id]));

  // Approving again has nothing left to approve, and writes nothing.
  assert.equal((await post(`/imports/${batch.id}/approve`, { all: true })).status, 400);
});

test('approving a wrong-sign finding flips exactly that amount; a different value is refused', { skip }, async () => {
  const { card } = await fixtures();
  const t = await one(`INSERT INTO transaction (account_id, posted_date, description, amount_cents, txn_type, dedupe_hash)
                       VALUES ($1, '2026-09-10', 'BT TO CK', 2000000, 'transfer', 'h-bt') RETURNING id`, [card.id]);
  const finding = async () => one(
    `INSERT INTO transaction_review (transaction_id, check_kind, field, current_value, suggested_value, reason)
     VALUES ($1, 'amount_sign', 'amount', '2000000', '-2000000', 'test')
     ON CONFLICT (transaction_id, check_kind) DO UPDATE SET status = 'pending' RETURNING id`, [t.id]);

  const f = await finding();
  assert.equal((await post(`/transaction-review/${f.id}/approve`, { value: '-1' })).status, 400);
  assert.equal((await one('SELECT amount_cents FROM transaction WHERE id = $1', [t.id])).amount_cents, 2000000);

  assert.equal((await post(`/transaction-review/${f.id}/approve`)).status, 200);
  assert.equal((await one('SELECT amount_cents FROM transaction WHERE id = $1', [t.id])).amount_cents, -2000000);
  assert.equal((await one('SELECT status FROM transaction_review WHERE id = $1', [f.id])).status, 'approved');
  assert.ok(await one(`SELECT 1 FROM audit_log WHERE action = 'transaction_review.approved' AND entity_id = $1`, [t.id]));
  // Already resolved: a second approve is a 404, not a second flip.
  assert.equal((await post(`/transaction-review/${f.id}/approve`)).status, 404);
});

test('a payment source set by hand is kept, survives a re-match, and Undo hands it back', { skip }, async () => {
  const { card } = await fixtures();
  const pay = await one(`INSERT INTO transaction (account_id, posted_date, description, amount_cents, txn_type, dedupe_hash)
                         VALUES ($1, '2026-08-04', 'BA ELECTRONIC PAYMENT', 300000, 'payment', 'h-pay') RETURNING id`, [card.id]);

  assert.equal((await post(`/payment-matches/${pay.id}`, { via: 'person' })).status, 400); // who is required
  assert.equal((await post(`/payment-matches/${pay.id}`, { via: 'person', label: 'Alex' })).status, 200);
  const set = await one('SELECT via, status, source, detail FROM payment_match WHERE card_transaction_id = $1', [pay.id]);
  assert.deepEqual([set.via, set.status, set.source, set.detail.person], ['person', 'verified', 'manual', 'Alex']);

  const { runPaymentMatch } = await import('../payment-match-run.js');
  await runPaymentMatch({ accountIds: [card.id] });
  assert.equal((await one('SELECT source FROM payment_match WHERE card_transaction_id = $1', [pay.id])).source, 'manual');

  const undo = await fetch(`${base}/payment-matches/${pay.id}/manual`, { method: 'DELETE' });
  assert.equal(undo.status, 200);
  const back = await one('SELECT source, status FROM payment_match WHERE card_transaction_id = $1', [pay.id]);
  assert.deepEqual([back.source, back.status], ['auto', 'unverified']);
  // Not a card payment at all: refused.
  assert.equal((await post('/payment-matches/999999', { via: 'cash' })).status, 404);
});

test('deleting a statement whose rows are matched or flagged works, and the other side is re-matched (D227)', { skip }, async () => {
  const { card, bank } = await fixtures();
  const batch = async (accountId, hash) => one(
    `INSERT INTO import_batch (original_filename, stored_path, file_type, file_hash, status, account_id, parse_method)
     VALUES ('s.pdf', 'data/statements/none.pdf', 'PDF', $2, 'APPROVED', $1, 'local') RETURNING id`, [accountId, hash]);
  const bankBatch = await batch(bank.id, 'hash-del-bank');
  const cardBatch = await batch(card.id, 'hash-del-card');
  const bankRow = await one(`INSERT INTO transaction (account_id, import_batch_id, posted_date, description, amount_cents, txn_type, dedupe_hash)
                             VALUES ($1, $2, '2026-09-02', 'BARCLAYCARD US CREDITCARD', -12345, 'payment', 'h-del-bank') RETURNING id`, [bank.id, bankBatch.id]);
  const cardRow = await one(`INSERT INTO transaction (account_id, import_batch_id, posted_date, description, amount_cents, txn_type, dedupe_hash)
                             VALUES ($1, $2, '2026-09-01', 'PAYMENT THANK YOU', 12345, 'payment', 'h-del-card') RETURNING id`, [card.id, cardBatch.id]);
  await query(`INSERT INTO staged_transaction (import_batch_id, posted_date, description, amount_cents, transaction_id, review_status)
               VALUES ($1, '2026-09-02', 'BARCLAYCARD US CREDITCARD', -12345, $2, 'APPROVED')`, [bankBatch.id, bankRow.id]);

  const { runPaymentMatch } = await import('../payment-match-run.js');
  await runPaymentMatch({ accountIds: [card.id] });
  assert.equal((await one('SELECT status FROM payment_match WHERE card_transaction_id = $1', [cardRow.id])).status, 'verified');
  await query(`INSERT INTO transaction_review (transaction_id, check_kind, field, current_value, suggested_value, reason)
               VALUES ($1, 'type_history', 'txn_type', 'payment', 'transfer', 'test')`, [bankRow.id]);

  // The bank statement goes: its row verified the card payment and had a finding.
  const res = await fetch(`${base}/imports/${bankBatch.id}`, { method: 'DELETE' });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).transactions_removed, 1);
  assert.equal((await one('SELECT COUNT(*)::int AS n FROM transaction WHERE id = $1', [bankRow.id])).n, 0);
  assert.equal((await one('SELECT COUNT(*)::int AS n FROM transaction_review WHERE transaction_id = $1', [bankRow.id])).n, 0);
  // The card payment is checked again and no longer claims a bank row that's gone.
  const after = await one('SELECT status, bank_transaction_id FROM payment_match WHERE card_transaction_id = $1', [cardRow.id]);
  assert.deepEqual([after.status, after.bank_transaction_id], ['unverified', null]);
  const log = await one(`SELECT detail FROM audit_log WHERE action = 'import.deleted' AND entity_id = $1`, [bankBatch.id]);
  assert.equal(log.detail.derived_removed.review_findings, 1);

  // And the card statement itself can go too, match and all.
  assert.equal((await fetch(`${base}/imports/${cardBatch.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await one('SELECT COUNT(*)::int AS n FROM payment_match WHERE card_transaction_id = $1', [cardRow.id])).n, 0);
});

// D249: a row's type and category fixed together, all or nothing, and undone.
async function missingBoth(account, hash) {
  const t = await one(`INSERT INTO transaction (account_id, posted_date, description, amount_cents, dedupe_hash)
                       VALUES ($1, '2026-09-12', 'ROSS STORES RIVERTON NC', -3751, $2) RETURNING id`, [account.id, hash]);
  const type = await one(`INSERT INTO transaction_review (transaction_id, check_kind, field, current_value, suggested_value, reason)
                          VALUES ($1, 'type_missing', 'txn_type', NULL, NULL, 'No type was set') RETURNING id`, [t.id]);
  const cat = await one(`INSERT INTO transaction_review (transaction_id, check_kind, field, current_value, suggested_value, reason)
                         VALUES ($1, 'category_missing', 'category', NULL, NULL, 'No category was set') RETURNING id`, [t.id]);
  return { t, type, cat };
}
const row = (id) => one(`SELECT t.txn_type, c.name AS category FROM transaction t LEFT JOIN category c ON c.id = t.category_id WHERE t.id = $1`, [id]);
const status = async (id) => (await one('SELECT status FROM transaction_review WHERE id = $1', [id])).status;

test('Review batch: type and category land together, and one bad value rolls the whole batch back', { skip }, async () => {
  const { card } = await fixtures();
  await query(`INSERT INTO category (name) VALUES ('Shopping') ON CONFLICT DO NOTHING`);
  const { t, type, cat } = await missingBoth(card, 'h-batch-1');

  const bad = await post('/transaction-review/batch', { approve: [{ id: type.id, value: 'purchase' }, { id: cat.id, value: 'No Such Category' }] });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).id, cat.id);
  assert.deepEqual(await row(t.id), { txn_type: null, category: null });
  assert.equal(await status(type.id), 'pending');

  const ok = await post('/transaction-review/batch', { approve: [{ id: type.id, value: 'purchase' }, { id: cat.id, value: 'Shopping' }] });
  assert.equal(ok.status, 200);
  assert.deepEqual(await row(t.id), { txn_type: 'purchase', category: 'Shopping' });
  assert.equal(await status(cat.id), 'approved');
  assert.equal((await one(`SELECT COUNT(*)::int AS n FROM audit_log WHERE action = 'transaction_review.approved' AND entity_id = $1`, [t.id])).n, 2);
});

test('Review undo: puts the old value back, refuses after a later edit, and re-opens a dismissal', { skip }, async () => {
  const { card } = await fixtures();
  await query(`INSERT INTO category (name) VALUES ('Shopping'), ('Dining') ON CONFLICT DO NOTHING`);
  const { t, type, cat } = await missingBoth(card, 'h-undo-1');
  await post('/transaction-review/batch', { approve: [{ id: type.id, value: 'purchase' }, { id: cat.id, value: 'Shopping' }] });

  assert.equal((await post('/transaction-review/undo', { items: [{ id: type.id, value: 'purchase' }, { id: cat.id, value: 'Shopping' }] })).status, 200);
  assert.deepEqual(await row(t.id), { txn_type: null, category: null });
  assert.equal(await status(type.id), 'pending');
  assert.ok(await one(`SELECT 1 FROM audit_log WHERE action = 'transaction_review.undone' AND entity_id = $1`, [t.id]));

  // Approved again, then changed elsewhere: undo must not overwrite that edit.
  await post('/transaction-review/batch', { approve: [{ id: cat.id, value: 'Shopping' }] });
  await query(`UPDATE transaction SET category_id = (SELECT id FROM category WHERE name = 'Dining') WHERE id = $1`, [t.id]);
  assert.equal((await post('/transaction-review/undo', { items: [{ id: cat.id, value: 'Shopping' }] })).status, 409);
  assert.equal((await row(t.id)).category, 'Dining');

  await post('/transaction-review/batch', { dismiss: [type.id] });
  assert.equal(await status(type.id), 'dismissed');
  assert.equal((await post('/transaction-review/undo', { items: [{ id: type.id }] })).status, 200);
  assert.equal(await status(type.id), 'pending');
});

test('Review list: each finding carries ranked options with a reason', { skip }, async () => {
  const { card } = await fixtures();
  await missingBoth(card, 'h-opts-1');
  const body = await (await fetch(base + '/transaction-review')).json();
  const item = body.items.find((i) => i.check_kind === 'type_missing');
  assert.equal(item.options[0].value, 'purchase');
  assert.ok(item.options.every((o) => typeof o.why === 'string' && o.why.length > 0));
});

test('transactions list: out and in totals, and per month, over every matching row (D251)', { skip }, async () => {
  const { card } = await fixtures();
  await query(
    `INSERT INTO transaction (account_id, posted_date, description, amount_cents, txn_type, dedupe_hash) VALUES
       ($1, '2026-08-03', 'TOTALS A', -1000, 'purchase', 'h-tot-1'),
       ($1, '2026-08-20', 'TOTALS B', -2500, 'purchase', 'h-tot-2'),
       ($1, '2026-09-02', 'TOTALS C', 700, 'refund', 'h-tot-3')`, [card.id]);
  const body = await (await fetch(`${base}/transactions?q=TOTALS&limit=1`)).json();
  assert.equal(body.rows.length, 1);
  assert.equal(body.total, 3);
  assert.equal(body.out_cents, -3500);
  assert.equal(body.in_cents, 700);
  assert.deepEqual(body.months['2026-08'], { count: 2, out_cents: -3500, in_cents: 0 });
  assert.deepEqual(body.months['2026-09'], { count: 1, out_cents: 0, in_cents: 700 });
});
