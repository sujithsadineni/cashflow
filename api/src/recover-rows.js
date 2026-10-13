/**
 * Re-read a stored statement and queue the rows its saved rows lack
 * (D207, made a button in D214). Used by POST /api/imports/:id/recover
 * and scripts/reread-missing-rows.mjs. Rows go to staging as PENDING and
 * the statement goes back to Review: nothing reaches `transaction`
 * without the household approving it.
 *
 * Local reader only: it's free and runs on this machine, and it's what
 * gets fixed when a row is misread. A statement the local reader can't
 * read says so instead.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { query, withTransaction } from './db.js';
import { audit } from './audit.js';
import { extractStatementFromPdfLocally } from './parse/pdf-local.js';
import { missingRows } from './missing-rows.js';
import { suggestHistoricalCategories } from './historical-category.js';
import { keywordCategory } from './parse/keyword-category.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

/**
 * Also compares the balances (D215): a statement whose rows are all
 * right can still be off because its opening or closing balance was
 * misread (Visa Signature Apr 2026: "Previous Balance $24.00" saved as
 * $0). The fresh read's balances are offered when they differ.
 * @returns { rows: [...missing], balances: { saved, read } | null, error? }
 */
export async function recoverMissingRows(batchId, { dry = false, useBalances = false } = {}) {
  const { rows: [batch] } = await query('SELECT id, stored_path, file_type, status FROM import_batch WHERE id = $1', [batchId]);
  if (!batch) return { status: 404, error: 'Import not found' };
  if (batch.file_type !== 'PDF') return { status: 400, error: 'Only a stored PDF can be re-read' };
  const { rows: categories } = await query('SELECT name FROM category');
  const parsed = await extractStatementFromPdfLocally(await readFile(path.resolve(REPO_ROOT, batch.stored_path)), categories.map((c) => c.name));
  if (parsed.error) return { status: 422, error: `The free reader can't read this statement: ${parsed.error}` };
  const { rows: saved } = await query(`SELECT to_char(posted_date, 'YYYY-MM-DD') AS posted_date, amount_cents FROM staged_transaction WHERE import_batch_id = $1`, [batchId]);
  const missing = missingRows(parsed.rows, saved);
  const { rows: [stmt] } = await query('SELECT id, opening_balance_cents, closing_balance_cents FROM statement WHERE import_batch_id = $1', [batchId]);
  const read = parsed.statement ?? {};
  const differ = stmt && read.opening_balance_cents != null && read.closing_balance_cents != null
    && (read.opening_balance_cents !== stmt.opening_balance_cents || read.closing_balance_cents !== stmt.closing_balance_cents);
  const balances = differ
    ? { saved: { opening_cents: stmt.opening_balance_cents, closing_cents: stmt.closing_balance_cents }, read: { opening_cents: read.opening_balance_cents, closing_cents: read.closing_balance_cents } }
    : null;
  if (useBalances) {
    if (!balances) return { status: 409, error: 'The balances already match what the statement prints' };
    await query('UPDATE statement SET opening_balance_cents = $1, closing_balance_cents = $2 WHERE id = $3', [balances.read.opening_cents, balances.read.closing_cents, stmt.id]);
    await audit({ action: 'statement.balances_corrected', entityType: 'import_batch', entityId: batchId, detail: { from: balances.saved, to: balances.read, by: 'local re-read' } });
    return { rows: [], balances: null, corrected: balances };
  }
  // Same fill-in as a fresh parse: the household's own history first, then plain words (D188).
  const blank = missing.filter((r) => !r.suggested_category);
  if (blank.length > 0) {
    for (const [i, category] of await suggestHistoricalCategories(blank, { query })) blank[i].suggested_category = category;
    for (const r of blank) if (!r.suggested_category && (r.txn_type ?? 'purchase') === 'purchase') r.suggested_category = keywordCategory(r.description, categories.map((c) => c.name));
  }
  if (dry || missing.length === 0) return { rows: missing, balances };

  await withTransaction(async (client) => {
    for (const m of missing) {
      await client.query(
        `INSERT INTO staged_transaction (import_batch_id, posted_date, description, merchant, amount_cents, txn_type, suggested_category, confidence, raw_text)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'MEDIUM', $8)`,
        [batchId, m.posted_date, m.description, m.merchant ?? null, m.amount_cents, m.txn_type ?? null, m.suggested_category ?? null, m.raw_text ?? null]
      );
    }
    await client.query(`UPDATE import_batch SET status = 'REVIEW' WHERE id = $1`, [batchId]);
  });
  await audit({ action: 'import.rows_recovered', entityType: 'import_batch', entityId: batchId, detail: { rows: missing.length, amounts_cents: missing.map((m) => m.amount_cents) } });
  return { rows: missing, balances };
}
