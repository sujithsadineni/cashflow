/**
 * Contacts: a real identity a transaction can point to, instead of
 * repeated free text. Every contact arrives here one of two ways —
 * the one-time backfill in db/015_contacts.sql (every name the
 * household had already typed while reviewing Zelle transactions),
 * or automatically the moment a new name is used in a future Zelle
 * review (see routes/zelle.js's find-or-create). Nothing here ever
 * creates one directly; there's no POST / route by design.
 *
 * No delete route either — same "never hard-delete" rule as
 * everywhere else. A contact is an identity, not disposable. Merging
 * (D290) is the one way one goes: its transactions move to the contact
 * it's merged into and its name stays there as an alias, so the person
 * is kept, only the duplicate spelling goes.
 */

import { createHash } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Router } from 'express';
import multer from 'multer';
import { query } from '../core/db.js';
import { audit } from '../core/audit.js';
import { changesBetween } from '../core/changes.js';
import { validate, contactUpdateSchema, contactMergeSchema, contactDistinctSchema } from '../core/validate.js';
import { similarPairs } from '../matching/contact-similar.js';

// The household's own list of leading names too common to mean anything (private, D259); none in a public clone.
let COMMON_FIRST_NAMES = [];
try {
  ({ COMMON_FIRST_NAMES } = await import('../household/common-first-names.js'));
} catch {
  // No household/ folder: a public clone.
}
import { withTransaction } from '../core/db.js';
import { MAX_IMAGE_BYTES, isValidImage } from '../core/uploads.js';

export const contactsRouter = Router();

const IMAGES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../data/contact-images'
);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMAGE_BYTES } });

/* ------------------------------------------------------------------
   List — every contact, with how many transactions point to it
   ------------------------------------------------------------------ */

contactsRouter.get('/', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT c.id, c.name, c.nickname, c.image_path,
              COUNT(t.id)::int AS transaction_count
         FROM contact c
         LEFT JOIN transaction t ON t.contact_id = c.id
        GROUP BY c.id
        ORDER BY c.name`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------
   Update — name and/or nickname
   ------------------------------------------------------------------ */

contactsRouter.patch('/:id', validate(contactUpdateSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    const { rows: existing } = await query('SELECT * FROM contact WHERE id = $1', [id]);
    if (existing.length === 0) return res.status(404).json({ error: 'Contact not found' });

    const allowed = ['name', 'nickname'];
    const sets = [];
    const values = [];
    for (const field of allowed) {
      if (req.body[field] !== undefined) {
        values.push(req.body[field] === '' ? null : req.body[field]);
        sets.push(`${field} = $${values.length}`);
      }
    }
    if (sets.length === 0) return res.status(400).json({ error: 'Nothing to update' });

    values.push(id);
    const { rows } = await query(
      `UPDATE contact SET ${sets.join(', ')}, updated_at = now() WHERE id = $${values.length} RETURNING *`,
      values
    );

    await audit({ action: 'contact.updated', entityType: 'contact', entityId: id, detail: { changed: Object.keys(req.body), changes: changesBetween(existing[0], rows[0], Object.keys(req.body)) } });

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------
   Photo — same pattern as routes/accounts.js's card image
   ------------------------------------------------------------------ */

async function saveContactImage(id, buffer, ext) {
  if (!isValidImage(buffer, ext)) {
    return { ok: false, error: 'Only PNG, JPEG or WebP images are accepted' };
  }

  const { rows: existing } = await query('SELECT image_path FROM contact WHERE id = $1', [id]);
  if (existing.length === 0) return { ok: false, error: 'Contact not found', status: 404 };

  const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 16);
  const storedName = `${id}-${hash}${ext}`;
  const storedPath = path.join('data/contact-images', storedName);

  await mkdir(IMAGES_DIR, { recursive: true });
  await writeFile(path.join(IMAGES_DIR, storedName), buffer);

  const previousPath = existing[0].image_path;
  const { rows } = await query(
    `UPDATE contact SET image_path = $2, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, storedPath]
  );

  if (previousPath && previousPath !== storedPath) {
    await unlink(path.resolve(IMAGES_DIR, '../..', previousPath)).catch(() => {});
  }

  await audit({ action: 'contact.image_updated', entityType: 'contact', entityId: id, detail: { size_bytes: buffer.length } });

  return { ok: true, contact: rows[0] };
}

contactsRouter.post('/:id/image', upload.single('image'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!req.file) return res.status(400).json({ error: 'Attach an image file', field: 'image' });

    const ext = path.extname(req.file.originalname).toLowerCase();
    const result = await saveContactImage(id, req.file.buffer, ext);
    if (!result.ok) return res.status(result.status ?? 400).json({ error: result.error, field: 'image' });

    res.status(201).json(result.contact);
  } catch (err) {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Image is too large (5MB max)', field: 'image' });
    }
    next(err);
  }
});

