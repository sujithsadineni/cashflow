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
import { loadCardDates } from '../statements/card-dates-run.js';

import { Router } from 'express';
import multer from 'multer';
import { query } from '../core/db.js';
import { audit } from '../core/audit.js';
import { changesBetween } from '../core/changes.js';
import { validate, accountCreateSchema, accountUpdateSchema, accountBalanceSchema } from '../core/validate.js';
import { randomCardColor } from '../money/card-palette.js';
import { isKnownBank } from '../merchants/known-banks.js';
import { cardProductFor } from '../../../web/src/lib/cards/card-products.js';
import { MAX_IMAGE_BYTES, isValidImage } from '../core/uploads.js';
import { spendSql } from '../money/spend.js';
import { cardHistory } from '../statements/card-history.js';
import { readFile } from 'node:fs/promises';
import { isLocked, findSavedPassword } from '../statements/pdf-passwords.js';
import { REPO_ROOT } from './imports/shared.js';

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
      `SELECT a.id, a.name, a.nickname, a.issuer, a.account_type, a.mask, a.credit_limit_manual_cents,
              a.color, a.image_path, a.holder_name, a.closing_day, a.due_day, a.cashback_rate_bps,
              a.is_active, a.created_at,
              p.id AS person_id, p.name AS person_name,
              -- The opening date its statements print, the earliest one (D393).
              (SELECT to_char(MIN(s.member_since), 'YYYY-MM-DD') FROM statement s WHERE s.account_id = a.id) AS member_since,
              COUNT(t.id) AS transaction_count,
              to_char(MAX(t.posted_date), 'YYYY-MM-DD') AS last_posted,
              mb.balance_cents AS manual_balance_cents, to_char(mb.as_of, 'YYYY-MM-DD') AS manual_balance_as_of,
              -- The balance to show (D297): the newer of a hand-entered one and the latest statement's, as Savings uses.
              CASE WHEN sb.as_of IS NOT NULL AND (mb.as_of IS NULL OR sb.as_of > mb.as_of) THEN sb.balance_cents ELSE mb.balance_cents END AS balance_cents,
              to_char(CASE WHEN sb.as_of IS NOT NULL AND (mb.as_of IS NULL OR sb.as_of > mb.as_of) THEN sb.as_of ELSE mb.as_of END, 'YYYY-MM-DD') AS balance_as_of
         FROM account a
         JOIN person p ON p.id = a.person_id
         LEFT JOIN transaction t ON t.account_id = a.id
         LEFT JOIN LATERAL (
           SELECT balance_cents, as_of FROM account_balance WHERE account_id = a.id ORDER BY as_of DESC LIMIT 1
         ) mb ON true
         LEFT JOIN LATERAL (
           SELECT s.closing_balance_cents AS balance_cents, s.period_end AS as_of
             FROM statement s JOIN import_batch b ON b.id = s.import_batch_id
            WHERE b.account_id = a.id AND s.closing_balance_cents IS NOT NULL
            ORDER BY s.period_end DESC LIMIT 1
         ) sb ON true
        ${includeClosed ? '' : 'WHERE a.is_active = true'}
        GROUP BY a.id, a.name, a.nickname, a.issuer, a.account_type, a.mask, a.credit_limit_manual_cents,
                 a.color, a.image_path, a.holder_name, a.closing_day, a.due_day, a.is_active, a.created_at, p.id, p.name,
                 mb.balance_cents, mb.as_of, sb.balance_cents, sb.as_of
        ORDER BY (a.account_type = 'CREDIT_CARD'), p.id, a.name`
    );

    // A card's dates (D270): what its statements suggest, and where its newest bill stands.
    const dates = await loadCardDates();
    // Its cards over time (D275): reissues and upgrades, read off its statements.
    const { rows: printed } = await query(
      `SELECT account_id, to_char(period_end, 'YYYY-MM-DD') AS period_end, card_mask, product_name
         FROM statement WHERE card_mask IS NOT NULL`
    );
    const cards = (id) => cardHistory(printed.filter((s) => s.account_id === id));
    // A card's credit line as of its newest statement that prints one (D346): the limit, what was
    // available and what was owed on that same statement, so utilisation compares like with like.
    const { rows: lines } = await query(
      `SELECT DISTINCT ON (s.account_id) s.account_id, s.credit_limit_cents, s.available_credit_cents,
              s.closing_balance_cents, to_char(s.period_end, 'YYYY-MM-DD') AS as_of
         FROM statement s WHERE s.credit_limit_cents IS NOT NULL
        ORDER BY s.account_id, s.period_end DESC`
    );
    const creditLine = new Map(lines.map(({ account_id, ...l }) => [account_id, l]));
    // A limit the household set (D354), for a card whose statements print none: against what its
    // newest statement owed, marked as theirs.
    const { rows: newest } = await query(
      `SELECT DISTINCT ON (account_id) account_id, closing_balance_cents, to_char(period_end, 'YYYY-MM-DD') AS as_of
         FROM statement ORDER BY account_id, period_end DESC`);
    const newestOf = new Map(newest.map((n) => [n.account_id, n]));
    const lineOf = (a) => creditLine.get(a.id)
      ?? (a.credit_limit_manual_cents != null && a.account_type === 'CREDIT_CARD'
        ? { credit_limit_cents: a.credit_limit_manual_cents, available_credit_cents: null,
            closing_balance_cents: newestOf.get(a.id)?.closing_balance_cents ?? 0, as_of: newestOf.get(a.id)?.as_of ?? null, source: 'manual' }
        : null);
    // Who else is on a shared card (D344), for its "Shared" badge: active members other than the owner.
    const { rows: members } = await query(
      `SELECT m.account_id, m.person_id, p.name AS person_name, m.role, m.card_ending
         FROM account_member m JOIN account a ON a.id = m.account_id JOIN person p ON p.id = m.person_id
        WHERE m.is_active AND m.person_id <> a.person_id ORDER BY m.id`
    );
    res.json(rows.map((a) => ({
      ...a,
      ...(dates.has(a.id) ? { date_suggestion: dates.get(a.id).suggestion, payment_due: dates.get(a.id).due } : {}),
      card_history: cards(a.id),
      members: members.filter((m) => m.account_id === a.id).map(({ account_id: _a, ...m }) => m),
      credit_line: lineOf(a),
    })));
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------
   A card's statement facts for one month (D347): what the back of the
   card on the Cards page shows. The statement that closed in that month,
   as the Cards calendar marks months; the newest without a month.
   ------------------------------------------------------------------ */

