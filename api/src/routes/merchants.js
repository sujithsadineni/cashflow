/**
 * Renaming a merchant, and merging two (D300).
 *
 * A merchant is a name on its transactions (transaction.merchant), not a
 * row of its own; the same name keys its icon (merchant_icon), the rows
 * waiting in review (staged_transaction) and the name suggestions
 * (merchant_review). A rename changes it in all of them, in one database
 * transaction. When the new name is a merchant that already exists, it's a
 * merge: the two become one under the existing spelling, and the one being
 * merged away keeps nothing of its own except, if the other has no icon,
 * its icon. Imports learn names from history (merchant-learning.js), so
 * the next statement's lines land on the new name by themselves.
 *
 * Every change is recorded with the exact rows it touched, so Undo puts
 * back precisely those and nothing that was added since. Nothing is
 * deleted except the merged-away merchant's icon row, which the record
 * keeps whole so Undo can restore it; its photo file is never removed (a
 * photo is stored by its content, and another merchant may share it).
 */

import { Router } from 'express';
import { query, withTransaction } from '../core/db.js';
import { audit } from '../core/audit.js';
import { matchNewTransactions } from './recurring.js';
import { validate, merchantRenameSchema } from '../core/validate.js';
import { renameTarget } from '../merchants/merchant-names.js';
import { searchLogos } from '../merchants/logo-search.js';
import { logger } from '../core/logger.js';
import { planTidy } from '../merchants/merchant-tidy.js';
import { buildCanonicalMerchants } from '../review/merchant-review.js';

export const merchantsRouter = Router();

const ACTIONS = ['merchant.renamed', 'merchant.merged'];

