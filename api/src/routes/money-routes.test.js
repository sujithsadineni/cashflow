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

async function fixtures() {
  const person = await one(`INSERT INTO person (name) VALUES ('Alex') RETURNING id`);
  const card = await one(`INSERT INTO account (person_id, name, account_type, issuer, mask) VALUES ($1, 'Test Card', 'CREDIT_CARD', 'Barclays', '1111') RETURNING id`, [person.id]);
  const bank = await one(`INSERT INTO account (person_id, name, account_type, issuer, mask) VALUES ($1, 'Test Checking', 'CHECKING', 'SoFi', '2222') RETURNING id`, [person.id]);
  return { person, card, bank };
}

test('an upload of a statement already saved says so for the whole file (D307)', { skip }, async () => {
  const { card } = await fixtures();
  const batch = (hash, status, end) => one(
    `INSERT INTO import_batch (original_filename, stored_path, file_type, file_hash, status, account_id, parse_method, period_start, period_end)
     VALUES ('s.pdf', 'data/s.pdf', 'PDF', $1, $2, $3, 'local', $4::date - 30, $4) RETURNING id`, [hash, status, card.id, end]);
  const saved = await batch('d307-a', 'APPROVED', '2025-01-05');
  await query(`INSERT INTO statement (import_batch_id, account_id, period_start, period_end) VALUES ($1, $2, '2024-12-06', '2025-01-05')`, [saved.id, card.id]);
  const again = await batch('d307-b', 'REVIEW', '2025-01-05');
  const next = await batch('d307-c', 'REVIEW', '2025-02-05');
  const same = (await (await fetch(`${base}/imports/${again.id}/staged`)).json()).same_statement;
  assert.deepEqual(same, { import_batch_id: saved.id, period_start: '2024-12-06', period_end: '2025-01-05' });
  assert.equal((await (await fetch(`${base}/imports/${next.id}/staged`)).json()).same_statement, null, 'the next statement is new');
});

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

  const { runPaymentMatch } = await import('../matching/payment-match-run.js');
  await runPaymentMatch({ accountIds: [card.id] });
  assert.equal((await one('SELECT source FROM payment_match WHERE card_transaction_id = $1', [pay.id])).source, 'manual');

  const undo = await fetch(`${base}/payment-matches/${pay.id}/manual`, { method: 'DELETE' });
  assert.equal(undo.status, 200);
  const back = await one('SELECT source, status FROM payment_match WHERE card_transaction_id = $1', [pay.id]);
  assert.deepEqual([back.source, back.status], ['auto', 'unverified']);
  // Not a card payment at all: refused.
  assert.equal((await post('/payment-matches/999999', { via: 'cash' })).status, 404);
});

