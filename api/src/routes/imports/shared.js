/**
 * Shared by the import routes (D213): where statement files live and how
 * they're named, the upload limits, and saving a statement's summary.
 */

import { mkdir, rename, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import multer from 'multer';

import { query } from '../../db.js';

// Resolved from this module's location, not process.cwd(), so it works
// no matter which directory the server was started from.
// STATEMENTS_DIR in the environment overrides it: route tests point it at
// a temp folder so an upload never lands in the real data/ (D216).
export const STATEMENTS_DIR = process.env.STATEMENTS_DIR || path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  // routes/imports/ → api/src/routes → api/src → api → the repo root
  '../../../../data/statements'
);

export const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20MB — generous for any statement

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
export function uploadStatement(req, res, next) {
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
export function detectFileType(originalName, buffer) {
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

// stored_path is relative to the repo root ('data/statements/...'),
// and STATEMENTS_DIR points at data/statements, so the repo root is
// one level up from it.
export const REPO_ROOT = path.resolve(STATEMENTS_DIR, '../..');

/** Shared by parse (account already known) and account confirmation. */
export async function upsertStatement(client, accountId, batchId, summary) {
  const { rows } = await client.query(
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
                   cashback_balance_cents = EXCLUDED.cashback_balance_cents
     RETURNING id`,
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
  // Promo lines (D192) belong to the statement: replaced with it, never merged.
  // A summary saved before promos were read has no `promos` key: leave its rows alone.
  if (Array.isArray(summary.promos)) {
    await client.query('DELETE FROM statement_promo WHERE statement_id = $1', [rows[0].id]);
    for (const p of summary.promos) {
      await client.query(
        `INSERT INTO statement_promo (statement_id, kind, label, offer_id, apr_bps, standard_apr_bps, end_date, balance_subject_cents)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [rows[0].id, p.kind, p.label, p.offer_id, p.apr_bps, p.standard_apr_bps, p.end_date, p.balance_subject_cents]
      );
    }
  }
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
export async function relocateStatementFile(batch, accountId, accountName, accountMask, periodEnd) {
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

