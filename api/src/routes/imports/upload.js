/**
 * Upload a statement, list the uploads, and remove one.
 * Split out of routes/imports.js (D213); mounted under /api/imports.
 */

import { createHash } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { ledgerTally } from '../../statements/tally.js';
import { ytdChecks } from '../../statements/ytd-check-run.js';

import { Router } from 'express';

import { query, withTransaction } from '../../core/db.js';
import { audit } from '../../core/audit.js';
import { validate, importCreateSchema } from '../../core/validate.js';
import { accountFolderSlug, uploadStatement, detectFileType, STATEMENTS_DIR, REPO_ROOT } from './shared.js';
import { runPaymentMatch } from '../../matching/payment-match-run.js';
import { rematchTransfers } from '../../matching/transfer-match-run.js';

const router = Router();
export { router as uploadRouter };

router.post('/', uploadStatement, validate(importCreateSchema), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Attach a statement file', field: 'statement', stage: 'upload' });
    }

    // account_id is an optional override — normally the parser
    // identifies the account and the human confirms it in review.
    const account_id = req.body.account_id ?? null;
    const parse_method = req.body.parse_method;
    const { originalname, buffer, size } = req.file;

    const detected = detectFileType(originalname, buffer);
    if (detected.error) {
      return res.status(400).json({ error: detected.error, field: 'statement', stage: 'upload' });
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
      `SELECT id, original_filename, status, uploaded_at, account_id,
              to_char(period_end, 'YYYY-MM-DD') AS period_end
         FROM import_batch WHERE file_hash = $1`,
      [fileHash]
    );
    if (existing.length > 0) {
      return res.status(409).json({
        error: 'This exact file was already imported',
        // Import's Upload box stops here with "Open it" (D325): the card and month to land on.
        stage: 'upload',
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
        return res.status(409).json({ error: 'This exact file was already imported', stage: 'upload' });
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
   List batches — so the UI (and you, via curl) can see what's been
   uploaded and where each one is in the pipeline.
   ------------------------------------------------------------------ */

router.get('/', async (req, res, next) => {
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
              COALESCE(f.flagged_count, 0) AS flagged_count,
              -- D274: does the statement add up on what's saved in the ledger?
              a.account_type, s.id IS NOT NULL AS has_summary, s.id AS statement_id, s.opening_balance_cents, s.closing_balance_cents, s.card_mask, s.product_name,
              (SELECT COALESCE(SUM(t.amount_cents), 0) FROM transaction t WHERE t.import_batch_id = b.id) AS saved_cents,
              (SELECT COUNT(*) FROM staged_transaction st WHERE st.import_batch_id = b.id AND st.review_status = 'PENDING') AS pending_count,
              (SELECT COALESCE(SUM(st.amount_cents), 0) FROM staged_transaction st WHERE st.import_batch_id = b.id AND st.review_status = 'PENDING') AS pending_cents
         FROM import_batch b
         LEFT JOIN statement s ON s.import_batch_id = b.id
         LEFT JOIN account a ON a.id = b.account_id
         LEFT JOIN (
           SELECT import_batch_id, COUNT(*) AS flagged_count
             FROM staged_transaction
            WHERE duplicate_of_id IS NOT NULL
            GROUP BY import_batch_id
         ) f ON f.import_batch_id = b.id
        ORDER BY b.uploaded_at DESC`
    );
    // A card statement's year-to-date box against its own fee and interest rows (D346).
    const ytd = await ytdChecks();
    // Only an approved PDF statement is checked: a CSV has no balances, and an import
    // still in review is checked on its Review screen.
    res.json(rows.map(({ account_type, has_summary, statement_id, opening_balance_cents, closing_balance_cents, saved_cents, pending_count, pending_cents, ...b }) => ({
      ...b,
      ytd_check: b.status === 'APPROVED' ? ytd.get(statement_id) ?? null : null,
      ledger_tally: b.status === 'APPROVED' && b.file_type === 'PDF'
        ? ledgerTally({
            accountType: account_type,
            hasSummary: has_summary,
            openingCents: opening_balance_cents,
            closingCents: closing_balance_cents,
            savedCents: Number(saved_cents),
            pendingCount: Number(pending_count),
            pendingCents: Number(pending_cents),
          })
        : null,
    })));
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

router.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    const { rows: batches } = await query('SELECT * FROM import_batch WHERE id = $1', [id]);
    if (batches.length === 0) return res.status(404).json({ error: 'Import not found' });
    const batch = batches[0];

    const { rows: removedTransactions } = await query(
      `SELECT id, posted_date, description, amount_cents FROM transaction WHERE import_batch_id = $1`,
      [id]
    );

    const ids = removedTransactions.map((t) => t.id);
    const derived = await withTransaction(async (client) => {
      // Everything that points at these transactions goes first; the
      // database refuses a dangling link, which is what made this a 500
      // once payment matching existed (D227). Order matters:
      //  1. derived links: payment matches on them, matches that used one of
      //     them as their bank row or Zelle (their parts cascade), and the
      //     Review / merchant findings about them. All are worked out from
      //     rows, never the household's own records, and come back on the
      //     next re-check.
      //  2. staged_transaction, which references transaction with NO ACTION
      //     (migration 009), so it can't wait for the import_batch cascade.
      //  3. the transactions, the statement, the batch.
      const { rows: matches } = await client.query(
        `SELECT DISTINCT m.id, t.account_id
           FROM payment_match m
           JOIN transaction t ON t.id = m.card_transaction_id
          WHERE m.card_transaction_id = ANY($1) OR m.bank_transaction_id = ANY($1)
             OR m.id IN (SELECT match_id FROM payment_match_part WHERE transaction_id = ANY($1))`,
        [ids]
      );
      await client.query('DELETE FROM payment_match WHERE id = ANY($1)', [matches.map((m) => m.id)]);
      const reviews = await client.query('DELETE FROM transaction_review WHERE transaction_id = ANY($1)', [ids]);
      const merchantReviews = await client.query('DELETE FROM merchant_review WHERE transaction_id = ANY($1)', [ids]);
      await client.query('DELETE FROM staged_transaction WHERE import_batch_id = $1', [id]);
      await client.query('DELETE FROM transaction WHERE import_batch_id = $1', [id]);
      // A re-upload of a statement already on file takes over its statement
      // row (upsertStatement matches on card and period). Deleting that
      // duplicate gives the row back to the import that still holds the
      // statement instead of deleting it with the duplicate (D274: three
      // statements were lost this way).
      const handedBack = await client.query(
        `UPDATE statement s
            SET import_batch_id = (SELECT b.id FROM import_batch b
                                    WHERE b.account_id = s.account_id AND b.id <> $1 AND b.status = 'APPROVED'
                                      AND b.period_start = s.period_start AND b.period_end = s.period_end
                                    ORDER BY b.id DESC LIMIT 1)
          WHERE s.import_batch_id = $1
            AND EXISTS (SELECT 1 FROM import_batch b
                         WHERE b.account_id = s.account_id AND b.id <> $1 AND b.status = 'APPROVED'
                           AND b.period_start = s.period_start AND b.period_end = s.period_end)
          RETURNING s.id, s.import_batch_id`,
        [id]
      );
      await client.query('DELETE FROM statement WHERE import_batch_id = $1', [id]);
      await client.query('DELETE FROM import_batch WHERE id = $1', [id]);
      return {
        payment_matches: matches.length,
        review_findings: reviews.rowCount,
        merchant_findings: merchantReviews.rowCount,
        statements_kept: handedBack.rows,
        // Cards whose other payments lost the bank row or Zelle that verified them.
        cards: [...new Set(matches.map((m) => m.account_id))],
      };
    });

    // Those cards' payments are matched again without the removed rows, so
    // a payment verified by a deleted bank row goes back to "not verified"
    // instead of pointing at nothing. Best-effort: the delete already stands.
    if (derived.cards.length > 0) {
      await runPaymentMatch({ accountIds: derived.cards }).catch((err) => req.log?.warn({ err }, 'payment re-match after delete failed'));
    }

    // A transfer whose other half was deleted lost its link with it (ON DELETE
    // CASCADE); its surviving half may now pair with another row (D265).
    await rematchTransfers().catch((err) => req.log?.warn({ err }, 'transfer re-match after delete failed'));

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
        derived_removed: { payment_matches: derived.payment_matches, review_findings: derived.review_findings, merchant_findings: derived.merchant_findings },
        statements_kept: derived.statements_kept,
      },
    });

    res.json({ ok: true, transactions_removed: removedTransactions.length });
  } catch (err) {
    next(err);
  }
});