accountsRouter.get('/:id/statement-facts', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const month = req.query.month ?? null;
    if (month !== null && !/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'Use month=YYYY-MM', field: 'month' });
    const { rows: existing } = await query('SELECT id FROM account WHERE id = $1', [id]);
    if (existing.length === 0) return res.status(404).json({ error: 'Account not found' });
    const { rows: [statement] } = await query(
      `SELECT s.id, to_char(s.period_start, 'YYYY-MM-DD') AS period_start, to_char(s.period_end, 'YYYY-MM-DD') AS period_end,
              s.opening_balance_cents, s.closing_balance_cents, s.credit_limit_cents, s.available_credit_cents,
              s.cash_advance_limit_cents, s.ytd_year, s.ytd_fees_cents, s.ytd_interest_cents,
              to_char(s.payment_due_date, 'YYYY-MM-DD') AS payment_due_date, s.minimum_payment_cents, s.cashback_earned_cents,
              s.apr_purchase_bps, s.apr_balance_transfer_bps, s.apr_cash_advance_bps, s.apr_penalty_bps, s.apr_variable,
              s.cashback_balance_cents, s.rewards, s.plans, to_char(s.member_since, 'YYYY-MM-DD') AS member_since
         FROM statement s
        WHERE s.account_id = $1 AND ($2::text IS NULL OR to_char(s.period_end, 'YYYY-MM') = $2)
        ORDER BY s.period_end DESC LIMIT 1`,
      [id, month]
    );
    // No limit saved (D347): say whether the statement doesn't print one or was never opened
    // (a locked PDF no saved password opens), and give the last limit printed before it, dated.
    let limitNote = null;
    let lastLimit = null;
    let manualLimit = null;
    if (statement && statement.credit_limit_cents == null) {
      limitNote = 'not_printed';
      const { rows: [file] } = await query(
        `SELECT b.stored_path FROM statement s JOIN import_batch b ON b.id = s.import_batch_id WHERE s.id = $1 AND b.file_type = 'PDF'`, [statement.id]);
      try {
        const buf = file?.stored_path ? await readFile(path.resolve(REPO_ROOT, file.stored_path)) : null;
        if (buf && (await isLocked(buf)) && (await findSavedPassword(buf, { count: false })) === null) limitNote = 'locked';
      } catch { /* a missing file reads as not printed */ }
      const { rows: [last] } = await query(
        `SELECT credit_limit_cents, to_char(period_end, 'YYYY-MM-DD') AS as_of FROM statement
          WHERE account_id = $1 AND credit_limit_cents IS NOT NULL AND period_end < $2 ORDER BY period_end DESC LIMIT 1`,
        [id, statement.period_end]);
      lastLimit = last ?? null;
      // The limit the household set (D354), when no statement before printed one either.
      if (!lastLimit) {
        const { rows: [own] } = await query('SELECT credit_limit_manual_cents FROM account WHERE id = $1', [id]);
        manualLimit = own?.credit_limit_manual_cents ?? null;
      }
    }
    res.json({ month, statement: statement ?? null, limit_note: limitNote, last_limit: lastLimit, manual_limit_cents: manualLimit });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------
   A bank account's month (D355): the back of its card on the Cards
   page. Its balance on the statement that closed in that month (or the
   newest), what that statement says the money earned, and the year so
   far from its rows: money in and out, interest, and bonuses.
   ------------------------------------------------------------------ */

