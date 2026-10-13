/**
 * The re-check queue (D175): findings from recheck.js, waiting in the
 * Review tab on Transactions. Run, list, approve (optionally with a
 * different value), dismiss. Approving writes the transaction itself,
 * which is how the app learns: suggestions come from history, and the
 * approved row is now part of that history.
 */

import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { audit } from '../audit.js';
import { validate, transactionReviewApproveSchema, transactionReviewBatchSchema, transactionReviewUndoSchema, TXN_TYPE_VALUES } from '../validate.js';
import { typeOptions, buildCategoryIndex, categoryOptions } from '../review-options.js';
import { recheck, signFixes } from '../recheck.js';
import { statementTally } from '../tally.js';
import { statementHint } from '../statement-hints.js';
import { findVerification, VERIFICATION_CATEGORY } from '../verification.js';
import { loadPaymentReview, rematchAllCards } from '../payment-match-run.js';

export const transactionReviewRouter = Router();

/** The Account Verification category's id, creating it the first time it's needed. */
export async function verificationCategoryId() {
  const { rows } = await query(
    `INSERT INTO category (name) VALUES ($1) ON CONFLICT (name) DO NOTHING RETURNING id`,
    [VERIFICATION_CATEGORY]
  );
  if (rows.length > 0) {
    await audit({ action: 'category.created', entityType: 'category', entityId: rows[0].id, detail: { name: VERIFICATION_CATEGORY, by: 'verification rule' } });
    return rows[0].id;
  }
  return (await query('SELECT id FROM category WHERE name = $1', [VERIFICATION_CATEGORY])).rows[0].id;
}

/**
 * Marks account-verification micro-deposits (D177) across all saved
 * rows, which catches a pair whose pull-back landed on the next
 * statement. Only small rows are read. A row already marked is skipped,
 * so re-running changes nothing. Returns how many rows it marked.
 */
export async function markVerification() {
  const { rows } = await query(
    `SELECT t.id, t.account_id, to_char(t.posted_date, 'YYYY-MM-DD') AS posted_date, t.amount_cents, t.description,
            t.txn_type, c.name AS category_name
       FROM transaction t LEFT JOIN category c ON c.id = t.category_id
      WHERE abs(t.amount_cents) < 100 AND t.amount_cents <> 0
      ORDER BY t.posted_date, t.id`
  );
  const todo = [...findVerification(rows)]
    .map((i) => rows[i])
    .filter((t) => t.txn_type !== 'transfer' || t.category_name !== VERIFICATION_CATEGORY);
  if (todo.length === 0) return 0;

  const categoryId = await verificationCategoryId();
  await withTransaction(async (client) => {
    for (const t of todo) {
      await client.query(`UPDATE transaction SET txn_type = 'transfer', category_id = $1, updated_at = now() WHERE id = $2`, [categoryId, t.id]);
    }
  });
  for (const t of todo) {
    await audit({
      action: 'transaction.verification_marked',
      entityType: 'transaction',
      entityId: t.id,
      detail: { from: { txn_type: t.txn_type, category: t.category_name }, to: { txn_type: 'transfer', category: VERIFICATION_CATEGORY } },
    });
  }
  return todo.length;
}

/**
 * Re-checks every saved transaction. New findings are added. One already
 * asked (approved, dismissed) is never re-asked. A pending one that no
 * longer applies becomes 'obsolete'. Also run after every import approval.
 */
/**
 * Every statement with printed balances, with its rows at their current
 * amounts: an approved row's live transaction (which may have been
 * corrected since), else the staged row. Shared by the Statements list
 * and the wrong-sign check.
 */
