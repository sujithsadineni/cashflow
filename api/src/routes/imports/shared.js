/**
 * Shared by the import routes (D213): where statement files live and how
 * they're named, the upload limits, and saving a statement's summary.
 */

import { mkdir, rename, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import multer from 'multer';

import { query } from '../../core/db.js';

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

// Kept in sync by hand with web/src/components/imports/Imports.jsx's own copy —
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
        return res.status(400).json({ error: 'File is too large (20MB max)', field: 'statement', stage: 'upload' });
      }
      return res.status(400).json({ error: err.message, field: 'statement', stage: 'upload' });
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

/**
 * Description normalization for matching: lowercase, letters and
 * digits only. "FOOD LION #7777" and "Food Lion 7777" should count
 * as the same merchant.
 */
const normalizedSql = (column) => `lower(regexp_replace(${column}, '[^a-zA-Z0-9]', '', 'g'))`;

/**
 * A staged row `s` is a suspected duplicate of transaction `t` when they're on
 * the same account, the same amount, a matching normalized description, and
 * posted within 3 days, and `t` came from another statement: two such rows on
 * one statement are both real, the bank printed both (D328). One rule for
 * Review's flags and the count parse reports (D325), so the two can't drift.
 */
export const duplicateMatchSql = (accountSql) =>
  `t.account_id = ${accountSql}
   AND t.import_batch_id IS DISTINCT FROM s.import_batch_id
   AND t.amount_cents = s.amount_cents
   AND abs(t.posted_date - s.posted_date) <= 3
   AND ${normalizedSql('t.description')} = ${normalizedSql('s.description')}`;

/**
 * The same statement already saved (D307): same account, a period ending
 * within two days. Its rows would all show as duplicates one by one; this
 * says it once, for the whole file. Review and parse (D325) both ask.
 */
export async function findSameStatement(accountId, batchId, periodEnd) {
  const { rows: [same] } = await query(
    `SELECT s.import_batch_id, to_char(s.period_start, 'YYYY-MM-DD') AS period_start, to_char(s.period_end, 'YYYY-MM-DD') AS period_end
       FROM statement s JOIN import_batch b ON b.id = s.import_batch_id
      WHERE s.account_id = $1 AND b.id <> $2 AND b.status = 'APPROVED'
        AND abs(s.period_end - $3::date) <= 2
      LIMIT 1`,
    [accountId, batchId, periodEnd]
  );
  return same ?? null;
}

/**
 * Shared by parse (account already known) and account confirmation.
 *
 * A re-upload of a statement already on file (the same month downloaded
 * again) leaves the statement with the approved import that holds its rows
 * (D281). Taking it over left that import with no summary to check against
 * ("can't be checked" on Imports), and on a card the month could look
 * quiet on the calendar while the re-upload sat unapproved with no saved rows.
 */