const BONUS_SQL = `t.amount_cents > 0 AND t.txn_type <> 'interest' AND t.description ~* '\\m(bonus|promo|promotion|referral)\\M'`;

accountsRouter.get('/:id/bank-facts', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const month = req.query.month ?? null;
    if (month !== null && !/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'Use month=YYYY-MM', field: 'month' });
    const { rows: [account] } = await query('SELECT id, account_type FROM account WHERE id = $1', [id]);
    if (!account) return res.status(404).json({ error: 'Account not found' });
    const { rows: [statement] } = await query(
      `SELECT s.id, to_char(s.period_start, 'YYYY-MM-DD') AS period_start, to_char(s.period_end, 'YYYY-MM-DD') AS period_end,
              s.opening_balance_cents, s.closing_balance_cents, s.savings
         FROM statement s
        WHERE s.account_id = $1 AND ($2::text IS NULL OR to_char(s.period_end, 'YYYY-MM') = $2)
        ORDER BY s.period_end DESC LIMIT 1`,
      [id, month]
    );
    // The year so far, up to that statement's end (or today without one).
    const end = statement?.period_end ?? new Date().toISOString().slice(0, 10);
    const { rows: [year] } = await query(
      `SELECT COALESCE(SUM(t.amount_cents) FILTER (WHERE t.amount_cents > 0), 0)::bigint AS in_cents,
              COALESCE(-SUM(t.amount_cents) FILTER (WHERE t.amount_cents < 0), 0)::bigint AS out_cents,
              COALESCE(SUM(t.amount_cents) FILTER (WHERE t.txn_type = 'interest' AND t.amount_cents > 0), 0)::bigint AS interest_cents,
              COALESCE(SUM(t.amount_cents) FILTER (WHERE ${BONUS_SQL}), 0)::bigint AS bonus_cents,
              COUNT(*) FILTER (WHERE ${BONUS_SQL})::int AS bonus_count
         FROM transaction t
        WHERE t.account_id = $1 AND t.posted_date >= date_trunc('year', $2::date) AND t.posted_date <= $2::date`,
      [id, end]
    );
    res.json({
      month, statement: statement ?? null, year: Number(end.slice(0, 4)),
      year_to_date: Object.fromEntries(Object.entries(year).map(([k, v]) => [k, Number(v)])),
    });
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
   flip-to-back view. The same spending rule as the Overview
   (spend.js). It once used the bare "amount_cents < 0", which counted
   card payments, transfers and reversed rent as spending — up to 4x a
   card's real spend (D168).
   ------------------------------------------------------------------ */