async function statementsWithRows() {
  const { rows } = await query(
    `SELECT b.id AS batch_id, a.name AS account_name, a.account_type, s.period_end,
            s.opening_balance_cents, s.closing_balance_cents,
            COALESCE(json_agg(json_build_object('transaction_id', st.transaction_id,
                                                'amount_cents', COALESCE(t.amount_cents, st.amount_cents),
                                                'description', COALESCE(t.description, st.description),
                                                'posted_date', COALESCE(t.posted_date, st.posted_date),
                                                'txn_type', COALESCE(t.txn_type, st.txn_type),
                                                'category_name', tc.name))
                     FILTER (WHERE st.id IS NOT NULL), '[]') AS rows
       FROM import_batch b
       JOIN statement s ON s.import_batch_id = b.id
       JOIN account a ON a.id = b.account_id
       LEFT JOIN staged_transaction st ON st.import_batch_id = b.id
       LEFT JOIN transaction t ON t.id = st.transaction_id
       LEFT JOIN category tc ON tc.id = t.category_id
      WHERE s.opening_balance_cents IS NOT NULL AND s.closing_balance_cents IS NOT NULL
      GROUP BY b.id, a.name, a.account_type, s.period_end, s.opening_balance_cents, s.closing_balance_cents
      ORDER BY s.period_end DESC`
  );
  return rows.map((s) => ({
    ...s,
    tally: statementTally({ accountType: s.account_type, openingCents: s.opening_balance_cents, closingCents: s.closing_balance_cents, rows: s.rows }),
  }));
}

export async function runRecheck() {
  const { rows } = await query(
    `SELECT t.id, t.account_id, a.account_type, to_char(t.posted_date, 'YYYY-MM-DD') AS posted_date,
            t.merchant, t.description, t.amount_cents, t.txn_type, c.name AS category_name, t.zelle_type,
            -- A type finding the household already dismissed: newer type rules stay quiet (D208).
            EXISTS (SELECT 1 FROM transaction_review r WHERE r.transaction_id = t.id AND r.field = 'txn_type' AND r.status = 'dismissed') AS type_dismissed,
            -- Paid someone back for paying one of the household's cards (D200): who.
            (SELECT m.detail->>'person' FROM payment_match_part pp JOIN payment_match m ON m.id = pp.match_id
              WHERE pp.transaction_id = t.id AND m.via = 'person' LIMIT 1) AS card_payback,
            EXISTS (SELECT 1 FROM audit_log a
                     WHERE a.entity_type = 'transaction' AND a.entity_id = t.id
                       AND a.action IN ('transaction.edited', 'transaction_review.approved')) AS hand_edited
       FROM transaction t
       JOIN account a ON a.id = t.account_id
       LEFT JOIN category c ON c.id = t.category_id`
  );
  const statements = await statementsWithRows();
  const findings = [
    ...recheck(rows),
    ...signFixes(statements.filter((s) => s.tally.status === 'mismatch').map((s) => ({ diff_cents: s.tally.diff_cents, rows: s.rows }))),
  ];

  return withTransaction(async (client) => {
    let added = 0;
    for (const f of findings) {
      const r = await client.query(
        `INSERT INTO transaction_review (transaction_id, check_kind, field, current_value, suggested_value, reason)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (transaction_id, check_kind) DO UPDATE
           SET field = EXCLUDED.field, current_value = EXCLUDED.current_value, suggested_value = EXCLUDED.suggested_value, reason = EXCLUDED.reason
           WHERE transaction_review.status = 'pending'
         RETURNING (xmax = 0) AS inserted`,
        [f.transaction_id, f.check_kind, f.field, f.current_value, f.suggested_value, f.reason]
      );
      if (r.rows[0]?.inserted) added++;
    }
    const keys = findings.map((f) => `${f.transaction_id}|${f.check_kind}`);
    const { rowCount: obsolete } = await client.query(
      `UPDATE transaction_review SET status = 'obsolete', resolved_at = now()
        WHERE status = 'pending' AND NOT (transaction_id::text || '|' || check_kind = ANY($1))`,
      [keys]
    );
    const summary = { checked: rows.length, findings: findings.length, added, obsolete };
    await audit({ action: 'transaction_review.run', detail: summary });
    return summary;
  });
}

