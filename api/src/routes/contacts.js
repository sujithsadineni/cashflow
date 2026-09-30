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
 * everywhere else. A contact is an identity, not disposable.
 */

import { createHash } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Router } from 'express';
import multer from 'multer';
import { query } from '../db.js';
import { audit } from '../audit.js';
import { changesBetween } from '../changes.js';
import { validate, contactUpdateSchema } from '../validate.js';
import { MAX_IMAGE_BYTES, isValidImage } from '../uploads.js';

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
