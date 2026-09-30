/**
 * The merchant review queue — transactions the matching pass in
 * merchant-review.js found a plausible but not-confident-enough
 * merchant correction for. See that file for how a row lands here;
 * this is just list/approve/dismiss on what's already been found.
 */

import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { audit } from '../audit.js';

export const merchantReviewRouter = Router();

merchantReviewRouter.get('/', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT r.id, r.transaction_id, r.current_merchant, r.suggested_merchant, r.reason, r.created_at,
              t.posted_date, t.description, t.amount_cents,
              a.name AS account_name, a.mask AS account_mask
         FROM merchant_review r
         JOIN transaction t ON t.id = r.transaction_id
         JOIN account a ON a.id = t.account_id
        WHERE r.status = 'pending'
        ORDER BY r.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

merchantReviewRouter.get('/count', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT COUNT(*) AS count FROM merchant_review WHERE status = 'pending'`);
    res.json({ count: Number(rows[0].count) });
  } catch (err) {
    next(err);
  }
});

merchantReviewRouter.post('/:id/approve', async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    const result = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM merchant_review WHERE id = $1 AND status = 'pending'`,
        [id]
      );
      if (rows.length === 0) return null;
      const flag = rows[0];

      await client.query('UPDATE transaction SET merchant = $1, updated_at = now() WHERE id = $2', [
        flag.suggested_merchant,
        flag.transaction_id,
      ]);
      await client.query(
        `UPDATE merchant_review SET status = 'approved', resolved_at = now() WHERE id = $1`,
        [id]
      );
      return flag;
    });

    if (!result) return res.status(404).json({ error: 'Review item not found or already resolved' });

    await audit({
      action: 'merchant_review.approved',
      entityType: 'transaction',
      entityId: result.transaction_id,
      detail: { from: result.current_merchant, to: result.suggested_merchant },
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

merchantReviewRouter.post('/:id/dismiss', async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    const { rows } = await query(
      `UPDATE merchant_review SET status = 'dismissed', resolved_at = now()
        WHERE id = $1 AND status = 'pending'
        RETURNING id, transaction_id`,
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Review item not found or already resolved' });

    await audit({ action: 'merchant_review.dismissed', entityType: 'transaction', entityId: rows[0].transaction_id, detail: {} });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