export async function upsertStatement(client, accountId, batchId, summary) {
  const { rows } = await client.query(
    `INSERT INTO statement
       (account_id, import_batch_id, period_start, period_end,
        opening_balance_cents, closing_balance_cents,
        total_spend_cents, total_payments_cents,
        cashback_earned_cents, cashback_balance_cents, cashback_balance_as_of,
        payment_due_date, minimum_payment_cents, card_mask, product_name,
        credit_limit_cents, available_credit_cents, cash_advance_limit_cents,
        ytd_year, ytd_fees_cents, ytd_interest_cents,
        apr_purchase_bps, apr_balance_transfer_bps, apr_cash_advance_bps, apr_penalty_bps, apr_variable, terms_notice, rewards, savings, plans)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30)
     ON CONFLICT (account_id, period_start, period_end)
     DO UPDATE SET import_batch_id = CASE
                     WHEN EXISTS (SELECT 1 FROM import_batch held
                                   WHERE held.id = statement.import_batch_id
                                     AND held.id <> EXCLUDED.import_batch_id
                                     AND held.status = 'APPROVED')
                     THEN statement.import_batch_id
                     ELSE EXCLUDED.import_batch_id
                   END,
                   opening_balance_cents = EXCLUDED.opening_balance_cents,
                   closing_balance_cents = EXCLUDED.closing_balance_cents,
                   total_spend_cents = EXCLUDED.total_spend_cents,
                   total_payments_cents = EXCLUDED.total_payments_cents,
                   cashback_earned_cents = EXCLUDED.cashback_earned_cents,
                   cashback_balance_cents = EXCLUDED.cashback_balance_cents,
                   cashback_balance_as_of = EXCLUDED.cashback_balance_as_of,
                   payment_due_date = COALESCE(EXCLUDED.payment_due_date, statement.payment_due_date),
                   minimum_payment_cents = COALESCE(EXCLUDED.minimum_payment_cents, statement.minimum_payment_cents),
                   card_mask = COALESCE(EXCLUDED.card_mask, statement.card_mask),
                   product_name = COALESCE(EXCLUDED.product_name, statement.product_name),
                   -- Kept when a later read (a CSV, say) doesn't print them (D346).
                   credit_limit_cents = COALESCE(EXCLUDED.credit_limit_cents, statement.credit_limit_cents),
                   available_credit_cents = COALESCE(EXCLUDED.available_credit_cents, statement.available_credit_cents),
                   cash_advance_limit_cents = COALESCE(EXCLUDED.cash_advance_limit_cents, statement.cash_advance_limit_cents),
                   ytd_year = COALESCE(EXCLUDED.ytd_year, statement.ytd_year),
                   ytd_fees_cents = COALESCE(EXCLUDED.ytd_fees_cents, statement.ytd_fees_cents),
                   ytd_interest_cents = COALESCE(EXCLUDED.ytd_interest_cents, statement.ytd_interest_cents),
                   -- Its APRs (D349), kept the same way.
                   apr_purchase_bps = COALESCE(EXCLUDED.apr_purchase_bps, statement.apr_purchase_bps),
                   apr_balance_transfer_bps = COALESCE(EXCLUDED.apr_balance_transfer_bps, statement.apr_balance_transfer_bps),
                   apr_cash_advance_bps = COALESCE(EXCLUDED.apr_cash_advance_bps, statement.apr_cash_advance_bps),
                   apr_penalty_bps = COALESCE(EXCLUDED.apr_penalty_bps, statement.apr_penalty_bps),
                   apr_variable = COALESCE(EXCLUDED.apr_variable, statement.apr_variable),
                   terms_notice = COALESCE(EXCLUDED.terms_notice, statement.terms_notice),
                   rewards = COALESCE(EXCLUDED.rewards, statement.rewards),
                   savings = COALESCE(EXCLUDED.savings, statement.savings),
                   plans = COALESCE(EXCLUDED.plans, statement.plans)
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
      summary.cashback_balance_as_of ?? null,
      summary.payment_due_date ?? null,
      summary.minimum_payment_cents ?? null,
      /^\d{4}$/.test(summary.card_mask ?? '') ? summary.card_mask : null,
      summary.product_name ?? null,
      summary.credit_limit_cents ?? null,
      summary.available_credit_cents ?? null,
      summary.cash_advance_limit_cents ?? null,
      summary.ytd_year ?? null,
      summary.ytd_fees_cents ?? null,
      summary.ytd_interest_cents ?? null,
      summary.apr_purchase_bps ?? null,
      summary.apr_balance_transfer_bps ?? null,
      summary.apr_cash_advance_bps ?? null,
      summary.apr_penalty_bps ?? null,
      summary.apr_variable ?? null,
      summary.terms_notice ? JSON.stringify(summary.terms_notice) : null,
      summary.rewards ? JSON.stringify(summary.rewards) : null,
      summary.savings ? JSON.stringify(summary.savings) : null,
      summary.plans ? JSON.stringify(summary.plans) : null,
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


/**
 * A statement's own printed figures (D335, D360), for the strip above its rows
 * and for finding where each is printed: what's saved once it's approved,
 * otherwise what the parser read off the page (detected_summary). Beyond the
 * balances, what this statement printed that the household reads: the year's
 * fees and interest and the purchase APR on a card, rewards as printed, a
 * savings account's interest and APY (D346–D355). Unprinted ones are null.
 * @param batch an import_batch row
 * @returns { summary, totals } — totals has the account's type
 */
export async function statementSummary(batch) {
  const { rows: [totals] } = await query(
    `SELECT s.opening_balance_cents, s.closing_balance_cents, a.account_type,
            s.total_spend_cents, s.total_payments_cents, s.cashback_earned_cents,
            s.payment_due_date::text AS payment_due_date, s.minimum_payment_cents,
            s.credit_limit_cents, s.available_credit_cents,
            s.ytd_year, s.ytd_fees_cents, s.ytd_interest_cents, s.apr_purchase_bps, s.rewards, s.savings,
            a.credit_limit_manual_cents
       FROM import_batch b
       LEFT JOIN statement s ON s.import_batch_id = b.id
       LEFT JOIN account a ON a.id = b.account_id
      WHERE b.id = $1`,
    [batch.id]
  );
  const read = batch.detected_summary ?? {};
  const pick = (key) => totals?.[key] ?? read[key] ?? null;
  const num = (v) => (v == null ? null : Number(v));
  const summary = {
    opening_cents: pick('opening_balance_cents'),
    closing_cents: pick('closing_balance_cents'),
    spend_cents: pick('total_spend_cents'),
    payments_cents: pick('total_payments_cents'),
    cashback_cents: pick('cashback_earned_cents'),
    due_date: pick('payment_due_date'),
    minimum_cents: pick('minimum_payment_cents'),
    // Its credit line (D346), shown under the strip as what was used of the limit.
    credit_limit_cents: num(pick('credit_limit_cents')),
    available_credit_cents: num(pick('available_credit_cents')),
    // The limit the household set for a card whose statements print none (D354: Apple), used only then.
    credit_limit_manual_cents: num(totals?.credit_limit_manual_cents),
    ytd_year: pick('ytd_year'),
    ytd_fees_cents: num(pick('ytd_fees_cents')),
    ytd_interest_cents: num(pick('ytd_interest_cents')),
    apr_purchase_bps: pick('apr_purchase_bps'),
    rewards: pick('rewards'),
    savings: pick('savings'),
  };
  return { summary, totals: totals ?? {} };
}
