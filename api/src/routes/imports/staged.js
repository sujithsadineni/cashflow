/**
 * The staged rows of an import: list them with duplicate hints, and edit one before approval.
 * Split out of routes/imports.js (D213); mounted under /api/imports.
 */

import { Router } from 'express';

import { recoverMissingRows } from '../../recover-rows.js';

import { query } from '../../db.js';
import { validate, stagedUpdateSchema } from '../../validate.js';
import { statementTally } from '../../tally.js';

const router = Router();
export { router as stagedRouter };

/* ------------------------------------------------------------------
   Look for missing rows (D214): re-read the stored PDF with today's
   reader and queue only what the saved rows lack, for approval.
   ?dry=1 lists them without queuing. It also compares the statement's
   balances with the fresh read; ?balances=1 saves the printed ones (D215).
   ------------------------------------------------------------------ */

router.post('/:id/recover', async (req, res, next) => {
  try {
    const result = await recoverMissingRows(Number(req.params.id), { dry: req.query.dry === '1', useBalances: req.query.balances === '1' });
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------
   Review: staged rows with duplicate detection
   ------------------------------------------------------------------ */

/**
 * Description normalization for matching: lowercase, letters and
 * digits only. "FOOD LION #7777" and "Food Lion 7777" should count
 * as the same merchant.
 */
const NORMALIZE_SQL = `lower(regexp_replace(%s, '[^a-zA-Z0-9]', '', 'g'))`;

router.get('/:id/staged', async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    const { rows: batches } = await query('SELECT * FROM import_batch WHERE id = $1', [id]);
    if (batches.length === 0) return res.status(404).json({ error: 'Import not found' });

    /**
     * Refresh duplicate flags on every fetch rather than once at parse
     * time: the transaction table changes (earlier batches get
     * approved), so a flag computed last week may be stale in either
     * direction. The cost is one UPDATE over this batch's rows.
     *
     * A staged row is a suspected duplicate when an existing
     * transaction on the same account has the same amount, a matching
     * normalized description, and a posted date within 3 days.
     */
    await query(
      `UPDATE staged_transaction s
          SET duplicate_of_id = (
            SELECT t.id
              FROM transaction t
              JOIN import_batch b ON b.id = s.import_batch_id
             WHERE t.account_id = b.account_id
               AND t.amount_cents = s.amount_cents
               AND abs(t.posted_date - s.posted_date) <= 3
               AND ${NORMALIZE_SQL.replace('%s', 't.description')} =
                   ${NORMALIZE_SQL.replace('%s', 's.description')}
             ORDER BY abs(t.posted_date - s.posted_date)
             LIMIT 1
          )
        WHERE s.import_batch_id = $1
          AND s.review_status = 'PENDING'
          AND s.posted_date IS NOT NULL
          AND s.amount_cents IS NOT NULL
          AND s.description IS NOT NULL`,
      [id]
    );

    /**
     * Once approved, the live `transaction` row (via s.transaction_id,
     * migration 009) is the source of truth — merchant/type/category
     * can be edited later from the main ledger, and this screen must
     * show that, not the frozen parse-time snapshot. COALESCE falls
     * back to the staged columns for a still-pending row, where
     * transaction_id is null and there's nothing else to show yet.
     */
    const { rows } = await query(
      `SELECT s.id, s.posted_date, s.description,
              COALESCE(lt.merchant, s.merchant) AS merchant,
              COALESCE(lt.amount_cents, s.amount_cents) AS amount_cents,
              COALESCE(lt.txn_type, s.txn_type) AS txn_type,
              s.suggested_category, lt.category_id, c.name AS category_name, c.icon_key AS category_icon_key,
              s.confidence, s.review_status, s.transaction_id,
              s.duplicate_of_id, s.raw_text,
              t.posted_date AS duplicate_posted_date,
              t.description AS duplicate_description
         FROM staged_transaction s
         LEFT JOIN transaction t ON t.id = s.duplicate_of_id
         LEFT JOIN transaction lt ON lt.id = s.transaction_id
         LEFT JOIN category c ON c.id = lt.category_id
        WHERE s.import_batch_id = $1
        ORDER BY s.posted_date NULLS FIRST, s.id`,
      [id]
    );

    // Totals: the saved statement once the account is known, otherwise
    // what the parser read off the page (NEEDS_ACCOUNT batches).
    const batch = batches[0];
    const { rows: [totals] } = await query(
      `SELECT s.opening_balance_cents, s.closing_balance_cents, a.account_type
         FROM import_batch b
         LEFT JOIN statement s ON s.import_batch_id = b.id
         LEFT JOIN account a ON a.id = b.account_id
        WHERE b.id = $1`,
      [id]
    );
    const tally = statementTally({
      accountType: totals.account_type ?? batch.detected_account_type,
      openingCents: totals.opening_balance_cents ?? batch.detected_summary?.opening_balance_cents,
      closingCents: totals.closing_balance_cents ?? batch.detected_summary?.closing_balance_cents,
      rows,
    });

    res.json({ batch, rows, tally });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------
   Edit a staged row's category before approval
   ------------------------------------------------------------------ */

router.patch('/:id/staged/:sid', validate(stagedUpdateSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const sid = Number(req.params.sid);

    if (req.body.suggested_category != null) {
      const { rows } = await query('SELECT 1 FROM category WHERE name = $1', [req.body.suggested_category]);
      if (rows.length === 0) {
        return res.status(400).json({ error: 'Unknown category', field: 'suggested_category' });
      }
    }

    const allowed = ['suggested_category', 'merchant', 'txn_type'];
    const sets = [];
    const values = [id, sid];
    for (const field of allowed) {
      if (req.body[field] !== undefined) {
        values.push(req.body[field]);
        sets.push(`${field} = $${values.length}`);
      }
    }

    const { rows } = await query(
      `UPDATE staged_transaction SET ${sets.join(', ')}
        WHERE import_batch_id = $1 AND id = $2 AND review_status = 'PENDING'
        RETURNING id, suggested_category, merchant, txn_type`,
      values
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Staged row not found or already reviewed' });
    }

    // No audit entry: staging is scratch space, and the approval that
    // makes this real is audited with the final values.
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