transactionReviewRouter.post('/run', async (req, res, next) => {
  try {
    const verification_marked = await markVerification();
    const recheckSummary = await runRecheck();
    const payments = (await rematchAllCards()).summary;
    res.json({ ...recheckSummary, verification_marked, payments });
  } catch (err) {
    next(err);
  }
});

transactionReviewRouter.get('/', async (req, res, next) => {
  try {
    const { rows: items } = await query(
      `SELECT r.id, r.transaction_id, r.check_kind, r.field, r.current_value, r.suggested_value, r.reason,
              t.posted_date, t.description, t.merchant, t.amount_cents, t.txn_type, t.zelle_type,
              c.name AS category_name, c.icon_key AS category_icon_key,
              ct.name AS contact_name, ct.nickname AS contact_nickname,
              a.name AS account_name, a.mask AS account_mask
         FROM transaction_review r
         JOIN transaction t ON t.id = r.transaction_id
         JOIN account a ON a.id = t.account_id
         LEFT JOIN category c ON c.id = t.category_id
         LEFT JOIN contact ct ON ct.id = t.contact_id
        WHERE r.status = 'pending'
        ORDER BY t.posted_date DESC, r.id`
    );

    // Ranked choices for each finding (D249): a likely answer is a tap, not a hunt.
    if (items.length > 0) {
      const { rows: all } = await query(
        `SELECT t.id, t.merchant, t.description, t.amount_cents, t.txn_type, t.zelle_type, a.account_type, c.name AS category_name
           FROM transaction t JOIN account a ON a.id = t.account_id LEFT JOIN category c ON c.id = t.category_id`
      );
      const byId = new Map(all.map((t) => [t.id, t]));
      const index = buildCategoryIndex(all);
      const valid = new Set((await query('SELECT name FROM category')).rows.map((c) => c.name));
      for (const item of items) {
        const t = byId.get(item.transaction_id);
        item.options = !t ? []
          : item.field === 'txn_type' ? typeOptions(t, item.suggested_value)
          : item.field === 'category' ? categoryOptions(t, index, { suggested: item.suggested_value, valid })
          : [];
      }
    }

    // Statements whose rows don't add up to their printed balances (D170),
    // each with its likeliest cause (D197).
    const signFindings = items.filter((i) => i.check_kind === 'amount_sign');
    const statements = (await statementsWithRows())
      .filter((s) => s.tally.status === 'mismatch')
      .map((s) => ({
        batch_id: s.batch_id,
        account_name: s.account_name,
        account_type: s.account_type,
        period_end: s.period_end,
        tally: s.tally,
        row_count: s.rows.length,
        hint: statementHint(s, signFindings),
      }));

    // Card payments not traced to a bank, and bank card bills no card payment matched (D199).
    const { payments, card_bills } = await loadPaymentReview();

    res.json({ items, statements, payments, card_bills });
  } catch (err) {
    next(err);
  }
});

