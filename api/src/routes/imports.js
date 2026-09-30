/**
 * Statement uploads.
 *
 * POST /api/imports takes a multipart form with a `statement` file and
 * an `account_id` field, saves the original file, and creates an
 * import_batch row with status UPLOADED. Parsing happens in a later
 * step — this endpoint's only job is to get the file safely on disk
 * and on record.
 *
 * The SHA-256 of the file contents is the dedupe key. It's UNIQUE in
 * the database, so the same statement can't be imported twice even if
 * the filename changed.
 */

import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, unlink, rename, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Router } from 'express';
import multer from 'multer';

import { query, withTransaction } from '../db.js';
import { audit } from '../audit.js';
import {
  validate,
  importCreateSchema,
  stagedUpdateSchema,
  approveSchema,
  accountConfirmSchema,
} from '../validate.js';
import { parseStatementCsv } from '../parse/csv.js';
import { extractStatementFromPdf } from '../parse/pdf.js';
import { extractStatementFromPdfLocally } from '../parse/pdf-local.js';
import { enrichRows } from '../parse/categorize.js';
import { biltRentRuleFor } from '../parse/bilt-rent.js';
import { zelleCategoryFor } from '../parse/zelle-category.js';
import { robinhoodCategoryFor } from '../parse/robinhood-category.js';
import { autoZelleReview } from '../zelle.js';
import { applyZelleReview } from './zelle.js';
import { suggestHistoricalCategories } from '../historical-category.js';
import { randomCardColor } from '../card-palette.js';
import { isKnownBank } from '../known-banks.js';
import { matchNewTransactions } from './recurring.js';
import { flagOrFixMerchants } from '../merchant-review.js';

export const importsRouter = Router();

// Resolved from this module's location, not process.cwd(), so it works
// no matter which directory the server was started from.
const STATEMENTS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../data/statements'
);

const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20MB — generous for any statement

// Kept in sync by hand with web/src/components/Imports.jsx's own copy —
// small enough that a shared module isn't worth it.
const slugify = (s) =>
  (s ?? '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * The folder a statement's file lives under: card/account name plus
 * its last 4, e.g. "chase-freedom-2468" — so `data/statements/` reads
 * as a real filing cabinet instead of ~100 opaque hashes in one flat
 * directory. Falls back to the slug alone for an account with no mask
 * on file (a bank account before its number is known, in practice
 * never seen but handled).
 */
export function accountFolderSlug(name, mask) {
  const base = slugify(name) || 'account';
  return mask ? `${base}-${mask}` : base;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * "2026-08-11" -> { year: "2026", fileName: "08 - August 2026.pdf" }.
 * The zero-padded month number is what actually sorts the folder in
 * calendar order — "August" alone would sort before "January"
 * alphabetically, which reads as broken in a folder meant to be
 * browsed month by month.
 */
export function statementFileName(periodEnd, ext) {
  const [year, month] = periodEnd.split('-');
  const monthName = MONTH_NAMES[Number(month) - 1];
  return { year, fileName: `${month} - ${monthName} ${year}${ext}` };
}

export async function pathExists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Appends " (2)", " (3)", ... if something's already at this path —
 * guards against two different statements (never seen, but not
 * impossible) landing on the same account+month+year name and one
 * silently overwriting the other on disk.
 */
export async function uniquePath(destAbs) {
  if (!(await pathExists(destAbs))) return destAbs;
  const ext = path.extname(destAbs);
  const base = destAbs.slice(0, -ext.length);
  let n = 2;
  let candidate = `${base} (${n})${ext}`;
  while (await pathExists(candidate)) {
    n++;
    candidate = `${base} (${n})${ext}`;
  }
  return candidate;
}

/**
 * Files are buffered in memory rather than streamed to a temp file.
 * Statements are small (tens of KB, a few MB at worst) and we need the
 * whole buffer to hash it before deciding whether to keep it at all.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES },
});

/**
 * multer throws its own error types outside our route handler, so this
 * wrapper translates them into the 400s our API speaks everywhere else.
 */
function uploadStatement(req, res, next) {
  upload.single('statement')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File is too large (20MB max)', field: 'statement' });
      }
      return res.status(400).json({ error: err.message, field: 'statement' });
    }
    next(err);
  });
}

/**
 * The extension decides PDF vs CSV. The client-sent MIME type is not
 * trustworthy (browsers disagree, and it's user-controlled anyway), so
 * we check the one thing we can: a file claiming to be a PDF must
 * start with the %PDF magic bytes.
 */
function detectFileType(originalName, buffer) {
  const ext = path.extname(originalName).toLowerCase();

  if (ext === '.pdf') {
    if (!buffer.subarray(0, 4).equals(Buffer.from('%PDF'))) {
      return { error: 'This file has a .pdf extension but is not a valid PDF' };
    }
    return { fileType: 'PDF', ext: '.pdf' };
  }

  if (ext === '.csv') {
    return { fileType: 'CSV', ext: '.csv' };
  }

  return { error: 'Only PDF and CSV statements are accepted' };
}

