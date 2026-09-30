/**
 * Reference data: things that rarely change and that the frontend
 * loads once to populate dropdowns. Categories are user-manageable —
 * add your own (Costco, Refund, …) and delete unused ones.
 */

import { Router } from 'express';
import { query } from '../db.js';
import { audit } from '../audit.js';
import { validate, categoryCreateSchema, categoryIconSchema, personUpdateSchema, personAvatarSchema } from '../validate.js';
import { changesBetween } from '../changes.js';

export const referenceRouter = Router();

referenceRouter.get('/people', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT id, name, avatar FROM person ORDER BY id');
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

/**
 * Adding a person — the bootstrap path now that there's no signup
 * flow to create the first one. Same shared household ledger either
 * way: a new person is just another name to attribute accounts and
 * transactions to, not an account with its own view of the data.
 */
referenceRouter.post('/people', validate(personUpdateSchema), async (req, res, next) => {
  try {
    const { name } = req.body;
    const { rows } = await query('INSERT INTO person (name) VALUES ($1) RETURNING id, name', [name]);

    await audit({ action: 'person.created', entityType: 'person', entityId: rows[0].id, detail: { name } });

    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

/**
 * Renaming a person — e.g. a short name to a full legal name for
 * account-holder matching, or just a household preference. There was
 * no way to do this at all before; a raw SQL edit would have skipped
 * the audit trail every other write in this app gets.
 */
referenceRouter.patch('/people/:id', validate(personUpdateSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { name } = req.body;

    const { rows } = await query(
      'UPDATE person SET name = $1 WHERE id = $2 RETURNING id, name',
      [name, id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Person not found' });

    await audit({ action: 'person.renamed', entityType: 'person', entityId: id, detail: { name } });

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

/** Pick (or clear) a person's avatar — Settings → People (D144). */
referenceRouter.patch('/people/:id/avatar', validate(personAvatarSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows: before } = await query('SELECT avatar FROM person WHERE id = $1', [id]);
    if (before.length === 0) return res.status(404).json({ error: 'Person not found' });

    const { rows } = await query('UPDATE person SET avatar = $1 WHERE id = $2 RETURNING id, name, avatar', [
      req.body.avatar,
      id,
    ]);

    await audit({
      action: 'person.avatar_set',
      entityType: 'person',
      entityId: id,
      detail: { changes: changesBetween(before[0], rows[0], ['avatar']) },
    });

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

referenceRouter.get('/categories', async (req, res, next) => {
  try {
    // Usage counts ride along so the UI can show which categories are
    // safe to delete and which carry history.
    const { rows } = await query(
      `SELECT c.id, c.name, c.icon_key, COUNT(t.id) AS transaction_count
         FROM category c
         LEFT JOIN transaction t ON t.category_id = c.id
        GROUP BY c.id, c.name, c.icon_key
        ORDER BY c.sort_order, c.name`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

/**
 * Setting a category's icon — the picker in Settings writes here.
 * `icon_key` is validated against a fixed allow-list (see
 * validate.js), so there's nothing to sanitize before it lands in
 * the column.
 */
referenceRouter.patch('/categories/:id/icon', validate(categoryIconSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { icon_key } = req.body;

    const { rows } = await query(
      'UPDATE category SET icon_key = $1 WHERE id = $2 RETURNING id, name, icon_key',
      [icon_key, id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Category not found' });

    await audit({ action: 'category.icon_set', entityType: 'category', entityId: id, detail: { icon_key } });

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

referenceRouter.post('/categories', validate(categoryCreateSchema), async (req, res, next) => {
  try {
    const { name } = req.body;

    const { rows: existing } = await query(
      'SELECT id FROM category WHERE lower(name) = lower($1)',
      [name]
    );
    if (existing.length > 0) {
      return res.status(409).json({ error: 'That category already exists', field: 'name' });
    }

    const { rows } = await query(
      'INSERT INTO category (name) VALUES ($1) RETURNING id, name',
      [name]
    );

    await audit({
      action: 'category.created',
      entityType: 'category',
      entityId: rows[0].id,
      detail: { name },
    });

    res.status(201).json({ ...rows[0], transaction_count: 0 });
  } catch (err) {
    next(err);
  }
});

/**
 * Deleting reference data is allowed only when nothing points at it.
 * A category attached to real transactions carries history — deleting
 * it would silently uncategorize spending, so the API refuses and the
 * UI tells you to recategorize first.
 */
referenceRouter.delete('/categories/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    const { rows: used } = await query(
      'SELECT COUNT(*) AS n FROM transaction WHERE category_id = $1',
      [id]
    );
    const count = Number(used[0].n);
    if (count > 0) {
      return res.status(409).json({
        error: `This category is on ${count} transaction${count === 1 ? '' : 's'} — recategorize them first`,
      });
    }

    const { rows } = await query('DELETE FROM category WHERE id = $1 RETURNING id, name', [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Category not found' });

    await audit({
      action: 'category.deleted',
      entityType: 'category',
      entityId: id,
      detail: { name: rows[0].name },
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
