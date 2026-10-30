/**
 * Reading an account's mailing address off its newest PDF statement (D302):
 * the I/O around mailing-address.js. Called after a statement is approved
 * (best-effort, like learnCardDays) and by the one-time backfill. Keeps the
 * address from the newest statement only; an older one never replaces it.
 * The audit entry records that it was read and from when, not the address.
 *
 * readStatementAddress keeps every statement's own reading too (D303), so a
 * person's addresses have a history: an old statement uploaded later adds a
 * previous address without touching the current one.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { query } from '../core/db.js';
import { audit } from '../core/audit.js';
import { pagesOf } from './pdf-passwords.js';
// Where stored statements are, as Import itself resolves them (STATEMENTS_DIR), D410.
import { REPO_ROOT } from '../routes/imports/shared.js';
import { mailingAddress, addressLine } from './mailing-address.js';



/** @returns 'updated' | 'unchanged' | 'not_found' | 'no_pdf' */
export async function learnMailingAddress(accountId) {
  const { rows: [a] } = await query(
    `SELECT a.id, a.holder_name, a.statement_address, to_char(a.statement_address_as_of, 'YYYY-MM-DD') AS as_of, p.name AS person_name,
            (SELECT array_agg(DISTINCT b.detected_holder) FROM import_batch b WHERE b.account_id = a.id AND b.detected_holder IS NOT NULL) AS detected,
            (SELECT b.stored_path FROM import_batch b JOIN statement s ON s.import_batch_id = b.id
              WHERE b.account_id = a.id AND b.file_type = 'PDF' ORDER BY s.period_end DESC LIMIT 1) AS pdf,
            (SELECT to_char(s.period_end, 'YYYY-MM-DD') FROM import_batch b JOIN statement s ON s.import_batch_id = b.id
              WHERE b.account_id = a.id AND b.file_type = 'PDF' ORDER BY s.period_end DESC LIMIT 1) AS period_end
       FROM account a JOIN person p ON p.id = a.person_id WHERE a.id = $1`,
    [accountId]
  );
  if (!a?.pdf) return 'no_pdf';
  if (a.as_of && a.as_of >= a.period_end) return 'unchanged';
  const pages = await pagesOf(await readFile(path.resolve(REPO_ROOT, a.pdf)));
  const found = mailingAddress(pages[0]?.text ?? '', [a.holder_name, a.person_name, ...(a.detected ?? [])]);
  if (!found) return 'not_found';
  const line = addressLine(found);
  await query('UPDATE account SET statement_address = $1, statement_address_as_of = $2 WHERE id = $3', [line, a.period_end, accountId]);
  await audit({ action: 'account.address_read', entityType: 'account', entityId: accountId, detail: { as_of: a.period_end } });
  return 'updated';
}

/** Holder names to look for on an account's statements. */
async function holderNames(accountId) {
  const { rows: [a] } = await query(
    `SELECT a.holder_name, p.name AS person_name,
            (SELECT array_agg(DISTINCT b.detected_holder) FROM import_batch b WHERE b.account_id = a.id AND b.detected_holder IS NOT NULL) AS detected
       FROM account a JOIN person p ON p.id = a.person_id WHERE a.id = $1`,
    [accountId]
  );
  return a ? [a.holder_name, a.person_name, ...(a.detected ?? [])] : [];
}

/**
 * Reads one approved statement's mailing address onto it (D303).
 * @returns 'updated' | 'unchanged' | 'not_found' | 'no_pdf'
 */
export async function readStatementAddress(batchId) {
  const { rows: [s] } = await query(
    `SELECT s.id, s.account_id, s.mailing_address, b.stored_path, to_char(s.period_end, 'YYYY-MM-DD') AS period_end
       FROM statement s JOIN import_batch b ON b.id = s.import_batch_id
      WHERE b.id = $1 AND b.file_type = 'PDF' AND b.stored_path IS NOT NULL`,
    [batchId]
  );
  if (!s) return 'no_pdf';
  const pages = await pagesOf(await readFile(path.resolve(REPO_ROOT, s.stored_path)));
  const found = mailingAddress(pages[0]?.text ?? '', await holderNames(s.account_id));
  if (!found) return 'not_found';
  const line = addressLine(found);
  if (line === s.mailing_address) return 'unchanged';
  await query('UPDATE statement SET mailing_address = $1 WHERE id = $2', [line, s.id]);
  await audit({ action: 'statement.address_read', entityType: 'statement', entityId: s.id, detail: { period_end: s.period_end } });
  return 'updated';
}
