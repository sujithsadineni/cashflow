/**
 * Zelle review: every Zelle transaction looks identical to the parser
 * whether it's a transfer between the household's own accounts or a
 * real payment to someone else — only a human can tell. Reviewing a
 * row assigns a display name and a type, and the type sets the real
 * accounting effect by writing `txn_type` directly (see
 * db/014_zelle_review.sql for the mapping and why summary.js needs no
 * changes at all for that part).
 *
 * The name itself resolves to a real `contact` (db/015_contacts.sql),
 * found by case-insensitive match or created on the spot — this is
 * the "a new name discovered from a Zelle transaction joins the
 * contact list automatically" behavior. Renaming or photographing
 * that contact later (routes/contacts.js) never touches this row
 * again; every display reads the contact live through `contact_id`.
 */

import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { audit } from '../audit.js';
import { validate, zelleReviewSchema } from '../validate.js';
import { suggestZelleName, suggestInternal } from '../zelle.js';

export const zelleRouter = Router();

const TXN_TYPE_BY_ZELLE_TYPE = { INTERNAL: 'transfer', SENT: 'purchase', RECEIVED: 'deposit' };

/**
 * Shared by the manual PATCH below and the automatic call import
 * approval makes (routes/imports.js) — one place that resolves a name
 * to a real contact and writes the real accounting effect, so both
 * paths stay identical by construction instead of by care.
 */
export async function applyZelleReview(client, { id, zelle_type, zelle_person }) {
  // Matching case-insensitively means "nina" and "Nina" land on the
  // same contact even typed differently on different reviews — real
  // spelling differences ("Casey" vs "Casey Diaz") still
  // create separate contacts, same as they're separate strings today
  // (see D95 in DECISIONS.md).
  const { rows: matched } = await client.query('SELECT id FROM contact WHERE LOWER(name) = LOWER($1)', [zelle_person]);
  const contactId = matched.length > 0
    ? matched[0].id
    : (await client.query('INSERT INTO contact (name) VALUES ($1) RETURNING id', [zelle_person])).rows[0].id;

  const { rows } = await client.query(
    `UPDATE transaction
        SET zelle_type = $2, zelle_person = $3, contact_id = $4, txn_type = $5, updated_at = now()
      WHERE id = $1
      RETURNING id, posted_date::text, description, amount_cents, account_id, zelle_type, zelle_person, contact_id`,
    [id, zelle_type, zelle_person, contactId, TXN_TYPE_BY_ZELLE_TYPE[zelle_type]]
  );
  return rows[0];
}

/* ------------------------------------------------------------------
   List — every Zelle-shaped transaction, reviewed or not
   ------------------------------------------------------------------ */

zelleRouter.get('/', async (req, res, next) => {
  try {
    const [{ rows: transactions }, { rows: people }] = await Promise.all([
      query(
        `SELECT t.id, t.posted_date::text, t.description, t.amount_cents, t.account_id, t.zelle_type, t.zelle_person,
                t.contact_id, c.name AS contact_name, c.nickname AS contact_nickname, c.image_path AS contact_image_path
           FROM transaction t
           LEFT JOIN contact c ON c.id = t.contact_id
          WHERE t.description ILIKE '%zelle%'
          ORDER BY t.posted_date DESC, t.id DESC`
      ),
      query('SELECT name FROM person'),
    ]);

    res.json(
      transactions.map((t) => ({
        ...t,
        suggested_person: suggestZelleName(t.description),
        suggested_internal: suggestInternal(suggestZelleName(t.description), people),
      }))
    );
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------
   Review one row — always allowed to re-review/correct, never a
   one-way door.
   ------------------------------------------------------------------ */

zelleRouter.patch('/:id', validate(zelleReviewSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { zelle_type, zelle_person } = req.body;

    const { rows: existing } = await query(`SELECT id FROM transaction WHERE id = $1 AND description ILIKE '%zelle%'`, [id]);
    if (existing.length === 0) return res.status(404).json({ error: 'Zelle transaction not found' });

    const result = await withTransaction(async (client) => {
      const updated = await applyZelleReview(client, { id, zelle_type, zelle_person });
      const { rows: contact } = await client.query('SELECT name, nickname, image_path FROM contact WHERE id = $1', [updated.contact_id]);
      return { ...updated, contact_name: contact[0].name, contact_nickname: contact[0].nickname, contact_image_path: contact[0].image_path };
    });

    await audit({
      action: 'zelle.reviewed',
      entityType: 'transaction',
      entityId: id,
      detail: { zelle_type, zelle_person, txn_type: TXN_TYPE_BY_ZELLE_TYPE[zelle_type], contact_id: result.contact_id },
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});