test('savings breakdown lists current savings and investment balances, including missing ones', { skip }, async () => {
  const { person } = await fixtures();
  const saved = await one(
    `INSERT INTO account (person_id, name, account_type, issuer, mask)
     VALUES ($1, 'Test Savings Snapshot', 'SAVINGS', 'Test Bank', '3333') RETURNING id`,
    [person.id]
  );
  const invested = await one(
    `INSERT INTO account (person_id, name, account_type, issuer, mask)
     VALUES ($1, 'Test Investment Snapshot', 'INVESTMENT', 'Test Broker', '4444') RETURNING id`,
    [person.id]
  );
  const statementAccount = await one(
    `INSERT INTO account (person_id, name, account_type, issuer, mask)
     VALUES ($1, 'Test Statement Snapshot', 'SAVINGS', 'Other Bank', '5555') RETURNING id`,
    [person.id]
  );
  await query(
    `INSERT INTO account_balance (account_id, as_of, balance_cents)
     VALUES ($1, '2026-09-30', 123456)`,
    [saved.id]
  );
  const batch = await one(
    `INSERT INTO import_batch (original_filename, stored_path, file_type, file_hash, status, account_id, parse_method)
     VALUES ('snapshot.pdf', 'data/snapshot.pdf', 'PDF', 'snapshot-hash', 'APPROVED', $1, 'local') RETURNING id`,
    [statementAccount.id]
  );
  await query(
    `INSERT INTO statement (import_batch_id, account_id, period_start, period_end, opening_balance_cents, closing_balance_cents)
     VALUES ($1, $2, '2026-09-01', '2026-10-01', 1000, 234567)`,
    [batch.id, statementAccount.id]
  );

  const res = await fetch(`${base}/summary/savings-breakdown?month=2026-10`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(
    body.accounts.map(({ name, account_type, balance_cents, as_of }) => ({ name, account_type, balance_cents, as_of })),
    [
      { name: 'Test Investment Snapshot', account_type: 'INVESTMENT', balance_cents: null, as_of: null },
      { name: 'Test Savings Snapshot', account_type: 'SAVINGS', balance_cents: 123456, as_of: '2026-09-30' },
      { name: 'Test Statement Snapshot', account_type: 'SAVINGS', balance_cents: 234567, as_of: '2026-10-01' },
    ]
  );
  assert.equal(body.accounts.find((a) => a.id === invested.id).balance_cents, null);
});

test('savings explorer total includes income, spend and loan payments while reversing excluded flows', { skip }, async () => {
  const { bank } = await fixtures();
  const beforeRes = await fetch(`${base}/summary/savings?year=2026`);
  assert.equal(beforeRes.status, 200);
  const before = await beforeRes.json();
  const loan = await one(`INSERT INTO category (name) VALUES ('Loan') ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`);
  const balanceTransfer = await one(`INSERT INTO category (name) VALUES ('Balance Transfer') ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`);
  await query(
    `INSERT INTO transaction (account_id, posted_date, description, amount_cents, txn_type, category_id, dedupe_hash)
     VALUES ($1, '2026-01-02', 'Sample Payroll', 50000, 'deposit', NULL, 'savings-explorer-income'),
            ($1, '2026-01-03', 'Sample Market', -12000, 'purchase', NULL, 'savings-explorer-spend'),
            ($1, '2026-01-04', 'Sample Loan', -5000, 'payment', $2, 'savings-explorer-loan'),
            ($1, '2026-01-05', 'Sample Reserve Transfer 1234', -20000, 'savings', NULL, 'savings-explorer-move'),
            ($1, '2026-01-06', 'Sample Transfer', 30000, 'transfer', $3, 'savings-explorer-borrowed'),
            ($1, '2026-01-07', 'Sample Interest', 1000, 'interest', NULL, 'savings-explorer-interest')`,
    [bank.id, loan.id, balanceTransfer.id]
  );

  const res = await fetch(`${base}/summary/savings?year=2026`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.total_cents - before.total_cents, 33000);
  assert.equal(body.months[0].total - before.months[0].total, 33000);
  assert.equal(body.by_kind['moved:Sample Reserve'] - (before.by_kind['moved:Sample Reserve'] ?? 0), 20000);
  assert.equal(body.items.find((item) => item.description === 'Sample Reserve Transfer 1234').amount_cents, -20000);
  assert.equal(body.items.find((item) => item.description === 'Sample Reserve Transfer 1234').measure_cents, 20000);
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

  const { runPaymentMatch } = await import('../matching/payment-match-run.js');
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

test("a re-check leaves an audit finding pending, but retires a rule's finding it no longer makes", { skip }, async () => {
  const { bank } = await fixtures();
  const t = await one(`INSERT INTO transaction (account_id, posted_date, description, amount_cents, txn_type, dedupe_hash)
                       VALUES ($1, '2026-09-03', 'Zelle payment from SAM for "rent"', 80000, 'deposit', 'h-audit') RETURNING id`, [bank.id]);
  const audited = await one(`INSERT INTO transaction_review (transaction_id, check_kind, field, current_value, suggested_value, reason)
                             VALUES ($1, 'audit_roommate_rent', 'txn_type', 'deposit', 'refund', 'test') RETURNING id`, [t.id]);
  const rule = await one(`INSERT INTO transaction_review (transaction_id, check_kind, field, current_value, suggested_value, reason)
                          VALUES ($1, 'type_history', 'txn_type', 'deposit', 'transfer', 'test') RETURNING id`, [t.id]);

  assert.equal((await post('/transaction-review/run')).status, 200);
  assert.equal(await status(audited.id), 'pending');
  assert.equal(await status(rule.id), 'obsolete');
});

test("a transfer's two halves are linked by the re-check and each names the other (D265)", { skip }, async () => {
  const { bank } = await fixtures();
  const person = await one(`SELECT person_id FROM account WHERE id = $1`, [bank.id]);
  const savings = await one(`INSERT INTO account (person_id, name, account_type, issuer, mask) VALUES ($1, 'Test Savings', 'SAVINGS', 'Robinhood', '3333') RETURNING id`, [person.person_id]);
  const out = await one(`INSERT INTO transaction (account_id, posted_date, description, amount_cents, txn_type, dedupe_hash)
                         VALUES ($1, '2026-07-01', 'ROBINHOOD MONEY PAYMENT', -600000, 'savings', 'h-tm-out') RETURNING id`, [bank.id]);
  const into = await one(`INSERT INTO transaction (account_id, posted_date, description, amount_cents, txn_type, dedupe_hash)
                          VALUES ($1, '2026-07-02', 'ACH Deposit from Bank', 600000, 'transfer', 'h-tm-in') RETURNING id`, [savings.id]);

  const run = await (await post('/transaction-review/run')).json();
  assert.ok(run.transfers.pairs >= 1);

  const rows = (await (await fetch(`${base}/transactions?limit=200`)).json());
  const list = rows.rows;
  const byId = new Map(list.map((t) => [t.id, t]));
  assert.deepEqual([byId.get(into.id).transfer_link.direction, byId.get(into.id).transfer_link.account_name], ['from', 'Test Checking']);
  assert.deepEqual([byId.get(out.id).transfer_link.direction, byId.get(out.id).transfer_link.account_name], ['to', 'Test Savings']);

  // Deleting a half (as an import delete does: its findings first) takes its link with it rather than blocking the delete.
  await query('DELETE FROM transaction_review WHERE transaction_id = $1', [into.id]);
  await query('DELETE FROM transaction WHERE id = $1', [into.id]);
  assert.equal((await one('SELECT COUNT(*)::int AS n FROM transfer_match WHERE out_transaction_id = $1', [out.id])).n, 0);
});

test('an account can be edited in full: type, owner, name on the card; an unknown owner is refused (D267)', { skip }, async () => {
  const { card, person } = await fixtures();
  const other = await one(`INSERT INTO person (name) VALUES ('Jordan') RETURNING id`);
  const patch = (body) => fetch(`${base}/accounts/${card.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  const res = await patch({ account_type: 'CHECKING', person_id: other.id, holder_name: 'JORDAN LEE', name: 'Renamed' });
  assert.equal(res.status, 200);
  const saved = await one('SELECT account_type, person_id, holder_name, name FROM account WHERE id = $1', [card.id]);
  assert.deepEqual(saved, { account_type: 'CHECKING', person_id: other.id, holder_name: 'JORDAN LEE', name: 'Renamed' });
  const log = await one(`SELECT detail FROM audit_log WHERE action = 'account.updated' AND entity_id = $1 ORDER BY id DESC LIMIT 1`, [card.id]);
  assert.deepEqual(log.detail.changes.person_id, { from: person.id, to: other.id });

  const bad = await patch({ person_id: 999999 });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).field, 'person_id');
  assert.equal((await patch({ account_type: 'LOAN' })).status, 400);
});

test('"No statement this month" turns a likely-quiet cycle quiet, and undoing it brings the question back (D268)', { skip }, async () => {
  const { card, bank } = await fixtures();
  const batch = await one(`INSERT INTO import_batch (original_filename, stored_path, file_type, file_hash, status, account_id, parse_method)
                           VALUES ('c.pdf', 'data/c.pdf', 'PDF', 'hash-gap', 'APPROVED', $1, 'local') RETURNING id`, [card.id]);
  // A statement that closed at $0 two months ago: the cycles since are only likely quiet.
  const end = new Date(Date.now() - 70 * 86_400_000).toISOString().slice(0, 10);
  const start = new Date(Date.now() - 100 * 86_400_000).toISOString().slice(0, 10);
  await query(`INSERT INTO statement (import_batch_id, account_id, period_start, period_end, opening_balance_cents, closing_balance_cents)
               VALUES ($1, $2, $3, $4, 0, 0)`, [batch.id, card.id, start, end]);
  const cycleOf = async () => (await (await fetch(`${base}/statement-gaps`)).json()).find((c) => c.account_id === card.id).gaps[0].cycles[0];

  const first = await cycleOf();
  assert.equal(first.verdict, 'likely_quiet');
  const send = (method) => fetch(`${base}/statement-gaps/answer`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account_id: card.id, cycle_end: first.end }) });
  assert.equal((await send('POST')).status, 200);
  assert.equal((await cycleOf()).verdict, 'quiet');
  assert.ok(await one(`SELECT 1 FROM audit_log WHERE action = 'statement_gap.answered' AND entity_id = $1`, [card.id]));
  assert.equal((await send('DELETE')).status, 200);
  assert.equal((await cycleOf()).verdict, 'likely_quiet');

  const notACard = await fetch(`${base}/statement-gaps/answer`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account_id: bank.id, cycle_end: first.end }) });
  assert.equal(notACard.status, 400);
});

test('a new card learns its closing and due day from its first statement; a day you set is kept (D270)', { skip }, async () => {
  const { card } = await fixtures();
  const batch = await one(`INSERT INTO import_batch (original_filename, stored_path, file_type, file_hash, status, account_id, parse_method)
                           VALUES ('d.pdf', 'data/d.pdf', 'PDF', 'hash-dates', 'REVIEW', $1, 'local') RETURNING id`, [card.id]);
  await query(`INSERT INTO statement (import_batch_id, account_id, period_start, period_end, opening_balance_cents, closing_balance_cents, payment_due_date, minimum_payment_cents)
               VALUES ($1, $2, '2026-08-06', '2026-09-05', 0, 5000, '2026-10-02', 2500)`, [batch.id, card.id]);
  await query(`INSERT INTO staged_transaction (import_batch_id, posted_date, description, amount_cents, txn_type, suggested_category)
               VALUES ($1, '2026-08-20', 'COFFEE 12', -5000, 'purchase', 'Dining')`, [batch.id]);
  assert.equal((await post(`/imports/${batch.id}/approve`, { all: true })).status, 200);
  assert.deepEqual(await one('SELECT closing_day, due_day FROM account WHERE id = $1', [card.id]), { closing_day: 5, due_day: 2 });
  assert.ok(await one(`SELECT 1 FROM audit_log WHERE action = 'account.dates_learned' AND entity_id = $1`, [card.id]));

  const patch = (body) => fetch(`${base}/accounts/${card.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await patch({ due_day: 3 })).status, 200);
  assert.equal((await patch({ closing_day: 32 })).status, 400);
  const { learnCardDays } = await import('../statements/card-dates-run.js');
  await learnCardDays(card.id);
  assert.equal((await one('SELECT due_day FROM account WHERE id = $1', [card.id])).due_day, 3, 'yours stays');

  const listed = (await (await fetch(`${base}/accounts`)).json()).find((a) => a.id === card.id);
  assert.deepEqual([listed.date_suggestion.due.day, listed.payment_due.due_date, listed.payment_due.owed_cents], [2, '2026-10-02', 5000]);
});

test('a statement read with no rows can be approved, once (D273)', { skip }, async () => {
  const { card } = await fixtures();
  const batch = await one(`INSERT INTO import_batch (original_filename, stored_path, file_type, file_hash, status, account_id, parse_method, rows_parsed)
                           VALUES ('z.pdf', 'data/z.pdf', 'PDF', 'hash-zero', 'REVIEW', $1, 'local', 0) RETURNING id`, [card.id]);
  const res = await post(`/imports/${batch.id}/approve`, { all: true });
  assert.equal(res.status, 200);
  assert.equal((await one('SELECT status FROM import_batch WHERE id = $1', [batch.id])).status, 'APPROVED');
  assert.equal((await post(`/imports/${batch.id}/approve`, { all: true })).status, 400, 'nothing left the second time');
});

test('deleting a re-upload of a statement already on file keeps the statement, handed back to the original import (D274)', { skip }, async () => {
  const { card } = await fixtures();
  const batch = (hash) => one(
    `INSERT INTO import_batch (original_filename, stored_path, file_type, file_hash, status, account_id, parse_method, period_start, period_end)
     VALUES ('s.pdf', 'data/statements/none.pdf', 'PDF', $2, 'APPROVED', $1, 'local', '2026-01-06', '2026-02-05') RETURNING id`, [card.id, hash]);
  const original = await batch('hash-original');
  const again = await batch('hash-again');
  // The re-upload took the statement over, as upsertStatement does on the same card and period.
  const st = await one(`INSERT INTO statement (import_batch_id, account_id, period_start, period_end, opening_balance_cents, closing_balance_cents)
                        VALUES ($1, $2, '2026-01-06', '2026-02-05', 6583, 6989) RETURNING id`, [again.id, card.id]);
  assert.equal((await fetch(`${base}/imports/${again.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await one('SELECT import_batch_id FROM statement WHERE id = $1', [st.id]))?.import_batch_id, original.id);
  // With no other import holding it, the statement goes with its import.
  assert.equal((await fetch(`${base}/imports/${original.id}`, { method: 'DELETE' })).status, 200);
  assert.equal(await one('SELECT 1 FROM statement WHERE id = $1', [st.id]), undefined);
});

test('a re-upload of a statement already on file leaves it with the approved import (D281)', { skip }, async () => {
  const { card } = await fixtures();
  const { upsertStatement } = await import('./imports/shared.js');
  const batch = (hash, status) => one(
    `INSERT INTO import_batch (original_filename, stored_path, file_type, file_hash, status, account_id, parse_method, period_start, period_end)
     VALUES ('s.pdf', 'data/statements/none.pdf', 'PDF', $2, $3, $1, 'local', '2026-03-06', '2026-04-05') RETURNING id`, [card.id, hash, status]);
  const summary = { period_start: '2026-03-06', period_end: '2026-04-05', opening_balance_cents: 6583, closing_balance_cents: 6989 };
  const client = { query };
  const original = await batch('d281-original', 'REVIEW');
  await upsertStatement(client, card.id, original.id, summary);
  const st = (await one(`SELECT id FROM statement WHERE account_id = $1 AND period_start = '2026-03-06'`, [card.id])).id;
  await query(`UPDATE import_batch SET status = 'APPROVED' WHERE id = $1`, [original.id]);
  const again = await batch('d281-again', 'REVIEW');
  await upsertStatement(client, card.id, again.id, { ...summary, closing_balance_cents: 7000 });
  const row = await one('SELECT import_batch_id, closing_balance_cents FROM statement WHERE id = $1', [st]);
  assert.equal(row.import_batch_id, original.id, 'still the approved import');
  assert.equal(row.closing_balance_cents, 7000, 'the newer read still refreshes the balances');
  // A statement whose import was never approved goes to the newer upload, as before.
  const third = await batch('d281-third', 'REVIEW');
  await query(`UPDATE import_batch SET status = 'FAILED' WHERE id = $1`, [original.id]);
  await upsertStatement(client, card.id, third.id, summary);
  assert.equal((await one('SELECT import_batch_id FROM statement WHERE id = $1', [st])).import_batch_id, third.id);
});

test('one transaction says where it lives, for a link that opens it (D284)', { skip }, async () => {
  const { card } = await fixtures();
  const t = await one(`INSERT INTO transaction (account_id, posted_date, description, amount_cents, txn_type, dedupe_hash)
                       VALUES ($1, '2026-08-26', 'DISNEYPLUS - $120 Disney Streaming Credit', 539, 'cashback', 'd284-link') RETURNING id`, [card.id]);
  const res = await fetch(`${base}/transactions/${t.id}`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { id: t.id, account_id: card.id, posted_date: '2026-08-26' });
  assert.equal((await fetch(`${base}/transactions/999999999`)).status, 404);
  // The named routes registered before it still answer.
  assert.equal((await fetch(`${base}/transactions/category-summary?account_id=${card.id}`)).status, 200);
});

test('transactions filter by several categories at once, uncategorised included (D287)', { skip }, async () => {
  const { card } = await fixtures();
  const cat = (name) => one(`INSERT INTO category (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [name]);
  const [a, b, c] = [await cat('D287 A'), await cat('D287 B'), await cat('D287 C')];
  const row = (n, categoryId) => one(`INSERT INTO transaction (account_id, posted_date, description, amount_cents, txn_type, category_id, dedupe_hash)
                                      VALUES ($1, '2026-03-0${n}', 'ROW ${n}', -100, 'purchase', $2, 'd287-${n}') RETURNING id`, [card.id, categoryId]);
  await row(1, a.id); await row(2, b.id); await row(3, c.id); await row(4, null);
  const ids = async (q) => (await (await fetch(`${base}/transactions?account_id=${card.id}&from=2026-03-01&to=2026-03-09&${q}`)).json()).rows.map((r) => r.description).sort();
  assert.deepEqual(await ids(`category_id=${a.id},${b.id}`), ['ROW 1', 'ROW 2']);
  assert.deepEqual(await ids(`category_id=${c.id},none`), ['ROW 3', 'ROW 4']);
  assert.deepEqual(await ids(`category_id=${a.id}`), ['ROW 1'], 'one still works (Cards page)');
  assert.deepEqual(await ids('category_id=none'), ['ROW 4']);
  assert.equal((await fetch(`${base}/transactions?category_id=1,drop`)).status, 400);
});

test('transactions filter by several accounts, people and types at once (D304)', { skip }, async () => {
  const { card, bank } = await fixtures();
  const row = (n, accountId, type, cents) => one(`INSERT INTO transaction (account_id, posted_date, description, amount_cents, txn_type, dedupe_hash)
                                      VALUES ($1, '2026-04-0${n}', 'D304 ${n}', $3, $2, 'd304-${n}') RETURNING id`, [accountId, type, cents]);
  await row(1, card.id, 'purchase', -100); await row(2, card.id, 'cashback', 100); await row(3, bank.id, 'deposit', 500); await row(4, bank.id, 'fee', -5);
  const ids = async (q) => (await (await fetch(`${base}/transactions?from=2026-04-01&to=2026-04-09&q=D304&${q}`)).json()).rows.map((r) => r.description).sort();
  assert.deepEqual(await ids(`account_id=${card.id},${bank.id}`), ['D304 1', 'D304 2', 'D304 3', 'D304 4']);
  assert.deepEqual(await ids(`account_id=${bank.id}`), ['D304 3', 'D304 4'], 'one still works (links from Accounts)');
  assert.deepEqual(await ids('txn_type=purchase,cashback'), ['D304 1', 'D304 2']);
  assert.deepEqual(await ids(`txn_type=fee&account_id=${card.id},${bank.id}`), ['D304 4']);
  assert.equal((await fetch(`${base}/transactions?txn_type=purchase,nonsense`)).status, 400);
  assert.equal((await fetch(`${base}/transactions?account_id=1,x`)).status, 400);
});

test('$0.00 rows stay out of the list unless a search asks for them (D313)', { skip }, async () => {
  const { card } = await fixtures();
  await query(`INSERT INTO transaction (account_id, posted_date, description, amount_cents, txn_type, dedupe_hash)
               VALUES ($1, '2026-05-13', 'INTEREST CHARGED ON PURCHASES', 0, 'interest', 'd313-0'),
                      ($1, '2026-05-14', 'D313 COFFEE', -450, 'purchase', 'd313-1')`, [card.id]);
  const list = async (q) => (await (await fetch(`${base}/transactions?account_id=${card.id}&from=2026-05-01&to=2026-05-31${q}`)).json()).rows.map((r) => r.description);
  assert.deepEqual(await list(''), ['D313 COFFEE']);
  assert.deepEqual(await list('&q=INTEREST'), ['INTEREST CHARGED ON PURCHASES']);
});

test('a Zelle between your own accounts is filed under the household member, however spelled (D289)', { skip }, async () => {
  const { bank } = await fixtures(); // the household has a person named Alex
  const t = await one(`INSERT INTO transaction (account_id, posted_date, description, amount_cents, txn_type, dedupe_hash)
                       VALUES ($1, '2026-05-02', 'Zelle payment to ALEX CHASE Conf# x1y2z3', -5000, 'purchase', 'd289-internal') RETURNING id`, [bank.id]);
  const res = await fetch(`${base}/zelle/${t.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ zelle_type: 'INTERNAL', zelle_person: 'Alex Chase' }) });
  assert.equal(res.status, 200);
  const saved = await one(`SELECT t.zelle_person, c.name AS contact FROM transaction t JOIN contact c ON c.id = t.contact_id WHERE t.id = $1`, [t.id]);
  assert.deepEqual(saved, { zelle_person: 'Alex', contact: 'Alex' });
  // Someone else keeps the name typed.
  await fetch(`${base}/zelle/${t.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ zelle_type: 'SENT', zelle_person: 'Alex Chase' }) });
  assert.equal((await one('SELECT zelle_person FROM transaction WHERE id = $1', [t.id])).zelle_person, 'Alex Chase');
});

test('contacts: suggested pairs, merge keeps the spelling as an alias, different people stop being suggested (D290)', { skip }, async () => {
  const { bank } = await fixtures();
  const json = (method, path, body) => fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  const zelle = async (hash, person, type = 'RECEIVED') => {
    const t = await one(`INSERT INTO transaction (account_id, posted_date, description, amount_cents, txn_type, dedupe_hash)
                         VALUES ($1, '2026-06-01', 'Zelle payment from someone', 1000, 'deposit', $2) RETURNING id`, [bank.id, hash]);
    await json('PATCH', `/zelle/${t.id}`, { zelle_type: type, zelle_person: person });
    return one('SELECT t.zelle_person, t.contact_id FROM transaction t WHERE t.id = $1', [t.id]);
  };
  const short = await zelle('d290-a', 'Quinlan');
  const full = await zelle('d290-b', 'Quinlan Parkes');
  const other = await zelle('d290-c', 'Quinlan Hayes');
  const pairs = await (await fetch(`${base}/contacts/similar`)).json();
  const has = (x, y) => pairs.some((p) => [p.a.id, p.b.id].sort().join() === [x, y].sort().join());
  assert.ok(has(short.contact_id, full.contact_id), 'Quinlan / Quinlan Parkes suggested');

  const merged = await json('POST', `/contacts/${short.contact_id}/merge`, { into: full.contact_id });
  assert.equal(merged.status, 200);
  assert.equal((await merged.json()).transactions_moved, 1);
  assert.equal(await one('SELECT 1 FROM contact WHERE id = $1', [short.contact_id]), undefined);
  // A later Zelle spelled the merged-away way lands on the kept contact, under its name.
  const later = await zelle('d290-d', 'QUINLAN');
  assert.deepEqual([later.contact_id, later.zelle_person], [full.contact_id, 'Quinlan Parkes']);

  // "Different people" takes the pair off the list.
  assert.equal((await json('POST', '/contacts/distinct', { a: other.contact_id, b: full.contact_id })).status, 200);
  const after = await (await fetch(`${base}/contacts/similar`)).json();
  assert.ok(!after.some((p) => [p.a.id, p.b.id].sort().join() === [full.contact_id, other.contact_id].sort().join()));
  assert.equal((await json('POST', `/contacts/${full.contact_id}/merge`, { into: full.contact_id })).status, 400);
});

test('the accounts list gives each account its newest transaction date and its balance to show (D297)', { skip }, async () => {
  const { card, bank } = await fixtures();
  for (const [date, hash] of [['2026-03-01', 'lp-a'], ['2026-04-15', 'lp-b']]) {
    await query(`INSERT INTO transaction (account_id, posted_date, description, amount_cents, txn_type, dedupe_hash)
                 VALUES ($1, $2, 'Test purchase', -1000, 'purchase', $3)`, [card.id, date, hash]);
  }
  const batch = await one(`INSERT INTO import_batch (original_filename, stored_path, file_type, file_hash, status, account_id, parse_method)
                           VALUES ('b.pdf', 'data/b.pdf', 'PDF', 'hash-lp', 'APPROVED', $1, 'local') RETURNING id`, [bank.id]);
  await query(`INSERT INTO statement (import_batch_id, account_id, period_start, period_end, opening_balance_cents, closing_balance_cents)
               VALUES ($1, $2, '2026-03-01', '2026-03-31', 0, 50000)`, [batch.id, bank.id]);
  await query(`INSERT INTO account_balance (account_id, as_of, balance_cents) VALUES ($1, '2026-02-01', 1000)`, [bank.id]);
  const list = await (await fetch(`${base}/accounts`)).json();
  const listedCard = list.find((a) => a.id === card.id);
  const listedBank = list.find((a) => a.id === bank.id);
  assert.equal(listedCard.last_posted, '2026-04-15');
  assert.equal(listedBank.last_posted, null);
  // The newer of a typed balance and the latest statement's: here the statement.
  assert.equal(Number(listedBank.balance_cents), 50000);
  assert.equal(listedBank.balance_as_of, '2026-03-31');
  assert.equal(listedCard.balance_cents, null);
});

test('the loans list says when each loan was last changed, closed ones on request (D298)', { skip }, async () => {
  const loan = await one(`INSERT INTO loan (name, current_balance_cents, is_active) VALUES ('Audit Family Loan', 250000, false) RETURNING id`);
  const open = await (await fetch(`${base}/loans`)).json();
  assert.equal(open.some((l) => l.id === loan.id), false);
  const all = await (await fetch(`${base}/loans?include_closed=true`)).json();
  const found = all.find((l) => l.id === loan.id);
  assert.ok(found.updated_at, 'updated_at is returned');
  assert.equal(found.balance_source, 'manual');
  assert.equal(found.is_active, false);
});

test('a scheduled loan counts the payments found, and a skipped one shows as missed (D299)', { skip }, async () => {
  const { bank } = await fixtures();
  const loan = await one(
    `INSERT INTO loan (name, lender, loan_type, monthly_payment_cents, term_months, start_date, current_balance_cents, payment_account_id)
     VALUES ('Audit Car', 'Audit Lender', 'car', 10000, 12, '2026-01-15', 120000, $1) RETURNING id`, [bank.id]);
  // Paid in January, February and April; March was skipped.
  for (const [date, hash] of [['2026-01-15', 'lp1'], ['2026-02-16', 'lp2'], ['2026-04-15', 'lp4']]) {
    await query(`INSERT INTO transaction (account_id, posted_date, description, amount_cents, txn_type, dedupe_hash)
                 VALUES ($1, $2, 'AUDIT LENDER AUTO PAY', -10000, 'payment', $3)`, [bank.id, date, hash]);
  }
  // The paying account's records reach the end of April.
  const batch = await one(`INSERT INTO import_batch (original_filename, stored_path, file_type, file_hash, status, account_id, parse_method)
                           VALUES ('p.pdf', 'data/p.pdf', 'PDF', 'hash-lp-pay', 'APPROVED', $1, 'local') RETURNING id`, [bank.id]);
  await query(`INSERT INTO statement (import_batch_id, account_id, period_start, period_end, opening_balance_cents, closing_balance_cents)
               VALUES ($1, $2, '2026-04-01', '2026-04-30', 0, 0)`, [batch.id, bank.id]);

  const found = (await (await fetch(`${base}/loans`)).json()).find((l) => l.id === loan.id);
  // Three payments made, so nine left: the balance didn't fall for the skipped month.
  assert.equal(found.months_remaining, 9);
  assert.equal(Number(found.effective_balance_cents), 90000);
  assert.equal(found.payment_account_id, bank.id);
  assert.equal(found.payments.made, 3);
  assert.equal(found.payments.missed, 1);
  assert.equal(found.payments.covered_through, '2026-04-30');
  assert.equal(found.payments.behind_since, '2026-03-15');
});

test('a merchant renames, merges into another, and undoes exactly what it changed (D300)', { skip }, async () => {
  const { card } = await fixtures();
  const tx = (merchant, hash) => one(`INSERT INTO transaction (account_id, posted_date, description, amount_cents, txn_type, dedupe_hash, merchant)
                                      VALUES ($1, '2026-03-01', 'LINE', -500, 'purchase', $2, $3) RETURNING id`, [card.id, hash, merchant]);
  await tx('Audit Gas', 'm1'); await tx('Audit Gas', 'm2'); await tx('Audit Market', 'm3');
  await query(`INSERT INTO merchant_icon (merchant, emoji) VALUES ('Audit Gas', '⛽'), ('Audit Market', '🛒')`);
  const post = (path, body) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const count = async (m) => Number((await one('SELECT count(*) AS n FROM transaction WHERE merchant = $1', [m])).n);

  // A plain rename carries the icon with it.
  const renamed = await (await post('/merchants/rename', { from: 'Audit Gas', to: '  Audit  Fuel ' })).json();
  assert.equal(renamed.merged, false);
  assert.equal(renamed.to, 'Audit Fuel');
  assert.equal(await count('Audit Fuel'), 2);
  assert.equal((await one(`SELECT emoji FROM merchant_icon WHERE merchant = 'Audit Fuel'`)).emoji, '⛽');

  // Typing an existing name (any case) merges into it; the target keeps its own icon.
  const merged = await (await post('/merchants/rename', { from: 'Audit Fuel', to: 'audit market' })).json();
  assert.equal(merged.merged, true);
  assert.equal(merged.to, 'Audit Market');
  assert.equal(await count('Audit Market'), 3);
  assert.equal(Number((await one(`SELECT count(*) AS n FROM merchant_icon WHERE merchant = 'Audit Fuel'`)).n), 0);

  // A row added after the merge stays put when it's undone.
  await tx('Audit Market', 'm4');
  const undone = await (await post(`/merchants/rename/${merged.audit_id}/undo`, {})).json();
  assert.equal(undone.transactions, 2);
  assert.equal(await count('Audit Fuel'), 2);
  assert.equal(await count('Audit Market'), 2);
  assert.equal((await one(`SELECT emoji FROM merchant_icon WHERE merchant = 'Audit Fuel'`)).emoji, '⛽');
  assert.equal((await post(`/merchants/rename/${merged.audit_id}/undo`, {})).status, 409);

  // Its name already, or none: nothing happens.
  assert.equal((await post('/merchants/rename', { from: 'Audit Market', to: 'Audit Market' })).status, 400);
  assert.equal((await post('/merchants/rename', { from: 'Nobody', to: 'X' })).status, 404);
});

test('a merchant logo is one source: a website, or none, and a bad website is refused (D300, D301)', { skip }, async () => {
  await query(`INSERT INTO merchant_icon (merchant, emoji) VALUES ('Audit Bakery', '🥐')`);
  const patch = (body) => fetch(`${base}/merchant-icons/Audit%20Bakery`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const site = await (await patch({ domain: 'https://www.Audit-Bakery.com/menu' })).json();
  assert.equal(site.domain, 'audit-bakery.com');
  assert.equal(site.emoji, null, 'an emoji left from before goes');
  assert.equal((await patch({ domain: 'not a website' })).status, 400);
  const cleared = await (await patch({ domain: null })).json();
  assert.equal(cleared.domain, null);
});

test('a person\'s profile groups printed names, and addresses into current and previous (D302, D303)', { skip }, async () => {
  const { person, card, bank } = await fixtures();
  await query(`UPDATE account SET holder_name = 'ALEX  Q PARKER' WHERE id = $1`, [card.id]);
  await query(`UPDATE account SET holder_name = 'Alex Q Parker' WHERE id = $1`, [bank.id]);
  // Statements as they were mailed: an old apartment, then a house spelled two ways (one a typo).
  const mailed = [
    [card.id, '2023-01-31', '40 Birch Rd, Apt 7, Riverton, UT 84065'],
    [card.id, '2023-02-28', '40 BIRCH RD APT 7, RIVERTON, UT 84065'],
    [bank.id, '2026-08-31', '12 Elm Woods Dr, Riverton, UT 84065'],
    [card.id, '2026-09-30', '12 ELM WODS DR, RIVERTON, UT 84065'],
    [bank.id, '2026-09-30', '12 Elm Woods Dr, Riverton, UT 84065'],
  ];
  for (const [accountId, end, line] of mailed) {
    await query(`INSERT INTO statement (account_id, period_start, period_end, mailing_address) VALUES ($1, $2::date - 30, $2, $3)`, [accountId, end, line]);
  }
  await query(`INSERT INTO transaction (account_id, posted_date, description, amount_cents, txn_type, dedupe_hash)
               VALUES ($1, '2026-03-02', 'GROCER', -2500, 'purchase', 'pp1')`, [card.id]);
  const res = await fetch(`${base}/people/${person.id}/profile?year=2026`);
  assert.equal(res.status, 200);
  const p = await res.json();
  assert.equal(p.printed_names.length, 1, 'one name, two spellings');
  assert.equal(p.printed_names[0].accounts.length, 2);
  assert.equal(p.address.current.line, '12 Elm Woods Dr, Riverton, UT 84065', 'the spelling printed most');
  assert.equal(p.address.current.first_seen, '2026-08-31');
  assert.equal(p.address.current.last_seen, '2026-09-30');
  assert.equal(p.address.current.accounts.length, 2, 'the typo is the same place');
  assert.equal(p.address.previous.length, 1, 'no address twice');
  assert.deepEqual([p.address.previous[0].first_seen, p.address.previous[0].last_seen, p.address.previous[0].statements], ['2023-01-31', '2023-02-28', 2]);
  assert.equal(p.accounts.length, 2);
  assert.equal(p.money.spent_cents, -2500);
  assert.equal((await fetch(`${base}/people/999999/profile`)).status, 404);
});

test('an alert left open from an earlier month is closed when this month is recorded (D315)', { skip }, async () => {
  await query(`INSERT INTO alert (type, natural_key, month, title, detail) VALUES ('MISSED_RECURRING', 'd315-old', '2020-01', 'Old bill', '{}')`);
  const res = await fetch(`${base}/alerts/history`);
  assert.equal(res.status, 200);
  const { rows: [old] } = await query(`SELECT resolved_at FROM alert WHERE natural_key = 'd315-old'`);
  assert.ok(old.resolved_at, 'closed');
});

test('approving a statement says what it found: a row linked to its bill (D317)', { skip }, async () => {
  const { card } = await fixtures();
  await query(`INSERT INTO recurring_series (name, glyph, match_name_contains, cadence, expected_amount_cents, confidence, created_from, status)
               VALUES ('D317 Stream', '', 'D317 Stream', 'MONTHLY', -1599, 'HIGH', 'MANUAL', 'ACTIVE')`);
  const batch = await one(
    `INSERT INTO import_batch (original_filename, stored_path, file_type, file_hash, status, account_id, parse_method)
     VALUES ('d317.pdf', 'data/d317.pdf', 'PDF', 'hash-d317', 'REVIEW', $1, 'local') RETURNING id`, [card.id]);
  await query(`INSERT INTO staged_transaction (import_batch_id, posted_date, description, merchant, amount_cents, txn_type)
               VALUES ($1, '2026-09-05', 'D317 STREAM 555', 'D317 Stream', -1599, 'purchase')`, [batch.id]);
  const body = await (await post(`/imports/${batch.id}/approve`, { all: true })).json();
  assert.deepEqual(body.follow_up?.bills_linked, ['D317 Stream']);
  assert.ok(Array.isArray(body.follow_up?.new_bills));
});

test('an alert can be snoozed, dismissed or marked paid, and undone (D318)', { skip }, async () => {
  const snooze = await (await post('/alerts/snooze', { key: 'stmt:12', ref: '2026-09-24', kind: 'snooze', days: 3 })).json();
  assert.equal(snooze.kind, 'snooze');
  assert.ok(snooze.until);
  assert.equal((await post('/alerts/snooze', { key: 'pay:9', kind: 'snooze' })).status, 400, 'a snooze needs days');
  await post('/alerts/snooze', { key: 'pay:9', ref: '2026-10-19', kind: 'paid' });
  const live = await (await fetch(`${base}/alerts`)).json();
  assert.deepEqual(live.snoozed.map((s) => [s.key, s.kind]).sort(), [['pay:9', 'paid'], ['stmt:12', 'snooze']]);
  assert.equal((await fetch(`${base}/alerts/snooze?key=pay:9&ref=2026-10-19`, { method: 'DELETE' })).status, 200);
  assert.equal((await (await fetch(`${base}/alerts`)).json()).snoozed.length, 1);
});

test('what was spent each day of a month, refunds netted (D321)', { skip }, async () => {
  const { card } = await fixtures();
  await query(`INSERT INTO transaction (account_id, posted_date, description, amount_cents, txn_type, dedupe_hash)
               VALUES ($1, '2019-03-04', 'D321 A', -1000, 'purchase', 'd321-1'), ($1, '2019-03-04', 'D321 B', 300, 'refund', 'd321-2'),
                      ($1, '2019-03-05', 'D321 PAY', 5000, 'payment', 'd321-3')`, [card.id]);
  const days = await (await fetch(`${base}/transactions/daily?month=2019-03`)).json();
  assert.deepEqual(days.map((d) => [d.date, d.spent_cents, d.count]), [['2019-03-04', 700, 2], ['2019-03-05', 0, 1]]);
  assert.equal((await fetch(`${base}/transactions/daily?month=bad`)).status, 400);
});

test('Re-check links a saved charge to its bill, but never one taken off it by hand (D363)', { skip }, async () => {
  const { card } = await fixtures();
  const bill = await one(`INSERT INTO recurring_series (name, glyph, match_name_contains, cadence, expected_amount_cents, confidence, created_from, status)
                          VALUES ('D363 Gym', '', 'D363 Gym', 'MONTHLY', -2500, 'HIGH', 'MANUAL', 'ACTIVE') RETURNING id`);
  const { rows: [kept, refused] } = await query(
    `INSERT INTO transaction (account_id, posted_date, description, merchant, amount_cents, txn_type, dedupe_hash)
     VALUES ($1, CURRENT_DATE - 40, 'D363 GYM 1', 'D363 Gym', -2500, 'purchase', 'd363-1'),
            ($1, CURRENT_DATE - 10, 'D363 GYM 2', 'D363 Gym', -2500, 'purchase', 'd363-2')
     RETURNING id`, [card.id]);
  await query(`INSERT INTO audit_log (action, entity_type, entity_id, detail) VALUES ('recurring.unlinked', 'transaction', $1, $2)`,
    [refused.id, JSON.stringify({ recurring_series_id: bill.id })]);

  const res = await post('/recurring/recheck');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.linked, 1);
  assert.deepEqual(body.bills, ['D363 Gym']);
  assert.equal(typeof body.found, 'number');
  assert.equal((await one('SELECT recurring_series_id FROM transaction WHERE id = $1', [kept.id])).recurring_series_id, bill.id);
  assert.equal((await one('SELECT recurring_series_id FROM transaction WHERE id = $1', [refused.id])).recurring_series_id, null, 'stays off the bill');
  assert.equal(Number((await one('SELECT occurrence_count FROM recurring_series WHERE id = $1', [bill.id])).occurrence_count), 1);
  assert.ok(await one(`SELECT 1 FROM audit_log WHERE action = 'recurring.rechecked'`));
  assert.equal((await (await post('/recurring/recheck')).json()).linked, 0, 'a second run finds nothing');
});

test('an ignored suggestion is listed and can be asked about again (D364)', { skip }, async () => {
  assert.equal((await post('/recurring/suggestions/ignore', { key: 'D364 Power|MONTHLY|variable' })).status, 200);
  const listed = await (await fetch(`${base}/recurring/suggestions/ignored`)).json();
  assert.ok(listed.some((r) => r.key === 'd364 power|monthly|variable'));
  assert.equal((await post('/recurring/suggestions/restore', { key: 'D364 Power|MONTHLY|variable' })).status, 200);
  assert.equal((await post('/recurring/suggestions/restore', { key: 'D364 Power|MONTHLY|variable' })).status, 404, 'once');
  assert.ok(await one(`SELECT 1 FROM audit_log WHERE action = 'recurring.suggestion_restored' AND detail->>'key' = 'd364 power|monthly|variable'`));
});

test('approving a name read off a line names every unnamed line that reads the same (D367)', { skip }, async () => {
  const { card } = await fixtures();
  const { rows: [a, b, c] } = await query(
    `INSERT INTO transaction (account_id, posted_date, description, amount_cents, txn_type, dedupe_hash)
     VALUES ($1, '2019-07-01', 'AplPay ZQXDILL 437 CENTRAL', -4000, 'purchase', 'd367-1'),
            ($1, '2019-07-09', 'AplPay ZQXDILL 202 THE MAL', -2500, 'purchase', 'd367-2'),
            ($1, '2019-07-10', 'AplPay OTHERSHOP 12 MAIN', -900, 'purchase', 'd367-3') RETURNING id`, [card.id]);
  const flag = await one(`INSERT INTO merchant_review (transaction_id, current_merchant, suggested_merchant, reason)
                          VALUES ($1, NULL, 'Zqxdill', 'Read from the statement line (2 lines)') RETURNING id`, [a.id]);
  const res = await post(`/merchant-review/${flag.id}/approve`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).also_named, 1);
  const names = (await query('SELECT id, merchant FROM transaction WHERE id = ANY($1) ORDER BY id', [[a.id, b.id, c.id]])).rows.map((r) => r.merchant);
  assert.deepEqual(names, ['Zqxdill', 'Zqxdill', null]);
  const entry = await one(`SELECT detail FROM audit_log WHERE action = 'merchant_review.approved' AND entity_id = $1`, [a.id]);
  assert.deepEqual(entry.detail.also_named_ids, [b.id]);
});

test('a merchant merged into a bill\'s name joins the bill, and a variable bill expects its average (D368)', { skip }, async () => {
  const { card } = await fixtures();
  const bill = await one(`INSERT INTO recurring_series (name, glyph, match_name_contains, cadence, expected_amount_cents, amount_varies, match_amount_min_cents, match_amount_max_cents, match_days_of_month, confidence, created_from, status)
                          VALUES ('D368 Power', '', 'D368 Power', 'MONTHLY', -2556, true, -50000, 0, '{20}', 'LOW', 'MANUAL', 'ACTIVE') RETURNING id`);
  await query(`INSERT INTO transaction (account_id, posted_date, description, merchant, amount_cents, txn_type, dedupe_hash, recurring_series_id)
               VALUES ($1, '2019-09-08', 'D368 PWR', 'D368 Power', -2556, 'purchase', 'd368-a', $2)`, [card.id, bill.id]);
  await query(`INSERT INTO transaction (account_id, posted_date, description, merchant, amount_cents, txn_type, dedupe_hash)
               VALUES ($1, '2019-07-06', 'D368 PROC', 'D368 Processor', -20000, 'purchase', 'd368-b'),
                      ($1, '2019-08-06', 'D368 PROC', 'D368 Processor', -20000, 'purchase', 'd368-c')`, [card.id]);
  const res = await post('/merchants/rename', { from: 'D368 Processor', to: 'D368 Power' });
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).bills_linked, ['D368 Power']);
  assert.equal(Number((await one('SELECT count(*) AS n FROM transaction WHERE recurring_series_id = $1', [bill.id])).n), 3);
  const listed = (await (await fetch(`${base}/recurring`)).json()).find((b) => b.id === bill.id);
  assert.equal(listed.expected_amount_cents, -Math.round(42556 / 3), 'Jul–Sep: what it has averaged a month, not its last payment');
});

const upload = (name, text, accountId) => {
  const form = new FormData();
  form.append('statement', new Blob([text], { type: 'text/csv' }), name);
  if (accountId) form.append('account_id', String(accountId));
  return fetch(`${base}/imports`, { method: 'POST', body: form });
};

test('a read says what each of Import\'s boxes found, and a repeat stops at Upload (D325)', { skip }, async () => {
  const { card } = await fixtures();
  await query(`INSERT INTO transaction (account_id, posted_date, description, amount_cents, txn_type, dedupe_hash)
               VALUES ($1, '2019-06-03', 'D325 GROCER #12', -4200, 'purchase', 'd325-1')`, [card.id]);
  const csv = 'Date,Description,Amount\n06/04/2019,D325 Grocer 12,-42.00\n06/09/2019,D325 FUEL,-30.00\n';
  const res = await upload('d325.csv', csv, card.id);
  assert.equal(res.status, 201);
  const batch = await res.json();
  const parsed = await post(`/imports/${batch.id}/parse`);
  assert.equal(parsed.status, 200);
  const { facts } = await parsed.json();
  assert.equal(facts.card_known, 'confirmed');
  assert.equal(facts.account_id, card.id);
  assert.deepEqual([facts.pages, facts.card, facts.rows], [null, null, 2]);
  assert.equal(facts.duplicates, 1, 'the grocer row is already saved a day earlier');

  const again = await upload('d325-copy.csv', csv);
  assert.equal(again.status, 409);
  const body = await again.json();
  assert.equal(body.stage, 'upload');
  assert.equal(body.existing_batch.id, batch.id);
  assert.equal(body.existing_batch.account_id, card.id);
});

test('a CSV the reader can\'t read stops at Read transactions (D325)', { skip }, async () => {
  const batch = await (await upload('d325-bad.csv', 'Payee,Memo\nx,y\n')).json();
  const res = await post(`/imports/${batch.id}/parse`);
  assert.equal(res.status, 422);
  assert.equal((await res.json()).stage, 'read');
});

test('a card with a flat rate earns it on purchases and gives it back on refunds, counted when its statement closes (D330)', { skip }, async () => {
  const { card } = await fixtures();
  const patch = (body) => fetch(`${base}/accounts/${card.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await patch({ cashback_rate_bps: 0 })).status, 400, 'a rate is at least 1 basis point');
  assert.equal((await patch({ cashback_rate_bps: 300 })).status, 200);
  assert.ok(await one(`SELECT 1 FROM audit_log WHERE action = 'account.updated' AND entity_id = $1 AND detail::text LIKE '%cashback_rate_bps%'`, [card.id]));

  const batch = await one(
    `INSERT INTO import_batch (original_filename, stored_path, file_type, file_hash, status, account_id, parse_method)
     VALUES ('r.pdf', 'data/r.pdf', 'PDF', 'd330', 'APPROVED', $1, 'local') RETURNING id`, [card.id]);
  await query(`INSERT INTO statement (import_batch_id, account_id, period_start, period_end) VALUES ($1, $2, '2031-02-25', '2031-03-24')`, [batch.id, card.id]);
  const row = (n, description, cents, type) => query(
    `INSERT INTO transaction (account_id, import_batch_id, posted_date, description, amount_cents, txn_type, dedupe_hash)
     VALUES ($1, $2, '2031-03-0${n}', $3, $4, $5, 'd330-${n}')`, [card.id, batch.id, description, cents, type]);
  await row(1, 'CORNER CAFE', -1000, 'purchase'); // 30
  await row(2, 'BOOKSHOP', -1050, 'purchase'); // 31.5, rounds to 32
  await row(3, 'BOOKSHOP CREDIT', 500, 'refund'); // takes 15 back
  await row(4, 'GOLD ANNUAL SUBSCRIPTIO', -5000, 'purchase'); // the card's own fee: nothing
  await row(5, 'INTEREST CHARGE ON PURCHASES', -200, 'interest'); // nothing
  await row(6, 'PAYMENT THANK YOU', 9000, 'payment'); // nothing

  const list = await (await fetch(`${base}/transactions?account_id=${card.id}&from=2031-03-01&to=2031-03-09`)).json();
  const earned = Object.fromEntries(list.rows.map((r) => [r.description, r.cashback_cents]));
  assert.deepEqual(earned, { 'CORNER CAFE': 30, BOOKSHOP: 32, 'BOOKSHOP CREDIT': -15, 'GOLD ANNUAL SUBSCRIPTIO': null, 'INTEREST CHARGE ON PURCHASES': null, 'PAYMENT THANK YOU': null });
  assert.equal(list.cashback_cents, 47, 'the rows listed add up');

  const year = await (await fetch(`${base}/summary/cashback?year=2031`)).json();
  const item = year.items.find((i) => i.account_id === card.id);
  assert.deepEqual([item.amount_cents, item.posted_date, item.source, item.calculated, item.rate_bps], [47, '2031-03-24', 'statement', true, 300]);
  assert.equal(year.cards.find((c) => c.account_id === card.id).how, 'paid_out', 'never shown as waiting');
  const overview = await (await fetch(`${base}/summary?month=2031-03`)).json();
  assert.equal(overview.secondary.cashback_interest.current_breakdown.cashback_cents, 47, 'Overview counts the same figure');

  // Every other card shows nothing earned per row.
  const { card: plain } = await fixtures();
  assert.equal((await (await fetch(`${base}/transactions?account_id=${plain.id}`)).json()).cashback_cents, null);
});

test('a gift card is recorded, counted as cashback on its day, edited and voided, each audited (D330)', { skip }, async () => {
  const { card } = await fixtures();
  const send = (method, path, body) => fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  const batch = await one(
    `INSERT INTO import_batch (original_filename, stored_path, file_type, file_hash, status, account_id, parse_method)
     VALUES ('g.pdf', 'data/g.pdf', 'PDF', 'd330-gift', 'APPROVED', $1, 'local') RETURNING id`, [card.id]);
  await query(`INSERT INTO statement (import_batch_id, account_id, period_start, period_end, cashback_earned_cents, cashback_balance_cents)
               VALUES ($1, $2, '2032-01-11', '2032-02-10', 500, 2000)`, [batch.id, card.id]);

  assert.equal((await send('POST', '/redemptions', { account_id: card.id, redeemed_on: '2032-02-20', brand: '', value_cents: 1800 })).status, 400, 'named');
  assert.equal((await send('POST', '/redemptions', { account_id: card.id, redeemed_on: '2032-02-20', brand: 'Bookshop', value_cents: 0 })).status, 400, 'worth something');
  const res = await send('POST', '/redemptions', { account_id: card.id, redeemed_on: '2032-02-20', brand: 'Bookshop', value_cents: 1800, rewards_used_cents: 1500 });
  assert.equal(res.status, 201);
  const gift = await res.json();
  assert.ok(await one(`SELECT 1 FROM audit_log WHERE action = 'reward.redeemed' AND entity_id = $1`, [gift.id]));

  const year = async () => (await (await fetch(`${base}/summary/cashback?year=2032`)).json());
  let y = await year();
  assert.equal(y.by_kind.giftcard, 1800);
  assert.equal(y.cards.find((c) => c.account_id === card.id).waiting_cents, 500, '2000 held less the 1500 it cost');
  const overview = await (await fetch(`${base}/summary?month=2032-02`)).json();
  assert.equal(overview.secondary.cashback_interest.current_breakdown.cashback_cents, 1800, 'Overview counts it in February');

  assert.equal((await send('PATCH', `/redemptions/${gift.id}`, { value_cents: 2000 })).status, 200);
  assert.ok(await one(`SELECT 1 FROM audit_log WHERE action = 'reward.redemption_updated' AND entity_id = $1 AND detail::text LIKE '%2000%'`, [gift.id]));
  assert.equal((await year()).by_kind.giftcard, 2000);

  assert.equal((await send('POST', `/redemptions/${gift.id}/void`)).status, 200);
  assert.equal((await send('POST', `/redemptions/${gift.id}/void`)).status, 409, 'once');
  assert.equal((await send('PATCH', `/redemptions/${gift.id}`, { value_cents: 10 })).status, 409, 'a removed one stays removed');
  y = await year();
  assert.equal(y.by_kind.giftcard, 0);
  assert.equal(y.cards.find((c) => c.account_id === card.id).waiting_cents, 2000);
  assert.ok(await one('SELECT 1 FROM reward_redemption WHERE id = $1 AND voided_at IS NOT NULL', [gift.id]), 'kept, not deleted');
  assert.equal((await (await fetch(`${base}/redemptions`)).json()).some((r) => r.id === gift.id), false);
});

test('the month-by-month figures count off-ledger cashback once a month, with or without rows that month (D389)', { skip }, async () => {
  const { card } = await fixtures();
  const row = (date, description, cents, type) => query(
    `INSERT INTO transaction (account_id, posted_date, description, amount_cents, txn_type, dedupe_hash)
     VALUES ($1, $2, $3, $4, $5, $6)`, [card.id, date, description, cents, type, `d389-${date}-${cents}`]);
  // February: four rows and a gift card. March: a gift card and no rows.
  await row('2033-02-03', 'CORNER CAFE', -1200, 'purchase');
  await row('2033-02-09', 'INTEREST PAID', 100, 'interest');
  await row('2033-02-14', 'LATE FEE', -300, 'fee');
  await row('2033-02-28', 'INTEREST CHARGE', -250, 'interest');
  const gift = (redeemed_on, value_cents) => post('/redemptions', { account_id: card.id, redeemed_on, brand: 'Bookshop', value_cents });
  assert.equal((await gift('2033-02-20', 700)).status, 201);
  assert.equal((await gift('2033-03-05', 400)).status, 201);

  const byMonth = (await (await fetch(`${base}/summary?month=2033-03`)).json()).secondary_by_month;
  assert.deepEqual(byMonth.map((m) => [m.month, m.cashback_interest_cents, m.fee_interest_cents]), [
    ['2033-01', 0, 0],
    ['2033-02', 700 + 100, -300 - 250], // the gift card once, not once per row
    ['2033-03', 400, 0],
  ]);
});

test('every setting comes back in one request, the same values the per-key route gives (D389)', { skip }, async () => {
  const put = (key, value) => fetch(`${base}/app-settings/${key}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value }) });
  assert.equal((await put('d389_layout', { layout: 'bento' })).status, 200);
  assert.equal((await put('d389_list', ['a', 'b'])).status, 200);
  const all = await (await fetch(`${base}/app-settings`)).json();
  assert.deepEqual([all.d389_layout, all.d389_list], [{ layout: 'bento' }, ['a', 'b']]);
  assert.deepEqual((await (await fetch(`${base}/app-settings/d389_layout`)).json()).value, all.d389_layout);
  assert.equal('d389_never_saved' in all, false, 'a setting never saved is simply absent');
});

