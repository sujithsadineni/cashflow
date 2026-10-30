/**
 * Route tests for possible duplicates (D328): the list, "both are real" and
 * "remove this copy", against a throwaway database built from the real
 * migrations (testing/db.js).
 */
import { dbAvailable, migrate, teardown } from '../testing/db.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

let base, server, query;

before(async () => {
  if (!dbAvailable) return;
  await migrate();
  ({ query } = await import('../core/db.js'));
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
let n = 0;

/** A card with a January and a March statement; March reprints a January row. */
async function fixtures() {
  n++;
  const person = await one(`INSERT INTO person (name) VALUES ('Alex ${n}') RETURNING id`);
  const card = await one(`INSERT INTO account (person_id, name, account_type, issuer, mask) VALUES ($1, 'Test Card ${n}', 'CREDIT_CARD', 'American Express', '1111') RETURNING id`, [person.id]);
  const statement = async (start, end) => {
    const b = await one(
      `INSERT INTO import_batch (original_filename, stored_path, file_type, file_hash, status, account_id, parse_method, period_start, period_end)
       VALUES ('s.pdf', 'data/s.pdf', 'PDF', $1, 'APPROVED', $2, 'local', $3, $4) RETURNING id`, [`d328-${n}-${start}`, card.id, start, end]);
    await query(`INSERT INTO statement (import_batch_id, account_id, period_start, period_end) VALUES ($1, $2, $3, $4)`, [b.id, card.id, start, end]);
    return b;
  };
  const jan = await statement('2025-12-27', '2026-01-24');
  const mar = await statement('2026-02-25', '2026-03-25');
  const row = async (batch, date, cents, description, i) => {
    const t = await one(
      `INSERT INTO transaction (account_id, import_batch_id, posted_date, description, amount_cents, txn_type, dedupe_hash)
       VALUES ($1, $2, $3, $4, $5, 'purchase', $6) RETURNING id`, [card.id, batch.id, date, description, cents, `h-${n}-${batch.id}-${i}`]);
    await query(
      `INSERT INTO staged_transaction (import_batch_id, posted_date, description, amount_cents, txn_type, review_status, transaction_id)
       VALUES ($1, $2, $3, $4, 'purchase', 'APPROVED', $5)`, [batch.id, date, description, cents, t.id]);
    return t;
  };
  const real = await row(jan, '2026-01-06', -31500, 'DISPUTE CR REVERSAL - SHOP.COM', 1);
  const reprint = await row(mar, '2026-01-06', -31500, 'DISPUTE CR REVERSAL - SHOP.COM', 2);
  // The same $100 twice on one statement, on purpose for a 5%-back offer: never a pair.
  const twinA = await row(jan, '2026-01-10', -10000, 'AplPay CORNER GROCER #1234', 3);
  const twinB = await row(jan, '2026-01-10', -10000, 'AplPay CORNER GROCER #1234', 4);
  return { card, real, reprint, twinA, twinB, mar };
}
const pairsFor = async (cardId) => (await (await fetch(`${base}/duplicates`)).json()).filter((p) => p.a.account_id === cardId);

test('with no PDF to re-read and no balances, the reprint is only a capped guess; the same-statement twins never show', { skip }, async () => {
  const { card, real, reprint } = await fixtures();
  const pairs = await pairsFor(card.id);
  assert.deepEqual(pairs.map((p) => [p.keep_id, p.remove_id, p.verdict, p.score]), [[real.id, reprint.id, 'unsure', 75]]);
  assert.equal(pairs[0].b.period_start, '2026-02-25', 'each side carries its own statement');
  assert.ok(pairs[0].checks[reprint.id].some((c) => /couldn't be re-read/.test(c.text)));
});

test('when both statements only add up with their copy, the pair is real and neither copy can be removed', { skip }, async () => {
  const { card, real, reprint } = await fixtures();
  // A card's balance is owed: opening − closing = its rows (January: the copy and the two twins).
  await query(`UPDATE statement SET opening_balance_cents = 0, closing_balance_cents = 51500 WHERE import_batch_id = (SELECT import_batch_id FROM transaction WHERE id = $1)`, [real.id]);
  await query(`UPDATE statement SET opening_balance_cents = 0, closing_balance_cents = 31500 WHERE import_batch_id = (SELECT import_batch_id FROM transaction WHERE id = $1)`, [reprint.id]);
  const [pair] = await pairsFor(card.id);
  assert.deepEqual([pair.verdict, pair.score, pair.remove_id], ['real', 2, null]);
  const res = await post('/duplicates/remove', { keep_id: real.id, remove_id: reprint.id });
  assert.equal(res.status, 409);
  assert.equal((await one('SELECT COUNT(*)::int AS n FROM transaction WHERE id = ANY($1)', [[real.id, reprint.id]])).n, 2, 'nothing deleted');
});

test('a copy its statement only adds up without is a duplicate; only that copy can be removed', { skip }, async () => {
  const { card, real, reprint } = await fixtures();
  await query(`UPDATE statement SET opening_balance_cents = 0, closing_balance_cents = 51500 WHERE import_batch_id = (SELECT import_batch_id FROM transaction WHERE id = $1)`, [real.id]);
  await query(`UPDATE statement SET opening_balance_cents = 0, closing_balance_cents = 0 WHERE import_batch_id = (SELECT import_batch_id FROM transaction WHERE id = $1)`, [reprint.id]);
  const [pair] = await pairsFor(card.id);
  assert.deepEqual([pair.verdict, pair.score, pair.remove_id], ['duplicate', 97, reprint.id]);
  assert.equal((await post('/duplicates/remove', { keep_id: reprint.id, remove_id: real.id })).status, 409, 'not the copy January needs');
  assert.equal((await post('/duplicates/remove', { keep_id: real.id, remove_id: reprint.id })).status, 200);
});

test('"both are real" is remembered and the pair is not asked again', { skip }, async () => {
  const { card, real, reprint } = await fixtures();
  const res = await post('/duplicates/both-real', { keep_id: real.id, remove_id: reprint.id });
  assert.equal(res.status, 200);
  assert.deepEqual(await pairsFor(card.id), []);
  assert.ok(await one(`SELECT 1 FROM audit_log WHERE action = 'duplicate.both_real' AND entity_id = $1`, [real.id]));
  // Both rows are still there.
  assert.equal((await one('SELECT COUNT(*)::int AS n FROM transaction WHERE id = ANY($1)', [[real.id, reprint.id]])).n, 2);
});

test('"remove this copy" deletes it, rejects its staged row, audits the whole row, keeps the other', { skip }, async () => {
  const { card, real, reprint, mar } = await fixtures();
  const res = await post('/duplicates/remove', { keep_id: real.id, remove_id: reprint.id });
  assert.equal(res.status, 200);
  assert.equal(await one('SELECT 1 FROM transaction WHERE id = $1', [reprint.id]), undefined);
  assert.ok(await one('SELECT 1 FROM transaction WHERE id = $1', [real.id]), 'the kept copy stays');
  const staged = await one('SELECT review_status, transaction_id FROM staged_transaction WHERE import_batch_id = $1', [mar.id]);
  assert.deepEqual(staged, { review_status: 'REJECTED', transaction_id: null });
  const log = await one(`SELECT detail FROM audit_log WHERE action = 'transaction.duplicate_removed' AND entity_id = $1`, [reprint.id]);
  assert.equal(log.detail.kept_transaction_id, real.id);
  assert.equal(log.detail.removed.amount_cents, -31500);
  assert.equal((await one('SELECT rows_approved FROM import_batch WHERE id = $1', [mar.id])).rows_approved, 0);
  assert.deepEqual(await pairsFor(card.id), []);
});

test('only a listed pair can be answered: the same-statement twins are refused, nothing deleted', { skip }, async () => {
  const { twinA, twinB } = await fixtures();
  const res = await post('/duplicates/remove', { keep_id: twinA.id, remove_id: twinB.id });
  assert.equal(res.status, 404);
  assert.equal((await one('SELECT COUNT(*)::int AS n FROM transaction WHERE id = ANY($1)', [[twinA.id, twinB.id]])).n, 2);
});

test('approving a statement with two identical rows saves both; the same statement again is still refused', { skip }, async () => {
  const { card } = await fixtures();
  const upload = async (hash) => {
    const b = await one(
      `INSERT INTO import_batch (original_filename, stored_path, file_type, file_hash, status, account_id, parse_method)
       VALUES ('t.pdf', 'data/t.pdf', 'PDF', $1, 'REVIEW', $2, 'local') RETURNING id`, [hash, card.id]);
    await query(
      `INSERT INTO staged_transaction (import_batch_id, posted_date, description, amount_cents, txn_type)
       VALUES ($1, '2026-04-29', 'AplPay CORNER GROCER #1234', -10000, 'purchase'), ($1, '2026-04-29', 'AplPay CORNER GROCER #1234', -10000, 'purchase')`, [b.id]);
    return b;
  };
  const first = await upload(`d328-twins-${n}`);
  const staged = await (await fetch(`${base}/imports/${first.id}/staged`)).json();
  assert.deepEqual((staged.rows ?? staged.staged).map((r) => r.duplicate_of_id), [null, null], 'twins on one statement are not flagged');
  assert.equal((await post(`/imports/${first.id}/approve`, { all: true })).status, 200);
  assert.equal((await one(`SELECT COUNT(*)::int AS n FROM transaction WHERE import_batch_id = $1`, [first.id])).n, 2);

  const again = await upload(`d328-twins-again-${n}`);
  assert.equal((await post(`/imports/${again.id}/approve`, { all: true })).status, 409, 'a second upload of the same rows is still blocked');
  assert.equal((await one(`SELECT COUNT(*)::int AS n FROM transaction WHERE import_batch_id = $1`, [again.id])).n, 0);
});