importsRouter.post('/', uploadStatement, validate(importCreateSchema), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Attach a statement file', field: 'statement' });
    }

    // account_id is an optional override — normally the parser
    // identifies the account and the human confirms it in review.
    const account_id = req.body.account_id ?? null;
    const parse_method = req.body.parse_method;
    const { originalname, buffer, size } = req.file;

    const detected = detectFileType(originalname, buffer);
    if (detected.error) {
      return res.status(400).json({ error: detected.error, field: 'statement' });
    }

    let account = null;
    if (account_id !== null) {
      const { rows: accounts } = await query('SELECT id, name, mask FROM account WHERE id = $1', [account_id]);
      if (accounts.length === 0) {
        return res.status(400).json({ error: 'That account does not exist', field: 'account_id' });
      }
      account = accounts[0];
    }

    const fileHash = createHash('sha256').update(buffer).digest('hex');

    // Check for a duplicate before inserting, so the caller gets a
    // useful 409 naming the earlier import instead of a raw unique-
    // constraint error. The constraint stays as the backstop.
    const { rows: existing } = await query(
      `SELECT id, original_filename, status, uploaded_at
         FROM import_batch WHERE file_hash = $1`,
      [fileHash]
    );
    if (existing.length > 0) {
      return res.status(409).json({
        error: 'This exact file was already imported',
        existing_batch: existing[0],
      });
    }

    // Stored under its hash, not its original name. That makes the
    // filename collision-proof, ties the file on disk to the dedupe
    // key, and means user-supplied names never touch the filesystem.
    // Filed under the account's own folder when the account is already
    // known at upload time; otherwise it lands flat at the top of
    // data/statements/ and moves into a folder once account confirmation
    // (below) says which one — there's no card to file it under yet.
    const storedName = `${fileHash}${detected.ext}`;
    const folder = account ? accountFolderSlug(account.name, account.mask) : null;
    const storedPath = folder
      ? path.join('data/statements', folder, storedName)
      : path.join('data/statements', storedName);
    const destAbs = path.join(STATEMENTS_DIR, folder ?? '', storedName);

    await mkdir(path.dirname(destAbs), { recursive: true });
    await writeFile(destAbs, buffer);

    let batch;
    try {
      const { rows } = await query(
        `INSERT INTO import_batch (account_id, original_filename, stored_path, file_type, file_hash, parse_method)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, account_id, original_filename, file_type, status, uploaded_at, parse_method`,
        [account_id, originalname, storedPath, detected.fileType, fileHash, parse_method]
      );
      batch = rows[0];
    } catch (err) {
      // 23505 = unique violation: someone uploaded the same file in the
      // window between our SELECT and this INSERT.
      if (err.code === '23505') {
        return res.status(409).json({ error: 'This exact file was already imported' });
      }
      throw err;
    }

    await audit({
      action: 'import.uploaded',
      entityType: 'import_batch',
      entityId: batch.id,
      detail: {
        original_filename: originalname,
        file_type: detected.fileType,
        size_bytes: size,
        account_id,
      },
    });

    res.status(201).json(batch);
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------
   Parse — turn the stored file into staged_transaction rows.

   CSV only for now; PDF parsing is a later step. Rows go to staging,
   never straight to transaction: parsing is ~95% accurate and the
   human review pass is the design decision the whole app hangs on.
   ------------------------------------------------------------------ */

// stored_path is relative to the repo root ('data/statements/...'),
// and STATEMENTS_DIR points at data/statements, so the repo root is
// one level up from it.
const REPO_ROOT = path.resolve(STATEMENTS_DIR, '../..');

