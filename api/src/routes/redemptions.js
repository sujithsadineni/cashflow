/**
 * Rewards taken as gift cards (D330). A gift card leaves no line on any
 * statement, so the owner records each one: the card, the day, the brand,
 * what it's worth and what it cost in rewards. Cashback counts its value
 * on that day (money/cashback.js, summary/queries.js). Never deleted: a
 * mistake is voided, and every write is audited.
 */

import { Router } from 'express';
import { query } from '../core/db.js';
import { audit } from '../core/audit.js';
import { changesBetween } from '../core/changes.js';
import { validate, redemptionCreateSchema, redemptionUpdateSchema } from '../core/validate.js';

export const redemptionsRouter = Router();

const FIELDS = ['account_id', 'redeemed_on', 'brand', 'value_cents', 'rewards_used_cents', 'points_used', 'note'];
const COLUMNS = `r.id, r.account_id, to_char(r.redeemed_on, 'YYYY-MM-DD') AS redeemed_on, r.brand, r.value_cents,
                 r.rewards_used_cents, r.points_used, r.note, r.created_at, a.name AS account_name, a.mask AS account_mask`;
const blankToNull = (v) => (v === '' || v === undefined ? null : v);

async function cardExists(id) {
  const { rows } = await query('SELECT 1 FROM account WHERE id = $1', [id]);
  return rows.length > 0;
}
const byId = async (id) => (await query(`SELECT ${COLUMNS} FROM reward_redemption r JOIN account a ON a.id = r.account_id WHERE r.id = $1`, [id])).rows[0];

redemptionsRouter.get('/', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT ${COLUMNS} FROM reward_redemption r JOIN account a ON a.id = r.account_id
        WHERE r.voided_at IS NULL ORDER BY r.redeemed_on DESC, r.id DESC`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

redemptionsRouter.post('/', validate(redemptionCreateSchema), async (req, res, next) => {
  try {
    const b = req.body;
    if (!(await cardExists(b.account_id))) return res.status(400).json({ error: 'No such card', field: 'account_id' });
    const { rows } = await query(
      `INSERT INTO reward_redemption (account_id, redeemed_on, brand, value_cents, rewards_used_cents, points_used, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [b.account_id, b.redeemed_on, b.brand, b.value_cents, blankToNull(b.rewards_used_cents), blankToNull(b.points_used), blankToNull(b.note)]
    );
    const saved = await byId(rows[0].id);
    await audit({ action: 'reward.redeemed', entityType: 'reward_redemption', entityId: saved.id, detail: { ...b } });
    res.status(201).json(saved);
  } catch (err) {
    next(err);
  }
});

redemptionsRouter.patch('/:id', validate(redemptionUpdateSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const before = await byId(id);
    const { rows: live } = await query('SELECT voided_at FROM reward_redemption WHERE id = $1', [id]);
    if (!before) return res.status(404).json({ error: 'Gift card not found' });
    if (live[0].voided_at) return res.status(409).json({ error: 'That gift card was removed' });
    if (req.body.account_id !== undefined && !(await cardExists(req.body.account_id))) {
      return res.status(400).json({ error: 'No such card', field: 'account_id' });
    }
    // Column names from the fixed list above; values parameterised.
    const sets = [];
    const values = [];
    for (const field of FIELDS) {
      if (req.body[field] === undefined) continue;
      values.push(blankToNull(req.body[field]));
      sets.push(`${field} = $${values.length}`);
    }
    values.push(id);
    await query(`UPDATE reward_redemption SET ${sets.join(', ')} WHERE id = $${values.length}`, values);
    const after = await byId(id);
    await audit({
      action: 'reward.redemption_updated',
      entityType: 'reward_redemption',
      entityId: id,
      detail: { changed: Object.keys(req.body), changes: changesBetween(before, after, Object.keys(req.body)) },
    });
    res.json(after);
  } catch (err) {
    next(err);
  }
});

/** Remove a gift card entered by mistake: voided, not deleted, once. */
redemptionsRouter.post('/:id/void', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await query(
      'UPDATE reward_redemption SET voided_at = now() WHERE id = $1 AND voided_at IS NULL RETURNING id',
      [id]
    );
    if (rows.length === 0) {
      const exists = await byId(id);
      return res.status(exists ? 409 : 404).json({ error: exists ? 'That gift card was already removed' : 'Gift card not found' });
    }
    await audit({ action: 'reward.redemption_voided', entityType: 'reward_redemption', entityId: id, detail: { redemption: await byId(id) } });
    res.json({ id, voided: true });
  } catch (err) {
    next(err);
  }
});
