/**
 * Reading the "Member since" a statement prints onto it (D393): the I/O
 * around member-since.js, like readStatementAddress (D303). Called after a
 * statement is approved (best-effort) and by the one-time backfill. Only the
 * first page is read: that's where issuers print it. The audit entry records
 * that it was read, not the date's source text.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from '../core/db.js';
import { audit } from '../core/audit.js';
import { extractPdfPages } from '../parse/pdf-pages.js';
import { memberSince } from './member-since.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** @returns 'updated' | 'unchanged' | 'not_found' | 'no_pdf' */
export async function readMemberSince(batchId) {
  const { rows: [s] } = await query(
    `SELECT s.id, s.account_id, to_char(s.member_since, 'YYYY-MM-DD') AS member_since, b.stored_path
       FROM statement s JOIN import_batch b ON b.id = s.import_batch_id
      WHERE b.id = $1 AND b.file_type = 'PDF' AND b.stored_path IS NOT NULL`,
    [batchId]
  );
  if (!s) return 'no_pdf';
  const pages = await extractPdfPages(await readFile(path.resolve(REPO_ROOT, s.stored_path)), process.env.PDF_PASSWORD);
  const found = memberSince(pages[0]?.text ?? '');
  if (!found) return 'not_found';
  if (found === s.member_since) return 'unchanged';
  await query('UPDATE statement SET member_since = $1 WHERE id = $2', [found, s.id]);
  await audit({ action: 'statement.member_since_read', entityType: 'statement', entityId: s.id, detail: { account_id: s.account_id, member_since: found } });
  return 'updated';
}