accountsRouter.get('/:id/summary', async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    const { rows: existing } = await query('SELECT id FROM account WHERE id = $1', [id]);
    if (existing.length === 0) return res.status(404).json({ error: 'Account not found' });

    const { rows: totalRows } = await query(
      `SELECT COALESCE(LEAST(SUM(amount_cents), 0), 0) AS ytd_spend_cents
         FROM transaction
        WHERE account_id = $1
          AND ${spendSql('')}
          AND posted_date >= date_trunc('year', CURRENT_DATE)`,
      [id]
    );

    // Grouped by the cleaned-up merchant only, never the raw statement
    // description — a handful of rows that never got a merchant match
    // would otherwise fragment into their own near-duplicate slot (a
    // real "Costco" merchant row and a leftover raw "COSTCO WHSE
    // #0101..." description both showing up separately), wasting one
    // of only 3 slots on what's visibly the same merchant. Those rows
    // still count in ytd_spend_cents above; they just don't compete
    // for a top-3 spot under an ugly, uncleaned name.
    const { rows: topMerchants } = await query(
      `SELECT merchant,
              SUM(amount_cents) AS total_cents,
              COUNT(*) AS count
         FROM transaction
        WHERE account_id = $1
          AND ${spendSql('')}
          AND merchant IS NOT NULL
          AND posted_date >= date_trunc('year', CURRENT_DATE)
        GROUP BY merchant
        HAVING SUM(amount_cents) < 0
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
    // web/src/lib/cards/bankBrands.js), which only kicks in when `color` is
    // actually NULL. So the random default is skipped here rather than
    // applied and later fought with; a credit card, or an account at
    // any bank we don't recognize, keeps getting a random color same
    // as always.
    // A known card product draws its own face (D403), so it gets no random colour either.
    const skipRandomColor = (account_type !== 'CREDIT_CARD' && isKnownBank(issuer))
      || Boolean(cardProductFor({ account_type, issuer, name }));
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
    // An owner has to be someone in the household: a clear 400, not a foreign-key 500.
    if (req.body.person_id !== undefined) {
      const { rows: person } = await query('SELECT 1 FROM person WHERE id = $1', [req.body.person_id]);
      if (person.length === 0) return res.status(400).json({ error: 'No such person', field: 'person_id' });
    }

    const allowed = ['name', 'issuer', 'mask', 'is_active', 'color', 'person_id', 'account_type', 'holder_name', 'closing_day', 'due_day', 'cashback_rate_bps', 'nickname', 'credit_limit_manual_cents'];
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
        RETURNING id, name, issuer, account_type, mask, color, image_path, is_active, person_id, holder_name, closing_day, due_day, cashback_rate_bps, nickname, credit_limit_manual_cents`,
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


/**
 * Record a hand-entered balance (D180), for a savings or investment
 * account the app never gets a statement for. The same date again
 * corrects that entry. A newer date becomes the latest.
 */
accountsRouter.post('/:id/balances', validate(accountBalanceSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { as_of, balance_cents } = req.body;
    const { rows: acct } = await query('SELECT id FROM account WHERE id = $1', [id]);
    if (acct.length === 0) return res.status(404).json({ error: 'Account not found' });
    const { rows } = await query(
      `INSERT INTO account_balance (account_id, as_of, balance_cents) VALUES ($1, $2, $3)
       ON CONFLICT (account_id, as_of) DO UPDATE SET balance_cents = EXCLUDED.balance_cents
       RETURNING id, to_char(as_of, 'YYYY-MM-DD') AS as_of, balance_cents`,
      [id, as_of, balance_cents]
    );
    await audit({ action: 'account.balance_recorded', entityType: 'account', entityId: id, detail: { as_of, balance_cents } });
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});
