/**
 * Merchant icons: an editable override for the merchant avatar shown
 * across Transactions, Cards, Overview, and Merchant history.
 *
 * merchant-logos.js's domain map already covers recognizable chains,
 * but that only gets so far — a small local business has no scrapable
 * logo, and even a known chain's favicon can silently fail in a
 * browser running an ad blocker (verified while investigating a
 * report that Bank of America showed no icon: its favicon URL
 * resolves fine outside the browser). This lets the household set a
 * photo or an emoji directly, same override principle as Contacts
 * (D95) — detection/lookup proposes, a person can always fix it.
 *
 * Keyed by merchant name, not id — transaction.merchant is already a
 * clean, stable string (statement parsing's job), so there's no
 * separate entity to look up first. No delete-the-row route, same as
 * contacts: nothing here is disposable, just editable.
 */

import { createHash } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Router } from 'express';
import multer from 'multer';
import { query } from '../db.js';
import { audit } from '../audit.js';
import { validate, merchantIconEmojiSchema } from '../validate.js';
import { MAX_IMAGE_BYTES, isValidImage } from '../uploads.js';

export const merchantIconsRouter = Router();

const IMAGES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../data/merchant-icons'
);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMAGE_BYTES } });

/* ------------------------------------------------------------------
   List — customized merchants only
   ------------------------------------------------------------------ */

merchantIconsRouter.get('/', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT merchant, emoji, image_path FROM merchant_icon ORDER BY merchant');
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------
   Gap audit — every merchant that's ever appeared, most-used first.
   Domain-lookup and "has an icon already" both happen client-side
   (that's where lookupMerchantDomain already lives); this is just the
   raw list to classify against.
   ------------------------------------------------------------------ */

merchantIconsRouter.get('/all-merchants', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT merchant, COUNT(*)::int AS transaction_count
         FROM transaction
        WHERE merchant IS NOT NULL
        GROUP BY merchant
        ORDER BY transaction_count DESC, merchant`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------
   Emoji — find-or-create by merchant name, clears any custom photo
   ------------------------------------------------------------------ */

merchantIconsRouter.patch('/:merchant', validate(merchantIconEmojiSchema), async (req, res, next) => {
  try {
    const merchant = req.params.merchant;

    const { rows } = await query(
      `INSERT INTO merchant_icon (merchant, emoji, image_path, updated_at)
       VALUES ($1, $2, NULL, now())
       ON CONFLICT (merchant) DO UPDATE SET emoji = $2, image_path = NULL, updated_at = now()
       RETURNING *`,
      [merchant, req.body.emoji]
    );

    await audit({ action: 'merchant_icon.emoji_set', entityType: 'merchant_icon', entityId: rows[0].id, detail: { merchant, emoji: req.body.emoji } });

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------
   Photo — same pattern as routes/contacts.js, find-or-create, clears
   any custom emoji
   ------------------------------------------------------------------ */

merchantIconsRouter.post('/:merchant/image', upload.single('image'), async (req, res, next) => {
  try {
    const merchant = req.params.merchant;
    if (!req.file) return res.status(400).json({ error: 'Attach an image file', field: 'image' });

    const ext = path.extname(req.file.originalname).toLowerCase();
    if (!isValidImage(req.file.buffer, ext)) {
      return res.status(400).json({ error: 'Only PNG, JPEG or WebP images are accepted', field: 'image' });
    }

    const { rows: existing } = await query('SELECT id, image_path FROM merchant_icon WHERE merchant = $1', [merchant]);

    const hash = createHash('sha256').update(req.file.buffer).digest('hex').slice(0, 16);
    const storedName = `${hash}${ext}`;
    const storedPath = path.join('data/merchant-icons', storedName);

    await mkdir(IMAGES_DIR, { recursive: true });
    await writeFile(path.join(IMAGES_DIR, storedName), req.file.buffer);

    const { rows } = await query(
      `INSERT INTO merchant_icon (merchant, emoji, image_path, updated_at)
       VALUES ($1, NULL, $2, now())
       ON CONFLICT (merchant) DO UPDATE SET emoji = NULL, image_path = $2, updated_at = now()
       RETURNING *`,
      [merchant, storedPath]
    );

    const previousPath = existing[0]?.image_path;
    if (previousPath && previousPath !== storedPath) {
      await unlink(path.resolve(IMAGES_DIR, '../..', previousPath)).catch(() => {});
    }

    await audit({ action: 'merchant_icon.image_updated', entityType: 'merchant_icon', entityId: rows[0].id, detail: { merchant, size_bytes: req.file.buffer.length } });

    res.status(201).json(rows[0]);
  } catch (err) {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Image is too large (5MB max)', field: 'image' });
    }
    next(err);
  }
});

merchantIconsRouter.delete('/:merchant/image', async (req, res, next) => {
  try {
    const merchant = req.params.merchant;

    const { rows: existing } = await query('SELECT id, image_path FROM merchant_icon WHERE merchant = $1', [merchant]);
    if (existing.length === 0) return res.status(404).json({ error: 'No custom icon for this merchant' });

    await query('UPDATE merchant_icon SET image_path = NULL, updated_at = now() WHERE merchant = $1', [merchant]);

    if (existing[0].image_path) {
      await unlink(path.resolve(IMAGES_DIR, '../..', existing[0].image_path)).catch(() => {});
    }

    await audit({ action: 'merchant_icon.image_removed', entityType: 'merchant_icon', entityId: existing[0].id, detail: { merchant } });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
