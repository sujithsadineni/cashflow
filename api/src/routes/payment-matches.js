/**
 * Where a card payment came from, set by hand (D200), for what the
 * matcher can't see: someone paid it with no Zelle back, cash at a
 * branch, an account not in the app. A manual match is never replaced
 * by a re-run; clearing it hands the payment back to the matcher.
 */

import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { audit } from '../audit.js';
import { validate, paymentSourceSchema } from '../validate.js';
import { runPaymentMatch } from '../payment-match-run.js';

export const paymentMatchesRouter = Router();

async function cardPayment(id) {
  const { rows } = await query(
    `SELECT t.id, t.account_id FROM transaction t JOIN account a ON a.id = t.account_id
      WHERE t.id = $1 AND a.account_type = 'CREDIT_CARD' AND t.amount_cents > 0`,
    [id]
  );
  return rows[0] ?? null;
}

paymentMatchesRouter.post('/:transactionId', validate(paymentSourceSchema), async (req, res, next) => {
  try {
    const t = await cardPayment(Number(req.params.transactionId));
    if (!t) return res.status(404).json({ error: 'Not a payment on a card' });
    const { via, label } = req.body;
    const detail = via === 'person' ? { person: label } : via === 'cash' ? { location: label ?? null } : { label };
    const before = await withTransaction(async (client) => {
      const { rows } = await client.query('SELECT id, via, status, source, detail FROM payment_match WHERE card_transaction_id = $1', [t.id]);
      if (rows[0]) await client.query('DELETE FROM payment_match_part WHERE match_id = $1', [rows[0].id]);
      await client.query(
        `INSERT INTO payment_match (card_transaction_id, bank_transaction_id, status, reason, via, source, detail)
         VALUES ($1, NULL, 'verified', NULL, $2, 'manual', $3)
         ON CONFLICT (card_transaction_id) DO UPDATE
           SET bank_transaction_id = NULL, status = 'verified', reason = NULL, via = EXCLUDED.via,
               source = 'manual', detail = EXCLUDED.detail, checked_at = now()`,
        [t.id, via, detail]
      );
      return rows[0] ?? null;
    });
    await audit({ action: 'payment_match.set', entityType: 'transaction', entityId: t.id, detail: { from: before && { via: before.via, status: before.status, source: before.source }, to: { via, ...detail } } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

paymentMatchesRouter.delete('/:transactionId/manual', async (req, res, next) => {
  try {
    const t = await cardPayment(Number(req.params.transactionId));
    if (!t) return res.status(404).json({ error: 'Not a payment on a card' });
    const { rows } = await query(
      `UPDATE payment_match SET source = 'auto' WHERE card_transaction_id = $1 AND source = 'manual' RETURNING via, detail`,
      [t.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Nothing was set by hand' });
    await audit({ action: 'payment_match.cleared', entityType: 'transaction', entityId: t.id, detail: { was: rows[0] } });
    await runPaymentMatch({ accountIds: [t.account_id] });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