merchantsRouter.post('/rename', validate(merchantRenameSchema), async (req, res, next) => {
  try {
    const { from } = req.body;
    const { rows: names } = await query('SELECT DISTINCT merchant FROM transaction WHERE merchant IS NOT NULL');
    const existing = names.map((r) => r.merchant);
    if (!existing.includes(from)) return res.status(404).json({ error: 'No merchant by that name', field: 'from' });
    const target = renameTarget(from, req.body.to, existing);
    if (target.error) return res.status(400).json({ error: target.error, field: 'to' });
    const { to, merge } = target;

    const result = await withTransaction(async (client) => {
      const ids = async (sql) => (await client.query(sql, [to, from])).rows.map((r) => r.id);
      const transactions = await ids('UPDATE transaction SET merchant = $1 WHERE merchant = $2 RETURNING id');
      const staged = await ids('UPDATE staged_transaction SET merchant = $1 WHERE merchant = $2 RETURNING id');
      const reviewCurrent = await ids('UPDATE merchant_review SET current_merchant = $1 WHERE current_merchant = $2 RETURNING id');
      const reviewSuggested = await ids('UPDATE merchant_review SET suggested_merchant = $1 WHERE suggested_merchant = $2 RETURNING id');

      // Its icon: carried over when the other has none; else the other's stays and this one's row goes (kept whole in the record).
      const { rows: [fromIcon] } = await client.query('SELECT * FROM merchant_icon WHERE merchant = $1', [from]);
      const { rows: [toIcon] } = await client.query('SELECT id FROM merchant_icon WHERE merchant = $1', [to]);
      let icon = null;
      if (fromIcon && !toIcon) {
        await client.query('UPDATE merchant_icon SET merchant = $1, updated_at = now() WHERE id = $2', [to, fromIcon.id]);
        icon = { moved_id: fromIcon.id };
      } else if (fromIcon && toIcon) {
        await client.query('DELETE FROM merchant_icon WHERE id = $1', [fromIcon.id]);
        icon = { removed: { merchant: fromIcon.merchant, emoji: fromIcon.emoji, domain: fromIcon.domain ?? null, image_path: fromIcon.image_path } };
      }

      const auditId = await audit({
        client,
        action: merge ? 'merchant.merged' : 'merchant.renamed',
        entityType: 'merchant',
        detail: { from, to, transaction_ids: transactions, staged_ids: staged, review_current_ids: reviewCurrent, review_suggested_ids: reviewSuggested, icon },
      });
      // Rows that now carry a bill's merchant join the bill (D368): a merge into a utility's name was missed.
      const billsLinked = await matchNewTransactions(transactions, client);
      return { audit_id: auditId, from, to, merged: merge, transactions: transactions.length, bills_linked: billsLinked };
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** Undo one rename or merge: exactly the rows it changed, still under the new name, go back. Once. */
merchantsRouter.post('/rename/:auditId/undo', async (req, res, next) => {
  try {
    const auditId = Number(req.params.auditId);
    if (!Number.isInteger(auditId) || auditId <= 0) return res.status(400).json({ error: 'Invalid change' });
    const { rows: [entry] } = await query('SELECT id, action, detail FROM audit_log WHERE id = $1', [auditId]);
    if (!entry || !ACTIONS.includes(entry.action)) return res.status(404).json({ error: 'No rename or merge to undo' });
    const { rows: done } = await query(
      `SELECT 1 FROM audit_log WHERE action = 'merchant.rename_undone' AND (detail->>'audit_id')::int = $1`, [auditId]);
    if (done.length > 0) return res.status(409).json({ error: 'Already undone' });

    const d = entry.detail;
    const result = await withTransaction(async (client) => {
      const back = async (table, column, list) => (list?.length
        ? (await client.query(`UPDATE ${table} SET ${column} = $1 WHERE id = ANY($2) AND ${column} = $3 RETURNING id`, [d.from, list, d.to])).rowCount
        : 0);
      // Fixed table and column names only: nothing from the request reaches the SQL text.
      const transactions = await back('transaction', 'merchant', d.transaction_ids);
      await back('staged_transaction', 'merchant', d.staged_ids);
      await back('merchant_review', 'current_merchant', d.review_current_ids);
      await back('merchant_review', 'suggested_merchant', d.review_suggested_ids);
      if (d.icon?.moved_id) {
        await client.query('UPDATE merchant_icon SET merchant = $1, updated_at = now() WHERE id = $2 AND merchant = $3', [d.from, d.icon.moved_id, d.to]);
      } else if (d.icon?.removed) {
        const r = d.icon.removed;
        await client.query(
          `INSERT INTO merchant_icon (merchant, emoji, domain, image_path) VALUES ($1, $2, $3, $4) ON CONFLICT (merchant) DO NOTHING`,
          [r.merchant, r.emoji, r.domain, r.image_path]);
      }
      await audit({ client, action: 'merchant.rename_undone', entityType: 'merchant', detail: { audit_id: auditId, from: d.from, to: d.to, transactions } });
      return { from: d.from, to: d.to, transactions };
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * Tidy every transaction's merchant at once (D337, the owner's request):
 * names learned from the household's own naming, unnamed lines that start
 * with a known merchant, a casing fix; the uncertain ones queue in Review.
 * ?dry=1 says what it would do (counts only). One audit entry records the
 * exact rows, so Undo puts back precisely those, once.
 */
async function tidyPlan(client) {
  const { rows } = await client.query('SELECT id, description, merchant, txn_type, amount_cents FROM transaction');
  const { rows: seen } = await client.query('SELECT transaction_id FROM merchant_review');
  return planTidy(rows, await buildCanonicalMerchants(client), new Set(seen.map((r) => r.transaction_id)));
}

merchantsRouter.post('/tidy', async (req, res, next) => {
  try {
    if (req.query.dry) {
      const p = await tidyPlan({ query });
      return res.json({ dry: true, learned: p.learned.length, fixed: p.fixed.length, flagged: p.flagged.length });
    }
    const result = await withTransaction(async (client) => {
      const p = await tidyPlan(client);
      const changed = [];
      for (const { id, to } of p.learned) {
        const r = await client.query('UPDATE transaction SET merchant = $2, updated_at = now() WHERE id = $1 AND merchant IS NULL RETURNING id', [id, to]);
        if (r.rowCount) changed.push({ id, from: null, to });
      }
      for (const { id, from, to } of p.fixed) {
        const r = await client.query('UPDATE transaction SET merchant = $3, updated_at = now() WHERE id = $1 AND merchant IS NOT DISTINCT FROM $2 RETURNING id', [id, from, to]);
        if (r.rowCount) changed.push({ id, from, to });
      }
      const queued = [];
      for (const f of p.flagged) {
        const r = await client.query(
          `INSERT INTO merchant_review (transaction_id, current_merchant, suggested_merchant, reason) VALUES ($1, $2, $3, $4)
           ON CONFLICT (transaction_id) DO NOTHING RETURNING id`, [f.id, f.current, f.suggested, f.reason]);
        if (r.rowCount) queued.push(r.rows[0].id);
      }
      const auditId = await audit({ client, action: 'merchant.tidied', entityType: 'merchant', detail: { changed, review_ids: queued } });
      const billsLinked = await matchNewTransactions(changed.map((c) => c.id), client); // D368
      return { audit_id: auditId, named: changed.filter((c) => !c.from).length, renamed: changed.filter((c) => c.from).length, queued: queued.length, bills_linked: billsLinked };
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

merchantsRouter.post('/tidy/:auditId/undo', async (req, res, next) => {
  try {
    const auditId = Number(req.params.auditId);
    const { rows: [entry] } = await query(`SELECT detail FROM audit_log WHERE id = $1 AND action = 'merchant.tidied'`, [auditId]);
    if (!entry) return res.status(404).json({ error: 'No tidy-up to undo' });
    const { rows: done } = await query(`SELECT 1 FROM audit_log WHERE action = 'merchant.tidy_undone' AND (detail->>'audit_id')::int = $1`, [auditId]);
    if (done.length) return res.status(409).json({ error: 'Already undone' });
    const result = await withTransaction(async (client) => {
      let back = 0;
      // Only rows still holding the name the tidy-up gave them: a later edit stands.
      for (const { id, from, to } of entry.detail.changed) {
        back += (await client.query('UPDATE transaction SET merchant = $2, updated_at = now() WHERE id = $1 AND merchant = $3', [id, from, to])).rowCount;
      }
      // Queued suggestions still waiting are put away, not deleted.
      const dismissed = entry.detail.review_ids.length
        ? (await client.query(`UPDATE merchant_review SET status = 'dismissed', resolved_at = now() WHERE id = ANY($1) AND status = 'pending'`, [entry.detail.review_ids])).rowCount
        : 0;
      await audit({ client, action: 'merchant.tidy_undone', entityType: 'merchant', detail: { audit_id: auditId, restored: back, dismissed } });
      return { restored: back, dismissed };
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * Search for a logo by name (D301): companies by that name with a site of
 * their own, from Clearbit's public autocomplete (merchants/logo-search.js).
 * Only on the household's Search, only the typed name; logged, not audited
 * (it changes nothing).
 */
merchantsRouter.get('/logo-search', async (req, res, next) => {
  try {
    const q = String(req.query.q ?? '').trim();
    if (!q) return res.status(400).json({ error: 'Type a name to search for', field: 'q' });
    logger.info({ length: q.length }, 'logo search');
    res.json(await searchLogos(q));
  } catch (err) {
    next(err);
  }
});
