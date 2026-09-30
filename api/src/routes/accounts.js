/**
 * Accounts: the cards and bank accounts you own.
 *
 * These are the first endpoints in the app that WRITE. Which means
 * they're the first that need validation, audit logging, and care
 * about what happens when two things go wrong at once.
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
import { validate, accountCreateSchema, accountUpdateSchema } from '../validate.js';
import { randomCardColor } from '../card-palette.js';
import { isKnownBank } from '../known-banks.js';
import { MAX_IMAGE_BYTES, isValidImage } from '../uploads.js';

export const accountsRouter = Router();

/** Empty strings from a form mean "not provided", not "set to ''". */
const orNull = (value) => (value === '' || value === undefined ? null : value);

const IMAGES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../data/account-images'
);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMAGE_BYTES } });

/* ------------------------------------------------------------------
   List
   ------------------------------------------------------------------ */

accountsRouter.get('/', async (req, res, next) => {
  try {
    // ?include_closed=true to see deactivated accounts too
    const includeClosed = req.query.include_closed === 'true';

    /**
     * Two things worth noting here.
     *
     * The WHERE clause is switched in JavaScript rather than passed
     * as a parameter. `WHERE ($1 = true OR ...)` looks clever but
     * makes Postgres guess the parameter's type, and the guess is
     * not always the one you want. A branch is clearer and correct.
     * This is safe because `includeClosed` is a boolean we computed,
     * never a string from the user.
     *
     * Transaction counts come from a LEFT JOIN with GROUP BY rather
     * than a correlated subquery. A subquery runs once per account
     * row; the join counts everything in a single pass.
     */
    const { rows } = await query(
      `SELECT a.id, a.name, a.issuer, a.account_type, a.mask,
              a.color, a.image_path, a.holder_name,
              a.is_active, a.created_at,
              p.id AS person_id, p.name AS person_name,
              COUNT(t.id) AS transaction_count
         FROM account a
         JOIN person p ON p.id = a.person_id
         LEFT JOIN transaction t ON t.account_id = a.id
        ${includeClosed ? '' : 'WHERE a.is_active = true'}
        GROUP BY a.id, a.name, a.issuer, a.account_type, a.mask,
                 a.color, a.image_path, a.holder_name, a.is_active, a.created_at, p.id, p.name
        ORDER BY (a.account_type = 'CREDIT_CARD'), p.id, a.name`
    );

    res.json(rows);
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------
   Statement months — which calendar months have a statement on file,
   for the Cards page's upload calendar.
   ------------------------------------------------------------------ */

accountsRouter.get('/:id/statement-months', async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    const { rows: existing } = await query('SELECT id FROM account WHERE id = $1', [id]);
    if (existing.length === 0) return res.status(404).json({ error: 'Account not found' });

    /**
     * A statement's period doesn't always sit inside one calendar
     * month (a "Mar 21 - Apr 21" cycle, for instance). We credit the
     * month the statement CLOSED in — `period_end` — since that's the
     * month issuers themselves label the statement by. Only one row
     * per account/period exists (unique constraint), so DISTINCT here
     * is just collapsing calendar-month granularity, not de-duping.
     */
    const { rows } = await query(
      `SELECT DISTINCT to_char(date_trunc('month', period_end), 'YYYY-MM') AS month
         FROM statement
        WHERE account_id = $1
        ORDER BY month`,
      [id]
    );

    res.json({ months: rows.map((r) => r.month) });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------
   Summary — year-to-date spend and top merchants, for the card's
   flip-to-back view. Deliberately the simple, root definition of
   spend (amount_cents < 0), not the dashboard's refined one (which
   excludes payments/transfers and folds in refunds) — this is a
   decorative supplementary figure on a card face, not the headline
   Spend number, so it isn't worth carrying that extra business logic
   into a second place.
   ------------------------------------------------------------------ */

accountsRouter.get('/:id/summary', async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    const { rows: existing } = await query('SELECT id FROM account WHERE id = $1', [id]);
    if (existing.length === 0) return res.status(404).json({ error: 'Account not found' });

    const { rows: totalRows } = await query(
      `SELECT COALESCE(SUM(amount_cents), 0) AS ytd_spend_cents
         FROM transaction
        WHERE account_id = $1
          AND amount_cents < 0
          AND posted_date >= date_trunc('year', CURRENT_DATE)`,
      [id]
    );

    // Grouped by the cleaned-up merchant only, never the raw statement
    // description — a handful of rows that never got a merchant match
    // would otherwise fragment into their own near-duplicate slot (a
    // real "Costco" merchant row and a leftover raw "COSTCO WHSE
    // #0187..." description both showing up separately), wasting one
    // of only 3 slots on what's visibly the same merchant. Those rows
    // still count in ytd_spend_cents above; they just don't compete
    // for a top-3 spot under an ugly, uncleaned name.
    const { rows: topMerchants } = await query(
      `SELECT merchant,
              SUM(amount_cents) AS total_cents,
              COUNT(*) AS count
         FROM transaction
        WHERE account_id = $1
          AND amount_cents < 0
          AND merchant IS NOT NULL
          AND posted_date >= date_trunc('year', CURRENT_DATE)
        GROUP BY merchant
        ORDER BY total_cents ASC
        LIMIT 3`,
      [id]
    );

    res.json({
      ytd_spend_cents: Number(totalRows[0].ytd_spend_cents),
      top_merchants: topMerchants.map((r) => ({
        merchant: r.merchant,
        total_cents: Number(r.total_cents),
        count: Number(r.count),
      })),
    });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------
   Create
   ------------------------------------------------------------------ */

accountsRouter.post('/', validate(accountCreateSchema), async (req, res, next) => {
  try {
    const { person_id, name, issuer, account_type, mask, color } = req.body;

    // Check the person exists before inserting. The foreign key would
    // catch this anyway, but a clear 400 beats a 500 with a constraint
    // name the user can't act on.
    const { rows: people } = await query('SELECT id FROM person WHERE id = $1', [person_id]);
    if (people.length === 0) {
      return res.status(400).json({ error: 'That person does not exist', field: 'person_id' });
    }

    // A checking/savings account at a bank we recognize (Bank of
    // America, Chase, SoFi) gets its color from the real brand instead
    // of the random palette — but that's a frontend concern (see
    // web/src/bankBrands.js), which only kicks in when `color` is
    // actually NULL. So the random default is skipped here rather than
    // applied and later fought with; a credit card, or an account at
    // any bank we don't recognize, keeps getting a random color same
    // as always.
    const skipRandomColor = account_type !== 'CREDIT_CARD' && isKnownBank(issuer);
    const resolvedColor = orNull(color) ?? (skipRandomColor ? null : randomCardColor());

    const { rows } = await query(
      `INSERT INTO account (person_id, name, issuer, account_type, mask, color)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, issuer, account_type, mask, color, image_path, is_active, person_id`,
      [person_id, name, orNull(issuer), account_type, orNull(mask), resolvedColor]
    );

    const account = rows[0];

    await audit({
      action: 'account.created',
      entityType: 'account',
      entityId: account.id,
      detail: { name: account.name, account_type, person_id },
    });

    // 201 Created, not 200. The status code is part of the API's
    // meaning: it tells the client a new resource now exists.
    res.status(201).json(account);
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------
   Update
   ------------------------------------------------------------------ */

accountsRouter.patch('/:id', validate(accountUpdateSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    const { rows: existing } = await query('SELECT * FROM account WHERE id = $1', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Account not found' });
    }

    /**
     * Build the SET clause from only the fields actually supplied,
     * so PATCH means "change these" rather than "replace everything".
     *
     * Note the column names come from a fixed allow-list — they can
     * never come from user input. Values are always parameterised.
     * Interpolating a user-supplied column name into SQL is how
     * injection happens even when you think you're using parameters.
     */
    const allowed = ['name', 'issuer', 'mask', 'is_active', 'color'];
    const sets = [];
    const values = [];

    for (const field of allowed) {
      if (req.body[field] !== undefined) {
        values.push(orNull(req.body[field]));
        sets.push(`${field} = $${values.length}`);
      }
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    values.push(id);

    const { rows } = await query(
      `UPDATE account SET ${sets.join(', ')}
        WHERE id = $${values.length}
        RETURNING id, name, issuer, account_type, mask, color, image_path, is_active, person_id`,
      values
    );

    await audit({
      action: 'account.updated',
      entityType: 'account',
      entityId: id,
      detail: { changed: Object.keys(req.body), changes: changesBetween(existing[0], rows[0], Object.keys(req.body)) },
    });

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------
   Deactivate
   ------------------------------------------------------------------ */

/**
 * There is no DELETE here, deliberately.
 *
 * Deleting an account would orphan or destroy its transactions, and
 * a closed card's history is still part of your spending record.
 * Deactivating hides it from the default list and keeps everything
 * intact. In a financial app, almost nothing should ever be
 * hard-deleted.
 */
accountsRouter.post('/:id/deactivate', async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    const { rows } = await query(
      `UPDATE account SET is_active = false WHERE id = $1 RETURNING id, name`,
      [id]
    );

    if (rows.length === 0) return res.status(404).json({ error: 'Account not found' });

    await audit({
      action: 'account.deactivated',
      entityType: 'account',
      entityId: id,
      detail: { name: rows[0].name },
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------
   Card image — a custom background for the card carousel tile.
   Overrides `color` when present; deleting it reverts to the color.
   ------------------------------------------------------------------ */

/**
 * Shared by the direct upload route and the "attach from a found URL"
 * route: validate, store under the account's id+hash, swap out
 * whatever image was there before, audit.
 */
async function saveAccountImage(id, buffer, ext) {
  if (!isValidImage(buffer, ext)) {
    return { ok: false, error: 'Only PNG, JPEG or WebP images are accepted' };
  }

  const { rows: existing } = await query('SELECT image_path FROM account WHERE id = $1', [id]);
  if (existing.length === 0) return { ok: false, error: 'Account not found', status: 404 };

  const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 16);
  const storedName = `${id}-${hash}${ext}`;
  const storedPath = path.join('data/account-images', storedName);

  await mkdir(IMAGES_DIR, { recursive: true });
  await writeFile(path.join(IMAGES_DIR, storedName), buffer);

  const previousPath = existing[0].image_path;
  const { rows } = await query(
    `UPDATE account SET image_path = $2 WHERE id = $1 RETURNING id, image_path`,
    [id, storedPath]
  );

  // Clean up the previous image file, if there was one, so the
  // directory doesn't accumulate every image a card ever wore.
  if (previousPath && previousPath !== storedPath) {
    await unlink(path.resolve(IMAGES_DIR, '../..', previousPath)).catch(() => {});
  }

  await audit({
    action: 'account.image_updated',
    entityType: 'account',
    entityId: id,
    detail: { size_bytes: buffer.length },
  });

  return { ok: true, account: rows[0] };
}

accountsRouter.post('/:id/image', upload.single('image'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    if (!req.file) {
      return res.status(400).json({ error: 'Attach an image file', field: 'image' });
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    const result = await saveAccountImage(id, req.file.buffer, ext);
    if (!result.ok) {
      return res.status(result.status ?? 400).json({ error: result.error, field: 'image' });
    }

    res.status(201).json(result.account);
  } catch (err) {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Image is too large (5MB max)', field: 'image' });
    }
    next(err);
  }
});

accountsRouter.delete('/:id/image', async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    const { rows: existing } = await query('SELECT id, image_path FROM account WHERE id = $1', [id]);
    if (existing.length === 0) return res.status(404).json({ error: 'Account not found' });

    await query('UPDATE account SET image_path = NULL WHERE id = $1', [id]);

    if (existing[0].image_path) {
      await unlink(path.resolve(IMAGES_DIR, '../..', existing[0].image_path)).catch(() => {});
    }

    await audit({ action: 'account.image_removed', entityType: 'account', entityId: id, detail: {} });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

