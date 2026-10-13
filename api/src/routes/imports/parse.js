/**
 * Read an uploaded statement (free and local, or with Claude when asked) into staged rows.
 * Split out of routes/imports.js (D213); mounted under /api/imports.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { Router } from 'express';

import { query, withTransaction } from '../../db.js';
import { audit } from '../../audit.js';
import { parseStatementCsv } from '../../parse/csv.js';
import { extractStatementFromPdf } from '../../parse/pdf.js';
import { extractStatementFromPdfLocally } from '../../parse/pdf-local.js';
import { enrichRows } from '../../parse/categorize.js';
import { biltRentRuleFor } from '../../parse/bilt-rent.js';
import { zelleCategoryFor } from '../../parse/zelle-category.js';
import { robinhoodCategoryFor } from '../../parse/robinhood-category.js';
import { suggestHistoricalCategories, suggestHistoricalTypes } from '../../historical-category.js';
import { verificationCategoryId } from '../transaction-review.js';
import { learnMerchants } from '../../merchant-learning.js';
import { keywordCategory } from '../../parse/keyword-category.js';
import { inflowType } from '../../inflow-type.js';
import { findVerification, VERIFICATION_CATEGORY } from '../../verification.js';
import { upsertStatement, relocateStatementFile, REPO_ROOT } from './shared.js';

const router = Router();
export { router as parseRouter };

// Row types that have a merchant to name. Payments, transfers and interest don't.
const NAMEABLE = new Set(['purchase', 'refund', 'fee', 'deposit', 'cashback']);

/* ------------------------------------------------------------------
   Parse — turn the stored file into staged_transaction rows.

   CSV only for now; PDF parsing is a later step. Rows go to staging,
   never straight to transaction: parsing is ~95% accurate and the
   human review pass is the design decision the whole app hangs on.
   ------------------------------------------------------------------ */

router.post('/:id/parse', async (req, res, next) => {
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

    // Claude is opt-in, one statement at a time (D182): every upload is
    // read free first, and a PDF only switches to Claude when the
    // request explicitly asks. The app sends that only after the person
    // clicked "Read with Claude" for this file. Never automatic.
    if (req.body?.parse_method === 'api' && batch.parse_method !== 'api') {
      if (batch.file_type !== 'PDF') return res.status(400).json({ error: 'Only a PDF can be read with Claude', field: 'parse_method' });
      await query(`UPDATE import_batch SET parse_method = 'api' WHERE id = $1`, [id]);
      batch.parse_method = 'api';
      await audit({ action: 'import.claude_approved', entityType: 'import_batch', entityId: id, detail: { from: 'local' } });
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
        // CSVs carry no account header. Claude's merchant/type/category
        // pass runs only for a CSV the person chose to send to Claude
        // (D182): a free upload stays free, and the history-based passes
        // below still fill what they can. Enrichment failing is fine —
        // the rows just arrive plain.
        if (parsed.ok && batch.parse_method === 'api') {
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

    // Merchant names the household's history already knows (D188): the free
    // parsers only carry a short built-in list, so a row they left unnamed
    // takes the name its bank line (or its first words) got before. First,
    // because the type and category passes below look things up by merchant.
    const unnamed = parsed.rows.filter((r) => !r.merchant && NAMEABLE.has(r.txn_type ?? 'purchase'));
    if (unnamed.length > 0) {
      const { rows: history } = await query(
        `SELECT id, description, merchant FROM transaction WHERE merchant IS NOT NULL AND txn_type = ANY($1)`,
        [[...NAMEABLE]]
      );
      for (const [i, { merchant }] of learnMerchants(history, unnamed)) unnamed[i].merchant = merchant;
    }

    // Types the household has taught (D175): a row whose merchant the
    // history clearly types differently takes the history's answer, so
    // a correction made once in Review carries into every later import.
    // Before the category pass, which is keyed by type.
    const learnedTypes = await suggestHistoricalTypes(parsed.rows, { query });
    for (const [index, type] of learnedTypes) parsed.rows[index].txn_type = type;

    // Money back from a merchant: a refund, or a card reward (D189). After the
    // learned types, so a history of rewards mislabelled as refunds can't win.
    for (const row of parsed.rows) {
      if (row.amount_cents > 0 && (row.txn_type === 'refund' || row.txn_type === 'cashback')) {
        row.txn_type = inflowType(row.description);
        if (row.txn_type === 'cashback' && (!row.suggested_category || row.suggested_category === 'Refund')) row.suggested_category = 'Cashback';
      }
    }

    // Account-verification micro-deposits (D177): neither income nor spend.
    const verification = findVerification(parsed.rows.map((r) => ({ ...r, account_id: 0 })));
    if (verification.size > 0) {
      await verificationCategoryId(); // the suggestion must name a real category
      for (const i of verification) {
        parsed.rows[i].txn_type = 'transfer';
        parsed.rows[i].suggested_category = VERIFICATION_CATEGORY;
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

    // Last resort (D188): plain words in the line ("GRILL", "BIRYANI", "PARKING").
    for (const row of parsed.rows) {
      if (!row.suggested_category && (row.txn_type ?? 'purchase') === 'purchase') {
        row.suggested_category = keywordCategory(row.description, categoryNames);
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