test('a question saved for Claude Code waits, is answered once, seen once and dismissed, each audited (D332)', { skip }, async () => {
  const list = async (q = '') => (await (await fetch(`${base}/assistant/questions${q}`)).json());
  assert.equal((await post('/assistant/questions', { question: '   ', via: 'claude_code' })).status, 400, 'something to ask');
  assert.equal((await post('/assistant/questions', { question: 'Rent this year?', via: 'local' })).status, 400, 'only Claude Code saves for now');

  const res = await post('/assistant/questions', { question: '  Rent this year?  ', via: 'claude_code' });
  assert.equal(res.status, 201);
  const saved = await res.json();
  assert.deepEqual([saved.question, saved.status, saved.answer], ['Rent this year?', 'waiting', null]);
  assert.ok(await one(`SELECT 1 FROM audit_log WHERE action = 'assistant.asked' AND entity_id = $1`, [saved.id]));
  assert.ok((await list('?status=waiting')).questions.some((q) => q.id === saved.id));
  assert.equal((await post(`/assistant/questions/${saved.id}/seen`)).status, 404, 'nothing to see before an answer');

  assert.equal((await post(`/assistant/questions/${saved.id}/answer`, { answer: '' })).status, 400);
  const answered = await (await post(`/assistant/questions/${saved.id}/answer`, { answer: 'Rent: 3 payments.' })).json();
  assert.deepEqual([answered.status, answered.answered_by, answered.answer], ['answered', 'claude_code', 'Rent: 3 payments.']);
  assert.equal((await post(`/assistant/questions/${saved.id}/answer`, { answer: 'again' })).status, 409, 'answered once');
  assert.equal((await list()).unseen >= 1, true);

  assert.equal((await post(`/assistant/questions/${saved.id}/seen`)).status, 200);
  assert.equal((await post(`/assistant/questions/${saved.id}/seen`)).status, 200, 'opening again is fine');
  assert.equal(Number((await one(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'assistant.seen' AND entity_id = $1`, [saved.id])).n), 1, 'audited the first time only');
  assert.equal((await list()).questions.find((q) => q.id === saved.id).seen_at !== null, true);

  assert.equal((await post(`/assistant/questions/${saved.id}/dismiss`)).status, 200);
  assert.equal((await post(`/assistant/questions/${saved.id}/dismiss`)).status, 409, 'once');
  assert.equal((await list()).questions.some((q) => q.id === saved.id), false);
  assert.ok(await one(`SELECT 1 FROM assistant_question WHERE id = $1 AND dismissed_at IS NOT NULL`, [saved.id]), 'kept, not deleted');
  assert.equal((await post('/assistant/questions/999999/answer', { answer: 'x' })).status, 404);
});

test('answer here: reads the question, sums spending the way Overview does, keeps it with what it found (D332 step 3)', { skip }, async () => {
  const { card, bank } = await fixtures();
  const row = (account, date, cents, type, n) => query(
    `INSERT INTO transaction (account_id, posted_date, description, merchant, amount_cents, txn_type, dedupe_hash)
     VALUES ($1, $2, 'TESTSHIRE LETTINGS', 'Testshire Lettings', $3, $4, $5)`, [account, date, cents, type, `d332-ask-${n}`]);
  await row(bank.id, '2019-01-03', -150000, 'purchase', 1);
  await row(bank.id, '2019-02-03', -150000, 'purchase', 2);
  await row(bank.id, '2019-02-10', 50000, 'refund', 3); // a share paid back
  await row(card.id, '2019-02-12', -99999, 'transfer', 4); // moving money: not spending

  const ask = async (question) => {
    const res = await post('/assistant/ask', { question });
    assert.equal(res.status, 201);
    return res.json();
  };
  const total = await ask('How much did I pay Testshire Lettings in 2019?');
  assert.deepEqual([total.status, total.asked_via, total.answer], ['answered', 'local', 'Testshire Lettings · total · 2019']);
  const p = total.answer_detail.periods[0];
  assert.deepEqual([p.paid_cents, p.back_cents, p.net_cents, p.count, p.back_count], [300000, 50000, 250000, 2, 1]);
  assert.equal(total.answer_detail.rows_total, 3, 'the transfer is not behind it');
  assert.ok(await one(`SELECT 1 FROM audit_log WHERE action = 'assistant.asked' AND entity_id = $1 AND detail->>'via' = 'local'`, [total.id]));

  const months = (await ask('Testshire Lettings by month in 2019')).answer_detail.months;
  assert.equal(months.length, 12);
  assert.deepEqual(months.slice(0, 2).map((m) => [m.paid_cents, m.back_cents, m.net_cents]), [[150000, 0, 150000], [150000, 50000, 100000]]);

  const cmp = (await ask('Testshire Lettings january 2019 vs february 2019')).answer_detail.periods;
  assert.deepEqual(cmp.map((x) => [x.label, x.net_cents]), [['Jan 2019', 150000], ['Feb 2019', 100000]]);

  const lost = await ask('hello there');
  assert.deepEqual([lost.status, lost.answer_detail.understood], ['not_understood', false]);

  // The list leaves the detail out; one question has it.
  const listed = (await (await fetch(`${base}/assistant/questions`)).json()).questions.find((q) => q.id === total.id);
  assert.deepEqual([listed.has_detail, 'answer_detail' in listed], [true, false]);
  assert.equal((await (await fetch(`${base}/assistant/questions/${total.id}`)).json()).answer_detail.periods[0].net_cents, 250000);
  assert.equal((await post('/assistant/ask', { question: ' ' })).status, 400);
});

test('Ask Claude: the tool loop runs read-only lookups and keeps what it found, without calling the real API (D332 step 4)', { skip }, async () => {
  const { askClaude, costMicrodollars } = await import('../assistant/claude.js');
  const { loadVocabLists } = await import('../assistant/answer.js');
  const { bank } = await fixtures();
  await query(
    `INSERT INTO transaction (account_id, posted_date, description, merchant, amount_cents, txn_type, dedupe_hash)
     VALUES ($1, '2018-03-04', 'BRAMBLE HOUSE', 'Bramble House', -4200, 'purchase', 'd332-claude-1')`, [bank.id]);

  // A stand-in for the SDK client: first a lookup, then an answer. It records what it was sent.
  const sent = [];
  const turns = [
    { stop_reason: 'tool_use', usage: { input_tokens: 1000, output_tokens: 50 }, content: [
      { type: 'tool_use', id: 't1', name: 'find_names', input: { text: 'bramble' } },
      { type: 'tool_use', id: 't2', name: 'spending', input: { subjects: [{ kind: 'merchant', name: 'bramble house' }], periods: [{ from: '2018-01-01', to: '2018-12-31' }], view: 'total', top_n: 5 } },
      { type: 'tool_use', id: 't3', name: 'spending', input: { subjects: [{ kind: 'merchant', name: 'No Such Place' }], periods: [{ from: '2018-01-01', to: '2018-12-31' }], view: 'total', top_n: 5 } },
    ] },
    { stop_reason: 'end_turn', usage: { input_tokens: 1200, output_tokens: 80, cache_read_input_tokens: 900 }, content: [{ type: 'text', text: 'Bramble House, 2018: $42.00.\nHow: merchant Bramble House.' }] },
  ];
  const client = { beta: { messages: { create: async (params) => { sent.push(structuredClone(params)); return turns.shift(); } } } };

  const out = await askClaude({ question: 'Bramble House in 2018?', query, lists: await loadVocabLists(query), today: '2026-10-23', client });
  assert.equal(out.ok, true);
  assert.equal(out.text.split('\n')[0], 'Bramble House, 2018: $42.00.');
  assert.deepEqual(out.lookups.map((l) => l.tool), ['find_names', 'spending', 'spending']);
  assert.equal(out.lookups[1].result.periods[0].net_cents, 4200, 'the name matched without case, and the real query ran');
  assert.match(out.lookups[2].error, /Not in the ledger/);
  assert.equal(out.rounds, 2);

  // What was sent: opt-in model and fallbacks, the date in the question, the tool results back as one user turn.
  assert.equal(sent[0].model, 'claude-opus-5-5');
  assert.deepEqual([sent[0].fallbacks, sent[0].betas], ['default', ['server-side-fallback-2026-07-01']]);
  assert.match(sent[0].messages[0].content, /^Today is 2026-10-23\./);
  const results = sent[1].messages[2].content;
  assert.deepEqual(results.map((r) => r.tool_use_id), ['t1', 't2', 't3']);
  assert.equal(results[2].is_error, true);
  assert.ok(!JSON.stringify(sent).includes('"mask"'), 'no card numbers sent');

  assert.deepEqual(out.usage, { input_tokens: 2200, output_tokens: 130, cache_creation_input_tokens: 0, cache_read_input_tokens: 900 });
  assert.equal(out.cost_microdollars, costMicrodollars(out.usage));
  assert.equal(costMicrodollars({ input_tokens: 1_000_000, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }), 4_000_000, '$4 per million in');

  // A refusal and an empty reply are failures, not answers.
  const once = (r) => ({ beta: { messages: { create: async () => r } } });
  assert.equal((await askClaude({ question: 'x', query, lists: await loadVocabLists(query), today: '2026-10-23', client: once({ stop_reason: 'refusal', content: [], usage: {} }) })).ok, false);
  assert.equal((await askClaude({ question: 'x', query, lists: await loadVocabLists(query), today: '2026-10-23', client: once({ stop_reason: 'end_turn', content: [], usage: {} }) })).ok, false);
});

test('tidying merchants names lines from known merchants, queues the unsure, and undoes exactly (D337)', { skip }, async () => {
  const { card } = await fixtures();
  const ins = (description, merchant, txn_type = 'purchase') => one(
    `INSERT INTO transaction (account_id, posted_date, description, merchant, amount_cents, txn_type, dedupe_hash)
     VALUES ($1, '2026-09-02', $2, $3, -500, $4, md5(random()::text)) RETURNING id`, [card.id, description, merchant, txn_type]);
  await ins('WALGREENS 1 SAN JOSE', 'Walgreens'); await ins('WALGREENS 2 SAN JOSE', 'Walgreens');
  const unnamed = await ins('APPLEPAY WALGREENS 9 SAN JOSE', null);
  const deposit = await ins('ACH DEPOSIT FROM WALGREENS PAYROLL', null, 'deposit');
  const dry = await (await post('/merchants/tidy?dry=1')).json();
  assert.equal(dry.dry, true);
  assert.equal((await one('SELECT merchant FROM transaction WHERE id = $1', [unnamed.id])).merchant, null, 'a dry run changes nothing');
  const done = await (await post('/merchants/tidy')).json();
  assert.ok(done.named >= 1);
  assert.equal((await one('SELECT merchant FROM transaction WHERE id = $1', [unnamed.id])).merchant, 'Walgreens');
  assert.equal((await one('SELECT merchant FROM transaction WHERE id = $1', [deposit.id])).merchant, null, 'a deposit stays as printed');
  assert.equal((await post(`/merchants/tidy/${done.audit_id}/undo`)).status, 200);
  assert.equal((await one('SELECT merchant FROM transaction WHERE id = $1', [unnamed.id])).merchant, null);
  assert.equal((await post(`/merchants/tidy/${done.audit_id}/undo`)).status, 409, 'once');
});

test('a shared card: the second person\'s rows are proposed, filed when they\'re added, refunds follow the purchase, Undo puts them back (D344)', { skip }, async () => {
  const { card } = await fixtures();
  const sam = await one(`INSERT INTO person (name) VALUES ('Sam') RETURNING id`);
  const batch = async (hash, rows) => {
    const b = await one(
      `INSERT INTO import_batch (original_filename, stored_path, file_type, file_hash, status, account_id, parse_method)
       VALUES ('m.pdf', 'data/m.pdf', 'PDF', $1, 'REVIEW', $2, 'local') RETURNING id`, [hash, card.id]);
    for (const [date, description, merchant, cents, type, name, ending] of rows) {
      await query(
        `INSERT INTO staged_transaction (import_batch_id, posted_date, description, merchant, amount_cents, txn_type, spender_name, card_ending)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [b.id, date, description, merchant, cents, type, name, ending]);
    }
    assert.equal((await post(`/imports/${b.id}/approve`, { all: true })).status, 200);
  };
  await batch('d344-1', [
    ['2026-08-02', 'CAFE 1', 'Cafe', -1200, 'purchase', 'ALEX MORGAN', '1111'],
    ['2026-08-03', 'SHOE STORE 9', 'Shoe Store', -5000, 'purchase', 'SAM RIVERA', '8765'],
    ['2026-08-20', 'SHOE STORE 9', 'Shoe Store', 2000, 'refund', null, null],
    ['2026-08-25', 'PAYMENT THANK YOU', null, 6200, 'payment', null, null],
  ]);
  const spenders = async () => (await query(
    `SELECT description, spender_person_id FROM transaction WHERE account_id = $1 ORDER BY posted_date`, [card.id])).rows.map((r) => r.spender_person_id);

  // Nobody is on the card yet: every row counts as the owner's, the second person is proposed.
  assert.deepEqual(await spenders(), [null, null, null, null]);
  const listed = await (await fetch(`${base}/accounts/${card.id}/members`)).json();
  assert.deepEqual(listed.proposed.map((p) => [p.printed_name, p.card_ending, p.rows]), [['SAM RIVERA', '8765', 1]]);

  const added = await post(`/accounts/${card.id}/members`, { person_id: sam.id, role: 'additional', printed_name: 'SAM RIVERA', card_ending: '8765' });
  assert.equal(added.status, 201);
  const { moved, audit_id } = await added.json();
  assert.equal(moved, 2, 'the purchase, and the refund that gives part of it back');
  assert.deepEqual(await spenders(), [null, sam.id, sam.id, null], 'the payment stays with the owner');
  assert.equal((await (await fetch(`${base}/accounts/${card.id}/members`)).json()).proposed.length, 0);
  assert.equal((await post(`/accounts/${card.id}/members`, { person_id: sam.id, role: 'additional' })).status, 409);
  assert.equal((await post(`/accounts/${card.id}/members`, { person_id: sam.id, role: 'additional', card_ending: '12345' })).status, 400);

  // The next statement files the member's rows as it's approved.
  await batch('d344-2', [['2026-09-04', 'BAKERY 7', 'Bakery', -800, 'purchase', 'S RIVERA', '8765']]);
  assert.equal((await one(`SELECT spender_person_id FROM transaction WHERE description = 'BAKERY 7'`)).spender_person_id, sam.id);

  const undo = await post(`/accounts/${card.id}/members/undo/${audit_id}`);
  assert.equal(undo.status, 200);
  assert.equal((await undo.json()).restored, 2);
  assert.deepEqual((await spenders()).slice(0, 4), [null, null, null, null]);
  assert.equal((await one(`SELECT is_active FROM account_member WHERE person_id = $1`, [sam.id])).is_active, false, 'set inactive, not deleted');
  assert.equal((await post(`/accounts/${card.id}/members/undo/${audit_id}`)).status, 409);
});

test('"by person" follows who spent it on a shared card: Overview, its top categories, and the Transactions filter (D344)', { skip }, async () => {
  const { person: owner, card } = await fixtures();
  const sam = await one(`INSERT INTO person (name) VALUES ('Sam') RETURNING id`);
  const row = (date, cents, type, spender, hash) => query(
    `INSERT INTO transaction (account_id, posted_date, description, amount_cents, txn_type, spender_person_id, dedupe_hash)
     VALUES ($1, $2, 'ROW', $3, $4, $5, $6)`, [card.id, date, cents, type, spender, hash]);
  await row('2031-03-02', -1000, 'purchase', null, 'd344-p1');    // the owner's, no spender
  await row('2031-03-03', -4000, 'purchase', sam.id, 'd344-p2');  // the member's
  await row('2031-03-09', 500, 'refund', sam.id, 'd344-p3');      // their refund
  await row('2031-03-20', 4500, 'payment', null, 'd344-p4');      // a payment, the owner's, not spend

  const summary = await (await fetch(`${base}/summary?month=2031-03`)).json();
  const net = (id) => Number(summary.by_person.find((p) => p.id === id).net_cents);
  assert.equal(net(owner.id), -1000);
  assert.equal(net(sam.id), -3500, 'the member\'s purchase less their refund');
  assert.ok(summary.spend_by_person_category.some((c) => c.person_id === sam.id));

  const txns = await (await fetch(`${base}/transactions?person_id=${sam.id}&from=2031-03-01&to=2031-03-31`)).json();
  const list = txns.transactions ?? txns.rows ?? txns;
  assert.deepEqual(list.map((t) => t.amount_cents).sort((a, b) => a - b), [-4000, 500]);
  assert.ok(list.every((t) => t.person_id === sam.id && t.account_person_id === owner.id));
});

test('a statement keeps its credit line and year-to-date box, and a later read that doesn\'t print them keeps them (D346)', { skip }, async () => {
  const { card } = await fixtures();
  const { upsertStatement } = await import('./imports/shared.js');
  const { withTransaction } = await import('../core/db.js');
  const batch = await one(
    `INSERT INTO import_batch (original_filename, stored_path, file_type, file_hash, status, account_id, parse_method)
     VALUES ('c.pdf', 'data/c.pdf', 'PDF', 'd346-1', 'APPROVED', $1, 'local') RETURNING id`, [card.id]);
  const base = { period_start: '2031-05-06', period_end: '2031-06-05', closing_balance_cents: 25000 };
  await withTransaction((client) => upsertStatement(client, card.id, batch.id, {
    ...base, credit_limit_cents: 500000, available_credit_cents: 475000, cash_advance_limit_cents: 100000,
    ytd_year: 2031, ytd_fees_cents: 0, ytd_interest_cents: 1234,
  }));
  await withTransaction((client) => upsertStatement(client, card.id, batch.id, base));
  const s = await one(`SELECT credit_limit_cents, available_credit_cents, cash_advance_limit_cents, ytd_year, ytd_fees_cents, ytd_interest_cents
                         FROM statement WHERE account_id = $1 AND period_end = '2031-06-05'`, [card.id]);
  assert.deepEqual(Object.fromEntries(Object.entries(s).map(([k, v]) => [k, Number(v)])),
    { credit_limit_cents: 500000, available_credit_cents: 475000, cash_advance_limit_cents: 100000, ytd_year: 2031, ytd_fees_cents: 0, ytd_interest_cents: 1234 });
});

test('the statements list says whether each card statement\'s year-to-date box matches its fee and interest rows (D346)', { skip }, async () => {
  const { card } = await fixtures();
  const statement = async (hash, start, end, fees, interest, rows) => {
    const b = await one(
      `INSERT INTO import_batch (original_filename, stored_path, file_type, file_hash, status, account_id, parse_method)
       VALUES ('y.pdf', 'data/y.pdf', 'PDF', $1, 'APPROVED', $2, 'local') RETURNING id`, [hash, card.id]);
    await query(`INSERT INTO statement (import_batch_id, account_id, period_start, period_end, ytd_year, ytd_fees_cents, ytd_interest_cents)
                 VALUES ($1, $2, $3, $4, 2032, $5, $6)`, [b.id, card.id, start, end, fees, interest]);
    for (const [type, cents, text] of rows) {
      await query(`INSERT INTO transaction (account_id, import_batch_id, posted_date, description, amount_cents, txn_type, dedupe_hash)
                   VALUES ($1, $2, $3, $4, $5, $6, $7)`, [card.id, b.id, end, text, cents, type, `${hash}-${text}`]);
    }
    return b.id;
  };
  await statement('d346-a', '2032-01-06', '2032-02-05', 0, 1000, [['interest', -1000, 'INTEREST CHARGED']]);
  const good = await statement('d346-b', '2032-02-06', '2032-03-05', 2900, 1500, [['fee', -2900, 'LATE FEE'], ['interest', -500, 'INTEREST CHARGED']]);
  const missingFee = await statement('d346-c', '2032-03-06', '2032-04-05', 5800, 1500, []);
  const afterGap = await statement('d346-d', '2032-06-06', '2032-07-05', 5800, 1500, []);

  const list = await (await fetch(`${base}/imports`)).json();
  const check = (id) => list.find((b) => b.id === id).ytd_check;
  assert.deepEqual(check(good), { fees: true, interest: true, gap: false });
  assert.deepEqual(check(missingFee), { fees: false, interest: true, gap: false }, 'a fee the rows don\'t have');
  assert.deepEqual(check(afterGap), { fees: null, interest: null, gap: true }, 'a statement missing before it');
});

test('a card\'s statement facts follow the month: the statement that closed in it, else the newest (D347)', { skip }, async () => {
  const { card } = await fixtures();
  for (const [hash, end, limit, owed] of [['d347-a', '2033-02-05', 500000, 10000], ['d347-b', '2033-03-05', 800000, 20000]]) {
    const b = await one(`INSERT INTO import_batch (original_filename, stored_path, file_type, file_hash, status, account_id, parse_method)
                         VALUES ('f.pdf', 'data/f.pdf', 'PDF', $1, 'APPROVED', $2, 'local') RETURNING id`, [hash, card.id]);
    await query(`INSERT INTO statement (import_batch_id, account_id, period_start, period_end, credit_limit_cents, closing_balance_cents)
                 VALUES ($1, $2, $3::date - 30, $3, $4, $5)`, [b.id, card.id, end, limit, owed]);
  }
  const facts = async (q) => (await (await fetch(`${base}/accounts/${card.id}/statement-facts${q}`)).json()).statement;
  assert.equal(Number((await facts('?month=2033-02')).credit_limit_cents), 500000, 'the limit that month');
  assert.equal(Number((await facts('')).credit_limit_cents), 800000, 'the newest');
  assert.equal(await facts('?month=2033-04'), null, 'no statement that month');
  assert.equal((await fetch(`${base}/accounts/${card.id}/statement-facts?month=March`)).status, 400);
});

test('Where: places with their counts, the filter keeps only that place\'s rows, rows say when bought and the wallet (D352)', { skip }, async () => {
  const { card } = await fixtures();
  const b = await one(`INSERT INTO import_batch (original_filename, stored_path, file_type, file_hash, status, account_id, parse_method)
                       VALUES ('w.pdf', 'data/w.pdf', 'PDF', 'd352-w', 'APPROVED', $1, 'local') RETURNING id`, [card.id]);
  const rows = [
    ['2034-03-13', 'TACO STAND 3267 ZORBATOWN NC', -900, '03/11   03/13   TACO STAND 3267 ZORBATOWN NC   0139   5119   9.00'],
    ['2034-03-14', 'AplPay CORNER CAFE   ZORBATOWN   NC', -500, null],
    ['2034-03-15', 'BOOK BARN 12 QUILLVILLE TX', -700, null],
  ];
  for (const [date, description, cents, raw] of rows) {
    const t = await one(`INSERT INTO transaction (account_id, import_batch_id, posted_date, description, amount_cents, txn_type, dedupe_hash)
                         VALUES ($1, $2, $3, $4, $5, 'purchase', $6) RETURNING id`, [card.id, b.id, date, description, cents, `d352-${description}`]);
    if (raw) await query(`INSERT INTO staged_transaction (import_batch_id, posted_date, description, amount_cents, review_status, raw_text, transaction_id)
                          VALUES ($1, $2, $3, $4, 'APPROVED', $5, $6)`, [b.id, date, description, cents, raw, t.id]);
  }
  const places = await (await fetch(`${base}/transactions/places`)).json();
  assert.equal(places.find((p) => p.key === 'Zorbatown|NC').count, 2);
  const list = await (await fetch(`${base}/transactions?place=Zorbatown|NC&from=2034-03-01&to=2034-03-31`)).json();
  assert.deepEqual(list.rows.map((r) => r.amount_cents).sort((a, c) => a - c), [-900, -500]);
  const taco = list.rows.find((r) => r.amount_cents === -900);
  assert.deepEqual([taco.sale_date, taco.raw_text], ['2034-03-11', undefined], 'bought two days before it posted; the line itself not sent');
  assert.equal(list.rows.find((r) => r.amount_cents === -500).paid_with.label, 'Apple Pay', 'the wallet, now one of the ways a row was paid (D359)');
  assert.equal((await (await fetch(`${base}/transactions?place=Nowhere|ZZ&from=2034-03-01&to=2034-03-31`)).json()).rows.length, 0);
  // A whole state at once (D370).
  const nc = await (await fetch(`${base}/transactions?place=state:NC&from=2034-03-01&to=2034-03-31`)).json();
  assert.deepEqual(nc.rows.map((r) => r.amount_cents).sort((a, c) => a - c), [-900, -500]);
  const both = await (await fetch(`${base}/transactions?place=state:NC,state:TX&from=2034-03-01&to=2034-03-31`)).json();
  assert.equal(both.rows.length, 3);
});

test('a nickname is saved and audited, and rows say when another open account shares it (D353)', { skip }, async () => {
  const { card } = await fixtures();
  const patch = (id, body) => fetch(`${base}/accounts/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await (await patch(card.id, { nickname: 'Tester' })).json()).nickname, 'Tester');
  assert.equal((await patch(card.id, { nickname: 'x'.repeat(25) })).status, 400);
  await query(`INSERT INTO transaction (account_id, posted_date, description, amount_cents, txn_type, dedupe_hash) VALUES ($1, '2035-01-02', 'CAFE', -100, 'purchase', 'd353-a')`, [card.id]);
  const row = async () => (await (await fetch(`${base}/transactions?account_id=${card.id}&from=2035-01-01&to=2035-01-31`)).json()).rows[0];
  assert.deepEqual([(await row()).account_nickname, (await row()).account_nickname_shared], ['Tester', false]);
  const other = await one(`INSERT INTO account (person_id, name, account_type, mask, nickname) SELECT person_id, 'Other', 'CREDIT_CARD', '9999', 'Tester' FROM account WHERE id = $1 RETURNING id`, [card.id]);
  assert.equal((await row()).account_nickname_shared, true);
  await query('UPDATE account SET is_active = false WHERE id = $1', [other.id]);
  assert.equal((await row()).account_nickname_shared, false, 'a closed account doesn\'t count');
});

test('a limit the household sets is used only where no statement printed one, and is marked as theirs (D354)', { skip }, async () => {
  const { card } = await fixtures();
  const b = await one(`INSERT INTO import_batch (original_filename, stored_path, file_type, file_hash, status, account_id, parse_method)
                       VALUES ('m.pdf', 'data/m.pdf', 'CSV', 'd354-m', 'APPROVED', $1, 'local') RETURNING id`, [card.id]);
  await query(`INSERT INTO statement (import_batch_id, account_id, period_start, period_end, closing_balance_cents) VALUES ($1, $2, '2036-01-06', '2036-02-05', 25000)`, [b.id, card.id]);
  const patch = (body) => fetch(`${base}/accounts/${card.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(Number((await (await patch({ credit_limit_manual_cents: 500000 })).json()).credit_limit_manual_cents), 500000);
  const line = async () => (await (await fetch(`${base}/accounts`)).json()).find((a) => a.id === card.id).credit_line;
  const own = await line();
  assert.deepEqual([Number(own.credit_limit_cents), own.available_credit_cents, Number(own.closing_balance_cents), own.as_of, own.source],
    [500000, null, 25000, '2036-02-05', 'manual']);
  const facts = await (await fetch(`${base}/accounts/${card.id}/statement-facts`)).json();
  assert.equal(Number(facts.manual_limit_cents), 500000);
  // A printed limit wins.
  await query(`UPDATE statement SET credit_limit_cents = 300000 WHERE import_batch_id = $1`, [b.id]);
  assert.equal(Number((await line()).credit_limit_cents), 300000);
  assert.equal((await line()).source, undefined);
  assert.equal((await patch({ credit_limit_manual_cents: 0 })).status, 400);
  assert.equal((await (await patch({ credit_limit_manual_cents: null })).json()).credit_limit_manual_cents, null);
});

test('a bank account\'s month: balance, what its statement says it earned, the year so far with bonuses (D355)', { skip }, async () => {
  const { bank } = await fixtures();
  const b = await one(`INSERT INTO import_batch (original_filename, stored_path, file_type, file_hash, status, account_id, parse_method)
                       VALUES ('s.pdf', 'data/s.pdf', 'PDF', 'd355-s', 'APPROVED', $1, 'local') RETURNING id`, [bank.id]);
  await query(`INSERT INTO statement (import_batch_id, account_id, period_start, period_end, closing_balance_cents, savings)
               VALUES ($1, $2, '2037-03-01', '2037-03-31', 1000000, '{"apy_bps": 361, "interest_cents": 3012, "interest_ytd_cents": 9000}')`, [b.id, bank.id]);
  const row = (date, desc, cents, type, h) => query(`INSERT INTO transaction (account_id, posted_date, description, amount_cents, txn_type, dedupe_hash)
                                                     VALUES ($1, $2, $3, $4, $5, $6)`, [bank.id, date, desc, cents, type, h]);
  await row('2037-02-02', 'Money Referral Bonus', 5000, 'cashback', 'd355-1');
  await row('2037-02-03', 'PAYROLL', 300000, 'deposit', 'd355-2');
  await row('2037-02-04', 'RENT', -150000, 'payment', 'd355-3');
  await row('2037-04-04', 'Money Promo Bonus', 9900, 'cashback', 'd355-4'); // after the statement: not in its year so far
  const d = await (await fetch(`${base}/accounts/${bank.id}/bank-facts?month=2037-03`)).json();
  assert.equal(d.statement.savings.apy_bps, 361);
  assert.deepEqual(d.year_to_date, { in_cents: 305000, out_cents: 150000, interest_cents: 0, bonus_cents: 5000, bonus_count: 1 });
  assert.equal((await (await fetch(`${base}/accounts/${bank.id}/bank-facts?month=2037-05`)).json()).statement, null);
});

test('credit used for a year: each open card\'s line at each month\'s end, printed limit first, the household\'s own after (D358)', { skip }, async () => {
  const { card } = await fixtures();
  const b = await one(`INSERT INTO import_batch (original_filename, stored_path, file_type, file_hash, status, account_id, parse_method)
                       VALUES ('c.pdf', 'data/c.pdf', 'PDF', 'd358-c', 'APPROVED', $1, 'local') RETURNING id`, [card.id]);
  await query(`INSERT INTO statement (import_batch_id, account_id, period_start, period_end, credit_limit_cents, closing_balance_cents)
               VALUES ($1, $2, '2038-02-06', '2038-03-05', 500000, 100000)`, [b.id, card.id]);
  const d = await (await fetch(`${base}/summary/credit?year=2038`)).json();
  const at = (m) => d.months.find((x) => x.month === m).cards.find((c) => c.id === card.id).credit_line;
  assert.equal(d.months.length, 12);
  assert.equal(at('2038-02'), null, 'before its first statement');
  assert.equal(Number(at('2038-03').credit_limit_cents), 500000);
  assert.equal(at('2038-07').as_of, '2038-03-05', 'carried until the next statement');
  assert.equal((await fetch(`${base}/summary/credit?year=20x8`)).status, 400);
});

test('how a row was paid: read from its line, set by hand, audited, and cleared back (D359)', { skip }, async () => {
  const { card } = await fixtures();
  const t = await one(`INSERT INTO transaction (account_id, posted_date, description, amount_cents, txn_type, dedupe_hash)
                       VALUES ($1, '2026-09-03', 'AplPay CORNER CAFE ANYTOWN TX', -900, 'purchase', 'd359-a') RETURNING id`, [card.id]);
  const row = async () => (await (await fetch(`${base}/transactions?account_id=${card.id}`)).json()).rows.find((r) => r.id === t.id);
  assert.deepEqual((await row()).paid_with, { key: 'apple_pay', label: 'Apple Pay', source: 'statement', read: 'apple_pay' });
  const patch = (body) => fetch(`${base}/transactions/${t.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await patch({ payment_method: 'tap' })).status, 200);
  assert.deepEqual((await row()).paid_with, { key: 'tap', label: 'Tap', source: 'you', read: 'apple_pay' });
  const log = await one(`SELECT detail FROM audit_log WHERE action = 'transaction.edited' AND entity_id = $1 ORDER BY id DESC LIMIT 1`, [t.id]);
  assert.deepEqual(log.detail.changed, ['payment_method']);
  assert.equal((await patch({ payment_method: 'contactless' })).status, 400, 'only the fixed list');
  assert.equal((await patch({ payment_method: null })).status, 200);
  assert.equal((await row()).paid_with.source, 'statement');
  assert.equal((await row()).wallet, undefined, 'one answer, not two');
});

test('a shared card\'s staged rows say whose printed section each is in (D360)', { skip }, async () => {
  const { person, card } = await fixtures();
  const other = await one(`INSERT INTO person (name) VALUES ('Jordan') RETURNING id`);
  await query(`INSERT INTO account_member (account_id, person_id, role, printed_name, card_ending) VALUES ($1, $2, 'additional', 'J LEE', '2222')`, [card.id, other.id]);
  const batch = await one(`INSERT INTO import_batch (original_filename, stored_path, file_type, file_hash, status, account_id, parse_method)
                           VALUES ('d360.pdf', 'data/d360.pdf', 'PDF', 'd360', 'REVIEW', $1, 'local') RETURNING id`, [card.id]);
  await query(`INSERT INTO staged_transaction (import_batch_id, posted_date, description, amount_cents, txn_type, spender_name, card_ending)
               VALUES ($1, '2026-09-02', 'CAFE', -500, 'purchase', 'ALEX LEE', '1111'),
                      ($1, '2026-09-03', 'BOOKS', -700, 'purchase', 'J LEE', '2222'),
                      ($1, '2026-09-04', 'PAYMENT THANK YOU', 1200, 'payment', NULL, NULL)`, [batch.id]);
  const rows = (await (await fetch(`${base}/imports/${batch.id}/staged`)).json()).rows;
  const by = (d) => rows.find((r) => r.description === d);
  assert.deepEqual([by('CAFE').person_id, by('CAFE').person_name, by('CAFE').card_ending], [person.id, 'Alex', '1111'], 'the account\'s own card is its owner\'s');
  assert.deepEqual([by('BOOKS').person_id, by('BOOKS').person_name], [other.id, 'Jordan']);
  assert.equal(by('PAYMENT THANK YOU').person_id, undefined, 'outside every section');
});

test('a statement\'s context for its notes: the statement before, and whether the address changed (D360)', { skip }, async () => {
  const { card } = await fixtures();
  const batch = (hash, end) => one(`INSERT INTO import_batch (original_filename, stored_path, file_type, file_hash, status, account_id, parse_method, period_end)
                                    VALUES ('c.pdf', 'data/c.pdf', 'PDF', $1, 'REVIEW', $2, 'local', $3) RETURNING id`, [hash, card.id, end]);
  const before = await batch('d360-c1', '2026-08-25');
  const now = await batch('d360-c2', '2026-09-25');
  await query(`INSERT INTO statement (import_batch_id, account_id, period_start, period_end, credit_limit_cents, apr_purchase_bps, mailing_address)
               VALUES ($1, $3, '2026-07-26', '2026-08-25', 800000, 2849, '1 Main St Anytown TX 75001'),
                      ($2, $3, '2026-08-26', '2026-09-25', 1000000, 2874, '9 Oak Ave  Othertown NC 27501')`, [before.id, now.id, card.id]);
  const context = (await (await fetch(`${base}/imports/${now.id}/staged`)).json()).context;
  assert.deepEqual(context.previous, { period_end: '2026-08-25', credit_limit_cents: 800000, apr_purchase_bps: 2849, total_spend_cents: null });
  assert.equal(context.credit_limit_cents, 1000000);
  assert.equal(context.address_changed, true);
  assert.equal('mailing_address' in context, false, 'the address itself isn\'t sent');
  assert.deepEqual([context.payments, context.proposed, context.plans, context.unmatched_payments, context.paid_cards], [[], [], [], [], []]);
});

test('a bank statement\'s card payments: the cards verified ones paid, and the ones not verified yet (D392)', { skip }, async () => {
  const { card, bank } = await fixtures();
  const batch = await one(`INSERT INTO import_batch (original_filename, stored_path, file_type, file_hash, status, account_id, parse_method)
                           VALUES ('b.pdf', 'data/b.pdf', 'PDF', 'd392', 'APPROVED', $1, 'local') RETURNING id`, [bank.id]);
  const saved = (date, description, cents, hash, acct = bank.id, b = batch.id) => one(
    `INSERT INTO transaction (account_id, import_batch_id, posted_date, description, amount_cents, txn_type, dedupe_hash)
     VALUES ($1, $2, $3, $4, $5, 'payment', $6) RETURNING id`, [acct, b, date, description, cents, hash]);
  const paid = await saved('2033-04-02', 'CARD AUTOPAY', -5000, 'd392-a');
  const waiting = await saved('2033-04-09', 'BARCLAYCARD PAYMENT', -2500, 'd392-b');
  const loan = await saved('2033-04-12', 'AUTO LOAN DRAFT', -30000, 'd392-d');
  const loanCat = await one(`INSERT INTO category (name) VALUES ('Loan') ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`);
  await query('UPDATE transaction SET category_id = $1 WHERE id = $2', [loanCat.id, loan.id]);
  const onCard = await saved('2033-04-03', 'PAYMENT THANK YOU', 5000, 'd392-c', card.id, null);
  await query(`INSERT INTO payment_match (card_transaction_id, bank_transaction_id, status, via) VALUES ($1, $2, 'verified', 'bank')`, [onCard.id, paid.id]);
  // The card's statement the payment went against (D394), and the one still open after it.
  const cardBatch = await one(`INSERT INTO import_batch (original_filename, stored_path, file_type, file_hash, status, account_id, parse_method)
                               VALUES ('c.pdf', 'data/c.pdf', 'PDF', 'd394-c', 'APPROVED', $1, 'local') RETURNING id`, [card.id]);
  await query(`INSERT INTO statement (import_batch_id, account_id, period_start, period_end, closing_balance_cents, minimum_payment_cents)
               VALUES ($1, $2, '2033-02-28', '2033-03-27', 5000, 2500)`, [cardBatch.id, card.id]);
  const nextBatch = await one(`INSERT INTO import_batch (original_filename, stored_path, file_type, file_hash, status, account_id, parse_method)
                               VALUES ('n.pdf', 'data/n.pdf', 'PDF', 'd394-n', 'APPROVED', $1, 'local') RETURNING id`, [card.id]);
  await query(`INSERT INTO statement (import_batch_id, account_id, period_start, period_end, closing_balance_cents)
               VALUES ($1, $2, '2033-03-28', '2033-04-27', 0)`, [nextBatch.id, card.id]);
  for (const t of [paid, waiting, loan]) {
    await query(`INSERT INTO staged_transaction (import_batch_id, posted_date, description, merchant, amount_cents, txn_type, transaction_id, review_status)
                 SELECT $1, posted_date, description, CASE WHEN id = $3 THEN 'Barclaycard' END, amount_cents, txn_type, id, 'APPROVED' FROM transaction WHERE id = $2`, [batch.id, t.id, waiting.id]);
  }
  const { rows, context } = await (await fetch(`${base}/imports/${batch.id}/staged`)).json();
  const rowOf = (tid) => rows.find((r) => r.transaction_id === tid).id;
  assert.deepEqual(context.paid_cards, [{
    row_id: rowOf(paid.id), account: { name: 'Test Card', mask: '1111' }, paid_cents: 5000,
    statement: { period_end: '2033-03-27', balance_cents: 5000, minimum_cents: 2500, paid_before_cents: 0, next_period_end: '2033-04-27' },
  }]);
  assert.deepEqual(context.unverified_card_payments, [{ row_id: rowOf(waiting.id), name: 'Barclaycard', paid_cents: 2500 }], 'a loan payment is no card\'s, so never waits to be verified');
});

test('an account\'s Member since is the earliest its statements print, shown with its statement facts (D393)', { skip }, async () => {
  const { bank } = await fixtures();
  const statement = async (hash, start, end, since) => {
    const b = await one(`INSERT INTO import_batch (original_filename, stored_path, file_type, file_hash, status, account_id, parse_method)
                         VALUES ('m.pdf', 'data/m.pdf', 'PDF', $1, 'APPROVED', $2, 'local') RETURNING id`, [hash, bank.id]);
    await query(`INSERT INTO statement (import_batch_id, account_id, period_start, period_end, member_since) VALUES ($1, $2, $3, $4, $5)`, [b.id, bank.id, start, end, since]);
  };
  const listed = async () => (await (await fetch(`${base}/accounts`)).json()).find((a) => a.id === bank.id).member_since;
  assert.equal(await listed(), null, 'nothing printed yet');
  await statement('d393-a', '2034-05-01', '2034-05-31', '2034-03-24');
  await statement('d393-b', '2034-06-01', '2034-06-30', null);
  assert.equal(await listed(), '2034-03-24');
  const facts = (await (await fetch(`${base}/accounts/${bank.id}/statement-facts?month=2034-05`)).json()).statement;
  assert.equal(facts.member_since, '2034-03-24');
});

test('Where it\'s going (D373): a month, the year so far and one person, with refunds netted per category', { skip }, async () => {
  const { person, card } = await fixtures();
  const other = await one(`INSERT INTO person (name) VALUES ('Sam') RETURNING id`);
  const cat = async (name) => one(`INSERT INTO category (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [name]);
  const food = await cat('D373 Food'), fun = await cat('D373 Fun');
  const row = (date, cents, type, category, spender, h) => query(
    `INSERT INTO transaction (account_id, posted_date, description, amount_cents, txn_type, category_id, spender_person_id, dedupe_hash)
     VALUES ($1, $2, 'D373 ROW', $3, $4, $5, $6, $7)`, [card.id, date, cents, type, category, spender, h]);
  await row('2041-03-05', -4000, 'purchase', food.id, null, 'd373-a');        // March, the card's own person
  await row('2041-09-02', -2500, 'purchase', food.id, null, 'd373-b');
  await row('2041-09-03', 500, 'refund', food.id, null, 'd373-c');            // nets against Food
  await row('2041-09-09', -1200, 'purchase', fun.id, other.id, 'd373-d');     // spent by Sam on a shared card
  await row('2041-09-10', 90000, 'payment', null, null, 'd373-e');            // not spend
  const back = await cat('D373 Returns');
  await row('2041-09-12', -300, 'purchase', back.id, null, 'd373-f');
  await row('2041-09-13', 1000, 'refund', back.id, null, 'd373-g');           // more back than spent: +700
  const get = async (qs) => (await fetch(`${base}/summary/where?${qs}`)).json();

  const month = await get('month=2041-09');
  assert.deepEqual(month.categories.map((c) => [c.name, c.spend_cents, c.count]), [['D373 Food', -2000, 2], ['D373 Fun', -1200, 1]]);
  assert.equal(month.total_cents, -3200);
  assert.deepEqual([month.refunds_over_cents, month.net_cents], [700, -2500], 'a refund-heavy category is reported, so the card adds up to Spent');
  assert.deepEqual([month.from, month.to], ['2041-09-01', '2041-10-01']);

  const ytd = await get('month=2041-09&span=ytd');
  assert.equal(ytd.categories.find((c) => c.name === 'D373 Food').spend_cents, -6000, 'March counts in the year so far');

  const alex = await get(`month=2041-09&person_id=${person.id}`);
  assert.deepEqual(alex.categories.map((c) => c.name), ['D373 Food'], 'Sam\'s spend on the shared card is Sam\'s');
  const sam = await get(`month=2041-09&person_id=${other.id}`);
  assert.deepEqual(sam.categories.map((c) => [c.name, c.spend_cents]), [['D373 Fun', -1200]]);

  const rows = (await (await fetch(`${base}/summary/where/transactions?month=2041-09&category_id=${food.id}`)).json()).transactions;
  assert.deepEqual(rows.map((r) => [r.posted_date, r.amount_cents]), [['2041-09-03', 500], ['2041-09-02', -2500]]);
  assert.equal((await fetch(`${base}/summary/where?month=2041-13`)).status, 400);
  assert.equal((await fetch(`${base}/summary/where/transactions?month=2041-09`)).status, 400, 'a category is required');
});