importsRouter.post('/:id/parse', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    // Optional — only a password-protected PDF needs it (an encrypted
    // CSV isn't a thing this app parses). Never stored: used once for
    // this parse attempt and then it's gone with the request.
    const password = typeof req.body?.password === 'string' && req.body.password.trim() !== ''
      ? req.body.password
      : undefined;

    const { rows: batches } = await query('SELECT * FROM import_batch WHERE id = $1', [id]);
    if (batches.length === 0) return res.status(404).json({ error: 'Import not found' });
    const batch = batches[0];

    // Parsing twice would double the staged rows, so only a batch that
    // hasn't produced any yet may be parsed. FAILED is retryable.
    if (batch.status !== 'UPLOADED' && batch.status !== 'FAILED') {
      return res.status(409).json({ error: `This import is already ${batch.status.toLowerCase()}` });
    }

    await query(`UPDATE import_batch SET status = 'PARSING', error_message = NULL WHERE id = $1`, [id]);

    let fileContents;
    try {
      fileContents = await readFile(path.resolve(REPO_ROOT, batch.stored_path));
    } catch {
      await query(
        `UPDATE import_batch SET status = 'FAILED', error_message = $2 WHERE id = $1`,
        [id, 'Stored file is missing from disk']
      );
      return res.status(500).json({ error: 'Stored file is missing from disk' });
    }

    const { rows: categoryRows } = await query('SELECT name FROM category ORDER BY sort_order, name');
    const categoryNames = categoryRows.map((c) => c.name);

    let parsed;
    try {
      if (batch.file_type === 'CSV') {
        parsed = parseStatementCsv(fileContents.toString('utf8'));
        // CSVs carry no account header, but their rows still get the
        // type/merchant/category pass. Enrichment failing is fine —
        // the rows just arrive plain.
        if (parsed.ok) {
          const enriched = await enrichRows(parsed.rows, categoryNames);
          if (enriched) {
            parsed.rows = parsed.rows.map((row, index) => ({ ...row, ...enriched.get(index) }));
          }
        }
      } else if (batch.parse_method === 'local') {
        parsed = await extractStatementFromPdfLocally(fileContents, categoryNames, password);
      } else {
        parsed = await extractStatementFromPdf(fileContents, categoryNames, password);
      }
    } catch (err) {
      // An unexpected throw must not strand the batch in PARSING —
      // that state blocks every retry. It also must not reach
      // Express's own error handler: that responds with the generic
      // {"error": "internal server error"} (index.js), which is what
      // the household saw here instead of anything actionable — a
      // real bug, not just a rough message. This is a normal,
      // expected failure mode (a locked PDF, a corrupt file), the
      // same shape as the `!parsed.ok` case just below, so it gets
      // the same treatment: record it, respond with it, stop.
      //
      // PasswordException covers both "none given" and "wrong one" —
      // pdfjs-dist doesn't distinguish them in the exception itself,
      // so this message covers both without guessing which.
      const message = err.name === 'PasswordException'
        ? password
          ? 'That password didn’t open the PDF. Check it and try again.'
          : 'This PDF is password-protected. Enter the password and try again.'
        : `Unexpected parse error: ${err.message}`;
      await query(
        `UPDATE import_batch SET status = 'FAILED', error_message = $2 WHERE id = $1`,
        [id, message]
      );
      await audit({
        action: 'import.parse_failed',
        entityType: 'import_batch',
        entityId: id,
        detail: { error: message },
      });
      return res.status(422).json({ error: message });
    }

    if (!parsed.ok) {
      await query(
        `UPDATE import_batch SET status = 'FAILED', error_message = $2 WHERE id = $1`,
        [id, parsed.error]
      );
      await audit({
        action: 'import.parse_failed',
        entityType: 'import_batch',
        entityId: id,
        detail: { error: parsed.error },
      });
      return res.status(422).json({ error: parsed.error });
    }

    // A known, unambiguous pattern (Bilt's rent-via-card mechanic)
    // beats whatever the AI enrichment above guessed — see
    // parse/bilt-rent.js for why the AI kept splitting these
    // inconsistently between "Rent" and "Card Payment", and getting
    // the txn_type wrong too (which silently broke every spend total).
    for (const row of parsed.rows) {
      const rule = biltRentRuleFor(row.description);
      if (rule) {
        row.suggested_category = rule.category;
        row.txn_type = rule.txn_type;
      }
    }

    // Same idea, for Zelle: a transfer mechanism, not a spending
    // category to guess at from what it happened to be "for." Category
    // only — txn_type (deposit/purchase/transfer) already correctly
    // reflects the direction of money and stays untouched.
    for (const row of parsed.rows) {
      const zelleCategory = zelleCategoryFor(row.description);
      if (zelleCategory) row.suggested_category = zelleCategory;
    }

    // Same idea again, for Robinhood: "Debits"/"Securities" (real
    // trading activity) becomes Investment; "Money ... Payment" (a
    // different, larger, periodic transfer) is left alone — see
    // parse/robinhood-category.js for why the two patterns need to
    // stay segregated rather than one rule collapsing both into
    // "Robinhood = Investment".
    for (const row of parsed.rows) {
      const rule = robinhoodCategoryFor(row.description);
      if (rule) {
        row.suggested_category = rule.category;
        row.txn_type = rule.txn_type;
      }
    }

    // Whatever's still uncategorized (routine for the local parser,
    // which deliberately never guesses a category from a merchant name
    // alone — see parse/pdf-local-bofa.js) gets one more pass: the
    // household's own past transactions already answer "what category
    // does a Costco purchase get" or "what does this exact recurring
    // description mean" far more reliably than a fresh guess would.
    // Only ever fills a blank, never overrides a category the AI or
    // the Bilt rule already set.
    const stillBlank = parsed.rows.filter((r) => !r.suggested_category);
    if (stillBlank.length > 0) {
      // Passing only the blank rows, not all of parsed.rows, keeps
      // this from ever touching a category the Bilt rule or the
      // parser's own logic already set — stillBlank holds the SAME
      // row objects as parsed.rows (a filter, not a copy), so setting
      // a property on one mutates the other; there's no index
      // translation back to parsed.rows that could point at the
      // wrong row.
      const historical = await suggestHistoricalCategories(stillBlank, { query });
      for (const [index, category] of historical) {
        stillBlank[index].suggested_category = category;
      }
    }

    /**
     * Match the detected account against what already exists — by
     * last-4 first (strongest signal), then by exact name. This is
     * only ever a SUGGESTION: attaching a statement to the wrong
     * account silently would be the worst failure this feature has,
     * so a human confirms it in review no matter how good the match.
     */
    const detectedAccount = parsed.account ?? null;
    let suggestedAccountId = null;

    if (batch.account_id == null && detectedAccount) {
      if (detectedAccount.mask) {
        const { rows: byMask } = await query(
          'SELECT id, issuer, name FROM account WHERE mask = $1',
          [detectedAccount.mask]
        );
        if (byMask.length === 1) {
          suggestedAccountId = byMask[0].id;
        } else if (byMask.length > 1 && detectedAccount.issuer) {
          // Same last-4 at two banks — the issuer breaks the tie.
          const tied = byMask.filter(
            (a) => a.issuer && a.issuer.toLowerCase() === detectedAccount.issuer.toLowerCase()
          );
          if (tied.length === 1) suggestedAccountId = tied[0].id;
        }
      }
      if (suggestedAccountId === null && detectedAccount.name) {
        const { rows: byName } = await query(
          'SELECT id FROM account WHERE lower(name) = lower($1)',
          [detectedAccount.name]
        );
        if (byName.length === 1) suggestedAccountId = byName[0].id;
      }
    }

    const nextStatus = batch.account_id != null ? 'REVIEW' : 'NEEDS_ACCOUNT';
    const summary = parsed.statement ?? null;

    // Inserting the rows, the detection results and the status flip
    // commit together or not at all — a batch marked REVIEW with half
    // its rows missing would be worse than one that plainly failed.
    await withTransaction(async (client) => {
      for (const row of parsed.rows) {
        await client.query(
          `INSERT INTO staged_transaction
             (import_batch_id, posted_date, description, merchant, amount_cents,
              txn_type, suggested_category, confidence, raw_text)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            id,
            row.posted_date,
            row.description,
            row.merchant ?? null,
            row.amount_cents,
            row.txn_type ?? null,
            row.suggested_category ?? null,
            row.confidence,
            row.raw_text,
          ]
        );
      }

      // The statement summary can only be written once the account is
      // known; until then it waits on the batch as detected_summary.
      if (summary?.period_start && summary?.period_end && batch.account_id != null) {
        await upsertStatement(client, batch.account_id, id, summary);
      }

      await client.query(
        `UPDATE import_batch
            SET status = $2, rows_parsed = $3,
                period_start = COALESCE($4, period_start),
                period_end = COALESCE($5, period_end),
                detected_account_name = $6,
                detected_issuer = $7,
                detected_mask = $8,
                detected_account_type = $9,
                detected_holder = $10,
                detected_summary = $11,
                suggested_account_id = $12
          WHERE id = $1`,
        [
          id,
          nextStatus,
          parsed.rows.length,
          summary?.period_start ?? null,
          summary?.period_end ?? null,
          detectedAccount?.name ?? null,
          detectedAccount?.issuer ?? null,
          detectedAccount?.mask ?? null,
          detectedAccount?.account_type ?? null,
          detectedAccount?.holder_name ?? null,
          summary ? JSON.stringify(summary) : null,
          suggestedAccountId,
        ]
      );
    });

    // Only the minority case — account_id already set at upload time —
    // needs this here. The far more common NEEDS_ACCOUNT case has no
    // account yet to file under; it gets the same treatment later, from
    // account confirmation, once there is one.
    if (batch.account_id != null && summary?.period_end) {
      const { rows: acctRows } = await query('SELECT name, mask FROM account WHERE id = $1', [batch.account_id]);
      if (acctRows.length > 0) {
        await relocateStatementFile(batch, batch.account_id, acctRows[0].name, acctRows[0].mask, summary.period_end).catch(() => {});
      }
    }

    const lowConfidence = parsed.rows.filter((r) => r.confidence === 'LOW').length;

    await audit({
      action: 'import.parsed',
      entityType: 'import_batch',
      entityId: id,
      detail: {
        rows_parsed: parsed.rows.length,
        low_confidence: lowConfidence,
        detected_account: detectedAccount?.name ?? null,
        suggested_account_id: suggestedAccountId,
        // Stage 5 reporting, PDF only: what got sent to the model and
        // what got filtered out locally, so it's visible in the audit
        // trail too, not just the immediate response.
        ...(parsed.report ? { extraction_report: parsed.report } : {}),
      },
    });

    res.json({
      id,
      status: nextStatus,
      rows_parsed: parsed.rows.length,
      low_confidence: lowConfidence,
      ...(parsed.report ? { report: parsed.report } : {}),
    });
  } catch (err) {
    next(err);
  }
});

/** Shared by parse (account already known) and account confirmation. */
async function upsertStatement(client, accountId, batchId, summary) {
  await client.query(
    `INSERT INTO statement
       (account_id, import_batch_id, period_start, period_end,
        opening_balance_cents, closing_balance_cents,
        total_spend_cents, total_payments_cents,
        cashback_earned_cents, cashback_balance_cents)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (account_id, period_start, period_end)
     DO UPDATE SET import_batch_id = EXCLUDED.import_batch_id,
                   opening_balance_cents = EXCLUDED.opening_balance_cents,
                   closing_balance_cents = EXCLUDED.closing_balance_cents,
                   total_spend_cents = EXCLUDED.total_spend_cents,
                   total_payments_cents = EXCLUDED.total_payments_cents,
                   cashback_earned_cents = EXCLUDED.cashback_earned_cents,
                   cashback_balance_cents = EXCLUDED.cashback_balance_cents`,
    [
      accountId,
      batchId,
      summary.period_start,
      summary.period_end,
      summary.opening_balance_cents ?? null,
      summary.closing_balance_cents ?? null,
      summary.total_spend_cents ?? null,
      summary.total_payments_cents ?? null,
      summary.cashback_earned_cents ?? null,
      summary.cashback_balance_cents ?? null,
    ]
  );
}

/**
 * Moves a statement's file into its account's folder once the account
 * is known, and — once the period is also known — renames it out of
 * its hash and into "MM - Month YYYY" inside a year subfolder
 * (data/statements/<account>/<year>/<file>). The two pieces of
 * information (account, period) usually arrive at different times, so
 * this runs from two call sites: right after parsing, for an upload
 * that already had its account_id set at upload time; and right after
 * account confirmation, for the far more common NEEDS_ACCOUNT path,
 * where the period's been known since parsing but the account wasn't.
 * A no-op if the file's already exactly where this would put it.
 */
async function relocateStatementFile(batch, accountId, accountName, accountMask, periodEnd) {
  const folder = accountFolderSlug(accountName, accountMask);
  const oldRelPath = batch.stored_path;
  const ext = path.extname(oldRelPath);

  let newRelPath;
  if (periodEnd) {
    const { year, fileName } = statementFileName(periodEnd, ext);
    newRelPath = path.join('data/statements', folder, year, fileName);
  } else {
    newRelPath = path.join('data/statements', folder, path.basename(oldRelPath));
  }
  if (newRelPath === oldRelPath) return;

  const oldAbs = path.resolve(REPO_ROOT, oldRelPath);
  const newAbs = await uniquePath(path.resolve(REPO_ROOT, newRelPath));
  await mkdir(path.dirname(newAbs), { recursive: true });
  await rename(oldAbs, newAbs);
  const finalRelPath = path.relative(REPO_ROOT, newAbs);
  await query('UPDATE import_batch SET stored_path = $2 WHERE id = $1', [batch.id, finalRelPath]);
}

/* ------------------------------------------------------------------
   Account confirmation — the human step between "the parser thinks
   this is account X" and it being so.
   ------------------------------------------------------------------ */

importsRouter.post('/:id/account', validate(accountConfirmSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { account_id, create } = req.body;

    const { rows: batches } = await query('SELECT * FROM import_batch WHERE id = $1', [id]);
    if (batches.length === 0) return res.status(404).json({ error: 'Import not found' });
    const batch = batches[0];

    if (batch.status !== 'NEEDS_ACCOUNT' && batch.status !== 'REVIEW') {
      return res.status(409).json({ error: `This import is ${batch.status.toLowerCase()} — the account can't be changed here` });
    }

    let accountId = account_id ?? null;
    let accountName, accountMask;

    if (create) {
      const { rows: people } = await query('SELECT id FROM person WHERE id = $1', [create.person_id]);
      if (people.length === 0) {
        return res.status(400).json({ error: 'That person does not exist', field: 'person_id' });
      }
      const detectedIssuer = create.issuer === '' || create.issuer === undefined ? null : create.issuer;
      // Same rule as the Settings create path (routes/accounts.js): a
      // checking/savings account at a bank we recognize gets its color
      // from the real brand (frontend, see bankBrands.js) rather than
      // the random palette, so `color` is left NULL here instead.
      const skipRandomColor = create.account_type !== 'CREDIT_CARD' && isKnownBank(detectedIssuer);

      const { rows } = await query(
        `INSERT INTO account (person_id, name, issuer, account_type, mask, holder_name, color)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, name, mask`,
        [
          create.person_id,
          create.name,
          detectedIssuer,
          create.account_type,
          create.mask === '' || create.mask === undefined ? null : create.mask,
          // The name as printed on the statement — extracted data, not
          // something the human types in the create form.
          batch.detected_holder ?? null,
          skipRandomColor ? null : randomCardColor(),
        ]
      );
      accountId = rows[0].id;
      accountName = rows[0].name;
      accountMask = rows[0].mask;
      await audit({
        action: 'account.created',
        entityType: 'account',
        entityId: accountId,
        detail: { name: rows[0].name, source: 'statement_detection', import_batch_id: id },
      });
    } else {
      const { rows } = await query('SELECT id, name, mask FROM account WHERE id = $1', [accountId]);
      if (rows.length === 0) {
        return res.status(400).json({ error: 'That account does not exist', field: 'account_id' });
      }
      accountName = rows[0].name;
      accountMask = rows[0].mask;
    }

    await withTransaction(async (client) => {
      await client.query(
        `UPDATE import_batch SET account_id = $2, status = 'REVIEW' WHERE id = $1`,
        [id, accountId]
      );
      const summary = batch.detected_summary;
      if (summary?.period_start && summary?.period_end) {
        await upsertStatement(client, accountId, id, summary);
      }
    });

    // Best-effort: the batch is already confirmed at this point, so a
    // filesystem hiccup here shouldn't fail the request — it would just
    // leave this one file flat (or un-renamed) until the next successful
    // move. period_end is already on `batch` — parsing (which is what
    // got this batch to NEEDS_ACCOUNT/REVIEW in the first place) set it.
    await relocateStatementFile(batch, accountId, accountName, accountMask, batch.period_end).catch(() => {});

    await audit({
      action: 'import.account_confirmed',
      entityType: 'import_batch',
      entityId: id,
      detail: { account_id: accountId, created: Boolean(create) },
    });

    res.json({ id, status: 'REVIEW', account_id: accountId });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------
   Review: staged rows with duplicate detection
   ------------------------------------------------------------------ */

/**
 * Description normalization for matching: lowercase, letters and
 * digits only. "FOOD LION #2196" and "Food Lion 2196" should count
 * as the same merchant.
 */
const NORMALIZE_SQL = `lower(regexp_replace(%s, '[^a-zA-Z0-9]', '', 'g'))`;

importsRouter.get('/:id/staged', async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    const { rows: batches } = await query('SELECT * FROM import_batch WHERE id = $1', [id]);
    if (batches.length === 0) return res.status(404).json({ error: 'Import not found' });

    /**
     * Refresh duplicate flags on every fetch rather than once at parse
     * time: the transaction table changes (earlier batches get
     * approved), so a flag computed last week may be stale in either
     * direction. The cost is one UPDATE over this batch's rows.
     *
     * A staged row is a suspected duplicate when an existing
     * transaction on the same account has the same amount, a matching
     * normalized description, and a posted date within 3 days.
     */
    await query(
      `UPDATE staged_transaction s
          SET duplicate_of_id = (
            SELECT t.id
              FROM transaction t
              JOIN import_batch b ON b.id = s.import_batch_id
             WHERE t.account_id = b.account_id
               AND t.amount_cents = s.amount_cents
               AND abs(t.posted_date - s.posted_date) <= 3
               AND ${NORMALIZE_SQL.replace('%s', 't.description')} =
                   ${NORMALIZE_SQL.replace('%s', 's.description')}
             ORDER BY abs(t.posted_date - s.posted_date)
             LIMIT 1
          )
        WHERE s.import_batch_id = $1
          AND s.review_status = 'PENDING'
          AND s.posted_date IS NOT NULL
          AND s.amount_cents IS NOT NULL
          AND s.description IS NOT NULL`,
      [id]
    );

    /**
     * Once approved, the live `transaction` row (via s.transaction_id,
     * migration 009) is the source of truth — merchant/type/category
     * can be edited later from the main ledger, and this screen must
     * show that, not the frozen parse-time snapshot. COALESCE falls
     * back to the staged columns for a still-pending row, where
     * transaction_id is null and there's nothing else to show yet.
     */
    const { rows } = await query(
      `SELECT s.id, s.posted_date, s.description,
              COALESCE(lt.merchant, s.merchant) AS merchant,
              s.amount_cents,
              COALESCE(lt.txn_type, s.txn_type) AS txn_type,
              s.suggested_category, lt.category_id, c.name AS category_name, c.icon_key AS category_icon_key,
              s.confidence, s.review_status, s.transaction_id,
              s.duplicate_of_id, s.raw_text,
              t.posted_date AS duplicate_posted_date,
              t.description AS duplicate_description
         FROM staged_transaction s
         LEFT JOIN transaction t ON t.id = s.duplicate_of_id
         LEFT JOIN transaction lt ON lt.id = s.transaction_id
         LEFT JOIN category c ON c.id = lt.category_id
        WHERE s.import_batch_id = $1
        ORDER BY s.posted_date NULLS FIRST, s.id`,
      [id]
    );

    res.json({ batch: batches[0], rows });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------
   Edit a staged row's category before approval
   ------------------------------------------------------------------ */

importsRouter.patch('/:id/staged/:sid', validate(stagedUpdateSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const sid = Number(req.params.sid);

    if (req.body.suggested_category != null) {
      const { rows } = await query('SELECT 1 FROM category WHERE name = $1', [req.body.suggested_category]);
      if (rows.length === 0) {
        return res.status(400).json({ error: 'Unknown category', field: 'suggested_category' });
      }
    }

    const allowed = ['suggested_category', 'merchant', 'txn_type'];
    const sets = [];
    const values = [id, sid];
    for (const field of allowed) {
      if (req.body[field] !== undefined) {
        values.push(req.body[field]);
        sets.push(`${field} = $${values.length}`);
      }
    }

    const { rows } = await query(
      `UPDATE staged_transaction SET ${sets.join(', ')}
        WHERE import_batch_id = $1 AND id = $2 AND review_status = 'PENDING'
        RETURNING id, suggested_category, merchant, txn_type`,
      values
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Staged row not found or already reviewed' });
    }

    // No audit entry: staging is scratch space, and the approval that
    // makes this real is audited with the final values.
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------
   Approve — move staged rows into the permanent record
   ------------------------------------------------------------------ */

const normalizeDescription = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Plain dollar string for an error message — not formatMoney(), that's web-only. */
const formatCentsForError = (cents) => {
  const sign = cents < 0 ? '-' : '';
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
};

importsRouter.post('/:id/approve', validate(approveSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { staged_ids, all } = req.body;

    const { rows: batches } = await query('SELECT * FROM import_batch WHERE id = $1', [id]);
    if (batches.length === 0) return res.status(404).json({ error: 'Import not found' });
    const batch = batches[0];

    if (batch.status === 'NEEDS_ACCOUNT' || batch.account_id == null) {
      return res.status(409).json({ error: 'Confirm which account this statement belongs to first' });
    }
    if (batch.status !== 'REVIEW' && batch.status !== 'APPROVED') {
      return res.status(409).json({ error: 'This import has not been parsed yet' });
    }

    const { rows: staged } = all
      ? await query(
          `SELECT * FROM staged_transaction
            WHERE import_batch_id = $1 AND review_status = 'PENDING' ORDER BY id`,
          [id]
        )
      : await query(
          `SELECT * FROM staged_transaction
            WHERE import_batch_id = $1 AND review_status = 'PENDING' AND id = ANY($2) ORDER BY id`,
          [id, staged_ids]
        );

    if (staged.length === 0) {
      return res.status(400).json({ error: 'Nothing to approve' });
    }

    // A row missing its date, description or amount cannot become a
    // transaction (those columns are NOT NULL, deliberately). Refuse
    // the whole request rather than approving a subset the caller
    // didn't ask for.
    const incomplete = staged.filter(
      (r) => r.posted_date === null || r.description === null || r.amount_cents === null
    );
    if (incomplete.length > 0) {
      return res.status(422).json({
        error: 'Some rows are missing a date, description or amount — fix or leave them unchecked',
        staged_ids: incomplete.map((r) => r.id),
      });
    }

    const { rows: categories } = await query('SELECT id, name FROM category');
    const categoryIdByName = new Map(categories.map((c) => [c.name, c.id]));
    const { rows: people } = await query('SELECT name FROM person');

    /**
     * Everything below commits together or not at all. A half-imported
     * statement is worse than a failed one — you'd have no clean way
     * to know which half made it.
     *
     * `failing` is tracked outside the transaction callback so that if
     * the dedupe constraint fires, the catch block below still knows
     * which staged row was being inserted — without it, the error
     * handler only sees "a 23505 happened somewhere," which is exactly
     * the unhelpful message this replaces.
     */
    let approvedCount;
    let failing = null;
    try {
      approvedCount = await withTransaction(async (client) => {
        const insertedIds = [];

        for (const row of staged) {
          failing = row;
          const dedupeHash = createHash('sha256')
            .update(
              `${batch.account_id}|${row.posted_date}|${row.amount_cents}|${normalizeDescription(row.description)}`
            )
            .digest('hex');

          const { rows: inserted } = await client.query(
            `INSERT INTO transaction
               (account_id, import_batch_id, posted_date, description, merchant,
                amount_cents, txn_type, category_id, dedupe_hash)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING id`,
            [
              batch.account_id,
              id,
              row.posted_date,
              row.description,
              row.merchant,
              row.amount_cents,
              row.txn_type,
              categoryIdByName.get(row.suggested_category) ?? null,
              dedupeHash,
            ]
          );
          insertedIds.push(inserted[0].id);

          // Recorded so the statement's Review screen can later edit
          // the real transaction directly instead of a frozen,
          // nobody-else-reads-it staged snapshot — see migration 009.
          await client.query(
            `UPDATE staged_transaction SET review_status = 'APPROVED', transaction_id = $2 WHERE id = $1`,
            [row.id, inserted[0].id]
          );

          // Zelle transactions used to wait on a person to review each
          // one by hand (ZelleReview.jsx) — now applied automatically
          // on approval, same rule a reviewer would apply: internal
          // (a household name) regardless of sign, else Sent/Received
          // by the amount's own sign. Still just a starting guess, not
          // fact — the review screen's PATCH stays available to
          // correct any row this gets wrong. See api/src/zelle.js.
          if (/zelle/i.test(row.description)) {
            await applyZelleReview(client, {
              id: inserted[0].id,
              ...autoZelleReview(row.description, row.amount_cents, people),
            });
          }
        }

        await client.query(
          `UPDATE import_batch
              SET status = 'APPROVED',
                  rows_approved = rows_approved + $2,
                  approved_at = now()
            WHERE id = $1`,
          [id, staged.length]
        );

        // Merchant cleanup FIRST: a confident match to an existing
        // merchant is fixed automatically, anything less certain lands
        // in the review queue — see merchant-review.js. This has to
        // run before recurring-matching, not after: a local parser
        // (parse/pdf-local-*.js) can leave merchant null for a
        // description it doesn't recognize (e.g. "Wells Fargo Auto
        // Draft PPD ID: ..."), and matchesRule's very first check is
        // `if (!transaction.merchant) return false` — matching against
        // the pre-cleanup null merchant meant a real recurring bill
        // could silently miss its own series forever, since matching
        // only ever runs once, right after this approval (a real case,
        // not hypothetical: caught when a Chase statement's Wells
        // Fargo car-loan draft didn't link to its already-confirmed
        // series).
        await flagOrFixMerchants(insertedIds, client);

        // Confirmed recurring rules catch their own future transactions
        // from here on, without re-running detection — see routes/recurring.js.
        await matchNewTransactions(insertedIds, client);

        return staged.length;
      });
    } catch (err) {
      // The dedupe constraint fired: one of these rows already exists
      // as a transaction. Nothing was committed. Name the actual row
      // and, if we can find it, the existing transaction it collides
      // with — "one of these rows" with no further detail leaves
      // nothing to act on.
      if (err.code === '23505') {
        let existing = null;
        if (failing) {
          const { rows: match } = await query(
            `SELECT id, posted_date, description, amount_cents
               FROM transaction
              WHERE account_id = $1 AND posted_date = $2 AND amount_cents = $3
              ORDER BY id LIMIT 1`,
            [batch.account_id, failing.posted_date, failing.amount_cents]
          );
          existing = match[0] ?? null;
        }

        return res.status(409).json({
          error: failing
            ? `"${failing.description}" (${failing.posted_date}, ${formatCentsForError(failing.amount_cents)}) already exists as a transaction. Nothing was approved — deselect it and try again.`
            : 'One of these rows already exists as a transaction. Nothing was approved.',
          staged_id: failing?.id ?? null,
          existing_transaction: existing,
        });
      }
      throw err;
    }

    await audit({
      action: 'import.approved',
      entityType: 'import_batch',
      entityId: id,
      detail: { rows_approved: approvedCount, all: all === true },
    });

    res.json({ id, status: 'APPROVED', rows_approved: approvedCount });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------
   Approve one row anyway, past the exact-duplicate constraint.

   D6/D13's dedupe_hash (account + date + amount + normalized
   description) is deliberately strict — it's the last line of
   defence against silently re-importing the same statement twice.
   But it has a real false-positive shape: two genuinely separate
   purchases at the same place, same day, same amount, with a generic
   bank-printed description that carries no transaction-specific
   detail (two $100 Costco runs; two Food Lion trips). The fuzzy flag
   already surfaces these for a human to look at; this is what "I
   looked, it's not a duplicate" actually does about it — a conscious,
   per-row, audited override, not a change to the constraint itself.
   A normal "Approve selected"/"Approve all" still hits the same wall
   for an actual accidental re-import, exactly as before.
   ------------------------------------------------------------------ */

importsRouter.post('/:id/staged/:sid/approve-anyway', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const sid = Number(req.params.sid);

    const { rows: batches } = await query('SELECT * FROM import_batch WHERE id = $1', [id]);
    if (batches.length === 0) return res.status(404).json({ error: 'Import not found' });
    const batch = batches[0];

    if (batch.status === 'NEEDS_ACCOUNT' || batch.account_id == null) {
      return res.status(409).json({ error: 'Confirm which account this statement belongs to first' });
    }

    const { rows: staged } = await query(
      `SELECT * FROM staged_transaction WHERE id = $1 AND import_batch_id = $2 AND review_status = 'PENDING'`,
      [sid, id]
    );
    if (staged.length === 0) {
      return res.status(404).json({ error: 'Staged row not found or already reviewed' });
    }
    const row = staged[0];

    if (row.posted_date === null || row.description === null || row.amount_cents === null) {
      return res.status(422).json({ error: 'This row is missing a date, description or amount' });
    }

    const { rows: categories } = await query('SELECT id, name FROM category');
    const categoryId = categories.find((c) => c.name === row.suggested_category)?.id ?? null;
    const { rows: people } = await query('SELECT name FROM person');

    // Same identity fields as the normal hash, plus the staged row's
    // own id — a real, always-unique, database-generated value — so
    // this exact row can never collide with anything, including a
    // second force-approved row that happens to share every other
    // field. The normal (non-forced) hash is untouched for every
    // other approval path, so a genuine accidental re-import is still
    // caught there.
    const dedupeHash = createHash('sha256')
      .update(
        `${batch.account_id}|${row.posted_date}|${row.amount_cents}|${normalizeDescription(row.description)}|forced:${row.id}`
      )
      .digest('hex');

    const transactionId = await withTransaction(async (client) => {
      const { rows: inserted } = await client.query(
        `INSERT INTO transaction
           (account_id, import_batch_id, posted_date, description, merchant,
            amount_cents, txn_type, category_id, dedupe_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          batch.account_id,
          id,
          row.posted_date,
          row.description,
          row.merchant,
          row.amount_cents,
          row.txn_type,
          categoryId,
          dedupeHash,
        ]
      );

      await client.query(
        `UPDATE staged_transaction SET review_status = 'APPROVED', transaction_id = $2 WHERE id = $1`,
        [row.id, inserted[0].id]
      );

      await client.query(
        `UPDATE import_batch SET status = 'APPROVED', rows_approved = rows_approved + 1, approved_at = now()
          WHERE id = $1`,
        [id]
      );

      // Merchant cleanup before recurring-matching — see the other
      // approval path's own comment on this ordering above.
      await flagOrFixMerchants([inserted[0].id], client);
      await matchNewTransactions([inserted[0].id], client);

      // Same automatic Zelle classification as the normal approval
      // path — see its own comment there.
      if (/zelle/i.test(row.description)) {
        await applyZelleReview(client, {
          id: inserted[0].id,
          ...autoZelleReview(row.description, row.amount_cents, people),
        });
      }

      return inserted[0].id;
    });

    await audit({
      action: 'transaction.approved_despite_duplicate',
      entityType: 'transaction',
      entityId: transactionId,
      detail: {
        staged_id: row.id,
        posted_date: row.posted_date,
        description: row.description,
        amount_cents: row.amount_cents,
        matched_transaction_id: row.duplicate_of_id,
      },
    });

    res.json({ id: transactionId, staged_id: row.id, status: 'APPROVED' });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------
   List batches — so the UI (and you, via curl) can see what's been
   uploaded and where each one is in the pipeline.
   ------------------------------------------------------------------ */

importsRouter.get('/', async (req, res, next) => {
  try {
    /**
     * flagged_count lets the statement list show a "possible duplicate"
     * warning without opening every batch to find out. It's only as
     * fresh as the last time someone opened that batch's Review screen
     * (duplicate_of_id is recomputed there, not here — see the comment
     * on GET /:id/staged) — a fine tradeoff for a heads-up indicator,
     * not a live guarantee.
     */
    const { rows } = await query(
      `SELECT b.id, b.original_filename, b.file_type, b.status, b.parse_method,
              b.rows_parsed, b.rows_approved, b.error_message,
              b.period_start, b.period_end,
              b.uploaded_at, b.approved_at,
              a.id AS account_id, a.name AS account_name, a.issuer AS account_issuer, a.mask AS account_mask,
              COALESCE(f.flagged_count, 0) AS flagged_count
         FROM import_batch b
         LEFT JOIN account a ON a.id = b.account_id
         LEFT JOIN (
           SELECT import_batch_id, COUNT(*) AS flagged_count
             FROM staged_transaction
            WHERE duplicate_of_id IS NOT NULL
            GROUP BY import_batch_id
         ) f ON f.import_batch_id = b.id
        ORDER BY b.uploaded_at DESC`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------
   Delete — a deliberate exception to the "never hard-delete" rule.

   This exists for undoing a genuine mistake (the wrong statement
   approved, an exact duplicate upload) — not for editing history, and
   not the same thing as a refund or a correction, which already have
   their own paths (a `refund` transaction, or PATCH-ing a category).
   Because it removes real rows rather than reversing them, the audit
   entry written just before deletion is the only permanent record of
   what existed — it carries the full list, not just a count, since
   there's no other way to reconstruct what was removed afterward.
   ------------------------------------------------------------------ */

importsRouter.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    const { rows: batches } = await query('SELECT * FROM import_batch WHERE id = $1', [id]);
    if (batches.length === 0) return res.status(404).json({ error: 'Import not found' });
    const batch = batches[0];

    const { rows: removedTransactions } = await query(
      `SELECT id, posted_date, description, amount_cents FROM transaction WHERE import_batch_id = $1`,
      [id]
    );

    await withTransaction(async (client) => {
      // Order matters, and cascades alone don't cover it: staged_transaction
      // has its own NO-ACTION reference to transaction (migration 009's
      // transaction_id link), so it has to go before transaction is
      // deleted, not after — deleting it here explicitly rather than
      // relying on the cascade from deleting import_batch, which would
      // run too late. statement and import_batch itself also reference
      // transaction/import_batch with NO ACTION, so they're last.
      await client.query('DELETE FROM staged_transaction WHERE import_batch_id = $1', [id]);
      await client.query('DELETE FROM transaction WHERE import_batch_id = $1', [id]);
      await client.query('DELETE FROM statement WHERE import_batch_id = $1', [id]);
      await client.query('DELETE FROM import_batch WHERE id = $1', [id]);
    });

    await unlink(path.resolve(REPO_ROOT, batch.stored_path)).catch(() => {});

    await audit({
      action: 'import.deleted',
      entityType: 'import_batch',
      entityId: id,
      detail: {
        original_filename: batch.original_filename,
        account_id: batch.account_id,
        transactions_removed_count: removedTransactions.length,
        transactions_removed: removedTransactions,
      },
    });

    res.json({ ok: true, transactions_removed: removedTransactions.length });
  } catch (err) {
    next(err);
  }
});