transactionReviewRouter.get('/count', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT COUNT(*)::int AS count FROM transaction_review WHERE status = 'pending'`);
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

/**
 * Applies one approval inside a DB transaction: writes the value to the
 * transaction and marks the finding approved. Shared by one-at-a-time
 * approve and the batch (D249). Returns { item, value } or { status, error }.
 */
async function applyApproval(client, id, requested) {
  const { rows } = await client.query(`SELECT * FROM transaction_review WHERE id = $1 AND status = 'pending' FOR UPDATE`, [id]);
  if (rows.length === 0) return { status: 404, error: 'Review item not found or already resolved', id };
  const item = rows[0];
  const value = requested ?? item.suggested_value;
  if (!value) return { status: 400, error: 'Pick a value first', field: 'value', id };

  if (item.field === 'amount') {
    // Only ever the flip the finding names: the same amount, other sign.
    if (value !== item.suggested_value || Number(value) !== -Number(item.current_value)) {
      return { status: 400, error: 'An amount finding can only be approved as suggested', field: 'value', id };
    }
    await client.query('UPDATE transaction SET amount_cents = $1, updated_at = now() WHERE id = $2', [Number(value), item.transaction_id]);
  } else if (item.field === 'txn_type') {
    if (!TXN_TYPE_VALUES.includes(value)) return { status: 400, error: 'Unknown type', field: 'value', id };
    await client.query('UPDATE transaction SET txn_type = $1, updated_at = now() WHERE id = $2', [value, item.transaction_id]);
    // Money in on a card re-typed as a payment leaves Cash Deposit behind (D200).
    if (value === 'payment' && item.check_kind === 'card_deposit') {
      await client.query(
        `UPDATE transaction SET category_id = (SELECT id FROM category WHERE name = 'Card Payment')
          WHERE id = $1 AND (category_id IS NULL OR category_id = (SELECT id FROM category WHERE name = 'Cash Deposit'))`,
        [item.transaction_id]
      );
    }
    // A reward re-typed as cashback leaves the Refund category behind with it (D189).
    if (value === 'cashback') {
      await client.query(
        `UPDATE transaction SET category_id = (SELECT id FROM category WHERE name = 'Cashback')
          WHERE id = $1 AND (category_id IS NULL OR category_id = (SELECT id FROM category WHERE name = 'Refund'))`,
        [item.transaction_id]
      );
    }
  } else {
    const { rows: cat } = await client.query('SELECT id FROM category WHERE name = $1', [value]);
    if (cat.length === 0) return { status: 400, error: 'Unknown category', field: 'value', id };
    await client.query('UPDATE transaction SET category_id = $1, updated_at = now() WHERE id = $2', [cat[0].id, item.transaction_id]);
  }
  await client.query(`UPDATE transaction_review SET status = 'approved', resolved_at = now() WHERE id = $1`, [id]);
  return { item, value };
}

const auditApproval = ({ item, value }) =>
  audit({
    action: 'transaction_review.approved',
    entityType: 'transaction',
    entityId: item.transaction_id,
    detail: { field: item.field, from: item.current_value, to: value, check: item.check_kind },
  });

transactionReviewRouter.post('/:id/approve', validate(transactionReviewApproveSchema), async (req, res, next) => {
  try {
    const result = await withTransaction((client) => applyApproval(client, Number(req.params.id), req.body.value));
    if (result.error) return res.status(result.status).json({ error: result.error, field: result.field });
    await auditApproval(result);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** Thrown inside a batch to roll every change in it back. */
class BatchError extends Error {
  constructor(result) { super(result.error); this.result = result; }
}

/**
 * Many findings in one go (D249): a row's type and category together, or
 * a whole group. One DB transaction, so a batch lands completely or not
 * at all; each approval still gets its own audit entry.
 */
transactionReviewRouter.post('/batch', validate(transactionReviewBatchSchema), async (req, res, next) => {
  try {
    const { approve, dismiss } = req.body;
    const done = await withTransaction(async (client) => {
      const approved = [];
      for (const a of approve) {
        const r = await applyApproval(client, a.id, a.value);
        if (r.error) throw new BatchError(r);
        approved.push(r);
      }
      const dismissed = [];
      for (const id of dismiss) {
        const { rows } = await client.query(
          `UPDATE transaction_review SET status = 'dismissed', resolved_at = now()
            WHERE id = $1 AND status = 'pending' RETURNING id, transaction_id, check_kind`,
          [id]
        );
        if (rows.length === 0) throw new BatchError({ status: 404, error: 'Review item not found or already resolved', id });
        dismissed.push(rows[0]);
      }
      return { approved, dismissed };
    });
    for (const r of done.approved) await auditApproval(r);
    for (const d of done.dismissed) {
      await audit({ action: 'transaction_review.dismissed', entityType: 'transaction', entityId: d.transaction_id, detail: { check: d.check_kind } });
    }
    res.json({
      approved: done.approved.map((r) => ({ id: r.item.id, value: r.value })),
      dismissed: done.dismissed.map((d) => d.id),
    });
  } catch (err) {
    if (err instanceof BatchError) return res.status(err.result.status).json({ error: err.result.error, field: err.result.field, id: err.result.id });
    next(err);
  }
});

/**
 * Puts findings back (D249), so every save on Review can be undone. An
 * approved one restores the field's old value, but only if the row still
 * holds the value it was approved as: an edit made since is never
 * overwritten. Approvals that also moved the category (cashback, a card
 * deposit made a payment) aren't undone here; they're rare and two-sided.
 * A dismissed one simply goes back to pending.
 */
transactionReviewRouter.post('/undo', validate(transactionReviewUndoSchema), async (req, res, next) => {
  try {
    const undone = await withTransaction(async (client) => {
      const out = [];
      for (const { id, value } of req.body.items) {
        const { rows } = await client.query(
          `SELECT r.*, t.txn_type, t.amount_cents, c.name AS category_name
             FROM transaction_review r JOIN transaction t ON t.id = r.transaction_id LEFT JOIN category c ON c.id = t.category_id
            WHERE r.id = $1 FOR UPDATE OF r`,
          [id]
        );
        const r = rows[0];
        if (!r || !['approved', 'dismissed'].includes(r.status)) throw new BatchError({ status: 404, error: 'Nothing to undo for this one', id });
        if (r.status === 'approved') {
          const now = r.field === 'txn_type' ? r.txn_type : r.field === 'amount' ? String(r.amount_cents) : r.category_name;
          if (value == null || now !== value) {
            throw new BatchError({ status: 409, error: 'This row has changed since, so it was left as it is', id });
          }
          if ((r.field === 'txn_type' && value === 'cashback') || r.check_kind === 'card_deposit') {
            throw new BatchError({ status: 409, error: "This fix also moved the category, so it can't be undone here. Edit the row on Transactions.", id });
          }
          if (r.field === 'txn_type') {
            await client.query('UPDATE transaction SET txn_type = $1, updated_at = now() WHERE id = $2', [r.current_value, r.transaction_id]);
          } else if (r.field === 'amount') {
            await client.query('UPDATE transaction SET amount_cents = $1, updated_at = now() WHERE id = $2', [Number(r.current_value), r.transaction_id]);
          } else {
            await client.query(
              'UPDATE transaction SET category_id = (SELECT id FROM category WHERE name = $1), updated_at = now() WHERE id = $2',
              [r.current_value, r.transaction_id]
            );
          }
        }
        await client.query(`UPDATE transaction_review SET status = 'pending', resolved_at = NULL WHERE id = $1`, [id]);
        out.push(r);
      }
      return out;
    });
    for (const r of undone) {
      await audit({
        action: 'transaction_review.undone',
        entityType: 'transaction',
        entityId: r.transaction_id,
        detail: { field: r.field, was: r.status, ...(r.status === 'approved' && { from: req.body.items.find((i) => i.id === r.id)?.value, to: r.current_value }), check: r.check_kind },
      });
    }
    res.json({ undone: undone.map((r) => r.id) });
  } catch (err) {
    if (err instanceof BatchError) return res.status(err.result.status).json({ error: err.result.error, id: err.result.id });
    next(err);
  }
});

transactionReviewRouter.post('/:id/dismiss', async (req, res, next) => {
  try {
    const { rows } = await query(
      `UPDATE transaction_review SET status = 'dismissed', resolved_at = now()
        WHERE id = $1 AND status = 'pending' RETURNING transaction_id, check_kind`,
      [Number(req.params.id)]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Review item not found or already resolved' });
    await audit({ action: 'transaction_review.dismissed', entityType: 'transaction', entityId: rows[0].transaction_id, detail: { check: rows[0].check_kind } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