contactsRouter.delete('/:id/image', async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    const { rows: existing } = await query('SELECT id, image_path FROM contact WHERE id = $1', [id]);
    if (existing.length === 0) return res.status(404).json({ error: 'Contact not found' });

    await query('UPDATE contact SET image_path = NULL, updated_at = now() WHERE id = $1', [id]);

    if (existing[0].image_path) {
      await unlink(path.resolve(IMAGES_DIR, '../..', existing[0].image_path)).catch(() => {});
    }

    await audit({ action: 'contact.image_removed', entityType: 'contact', entityId: id, detail: {} });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------
   Possible duplicates and merging (D290)
   ------------------------------------------------------------------ */

/** Pairs that may be one person, strongest first, each with what the household needs to decide. */
contactsRouter.get('/similar', async (req, res, next) => {
  try {
    const [{ rows: contacts }, { rows: distinct }, { rows: people }] = await Promise.all([
      query(`SELECT c.id, c.name, c.nickname, c.image_path, c.aliases,
                    COUNT(t.id)::int AS transaction_count,
                    COALESCE(SUM(t.amount_cents) FILTER (WHERE t.amount_cents > 0), 0)::bigint AS in_cents,
                    COALESCE(SUM(t.amount_cents) FILTER (WHERE t.amount_cents < 0), 0)::bigint AS out_cents,
                    to_char(MIN(t.posted_date), 'YYYY-MM-DD') AS first_date,
                    to_char(MAX(t.posted_date), 'YYYY-MM-DD') AS last_date
               FROM contact c LEFT JOIN transaction t ON t.contact_id = c.id
              GROUP BY c.id`),
      query('SELECT low_id, high_id FROM contact_distinct'),
      query('SELECT name FROM person'),
    ]);
    const pairs = similarPairs(contacts, distinct.map((d) => [d.low_id, d.high_id]), people.map((p) => p.name), COMMON_FIRST_NAMES);
    res.json(pairs.map(({ a, b, why }) => ({ why, a: { ...a, in_cents: Number(a.in_cents), out_cents: Number(a.out_cents) }, b: { ...b, in_cents: Number(b.in_cents), out_cents: Number(b.out_cents) } })));
  } catch (err) {
    next(err);
  }
});

/**
 * Merge :id into `into`: its transactions move (contact and the name on
 * the row), its name and aliases become aliases of `into`, a photo or
 * nickname `into` lacks comes along, and :id goes.
 */
contactsRouter.post('/:id/merge', validate(contactMergeSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const into = req.body.into;
    if (id === into) return res.status(400).json({ error: 'Pick two different contacts' });
    const result = await withTransaction(async (client) => {
      const { rows: both } = await client.query('SELECT * FROM contact WHERE id = ANY($1) FOR UPDATE', [[id, into]]);
      const from = both.find((c) => c.id === id);
      const to = both.find((c) => c.id === into);
      if (!from || !to) return null;
      const moved = await client.query('UPDATE transaction SET contact_id = $2, zelle_person = $3, updated_at = now() WHERE contact_id = $1', [id, into, to.name]);
      const aliases = [...new Set([...to.aliases, from.name.toLowerCase(), ...from.aliases])].filter((a) => a !== to.name.toLowerCase());
      const { rows: [merged] } = await client.query(
        `UPDATE contact SET aliases = $2, image_path = COALESCE(image_path, $3), nickname = COALESCE(nickname, $4), updated_at = now()
          WHERE id = $1 RETURNING *`,
        [into, aliases, from.image_path, from.nickname]
      );
      await client.query('DELETE FROM contact WHERE id = $1', [id]);
      return { from, merged, moved: moved.rowCount };
    });
    if (!result) return res.status(404).json({ error: 'Contact not found' });
    await audit({ action: 'contact.merged', entityType: 'contact', entityId: into,
      detail: { from: { id, name: result.from.name }, into: { id: into, name: result.merged.name }, transactions_moved: result.moved } });
    res.json({ contact: result.merged, transactions_moved: result.moved });
  } catch (err) {
    next(err);
  }
});

/** "Different people": the pair is never suggested again. */
contactsRouter.post('/distinct', validate(contactDistinctSchema), async (req, res, next) => {
  try {
    const [low, high] = [Math.min(req.body.a, req.body.b), Math.max(req.body.a, req.body.b)];
    const { rowCount } = await query('INSERT INTO contact_distinct (low_id, high_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [low, high]);
    await audit({ action: 'contact.marked_distinct', entityType: 'contact', entityId: low, detail: { other: high } });
    res.json({ ok: true, added: rowCount });
  } catch (err) {
    if (err.code === '23503') return res.status(404).json({ error: 'Contact not found' });
    next(err);
  }
});
