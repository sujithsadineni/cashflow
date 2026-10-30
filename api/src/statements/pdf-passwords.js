/**
 * Remembered PDF passwords (D336): kept when one opens a statement, tried
 * by themselves on the next locked one (most used first), so a statement
 * from the same issuer opens without asking and its real pages can be
 * shown. Encrypted at rest (core/secrets.js); never logged, never in an
 * audit entry's detail.
 */
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { query } from '../core/db.js';
import { audit } from '../core/audit.js';
import { decrypt, encrypt, fingerprint } from '../core/secrets.js';

/** Does this password open this PDF? (pdf.js only checks it; nothing is read.) */
export async function opensWith(buffer, password) {
  const task = getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, password });
  try {
    await task.promise;
    return true;
  } catch (err) {
    if (err?.name === 'PasswordException') return false;
    throw err;
  } finally {
    await task.destroy();
  }
}

export const isLocked = async (buffer) => !(await opensWith(buffer, undefined));

/**
 * The saved password that opens this PDF, or null. `count` marks it used: a
 * statement read with it counts, its pages being drawn for the dialog don't.
 */
export async function findSavedPassword(buffer, { count = true } = {}) {
  const { rows } = await query('SELECT id, secret FROM pdf_password ORDER BY uses DESC, last_used_at DESC NULLS LAST, id');
  for (const row of rows) {
    let plain;
    try { plain = decrypt(row.secret); } catch { continue; } // made with another key
    if (await opensWith(buffer, plain)) {
      if (count) await query('UPDATE pdf_password SET uses = uses + 1, last_used_at = now() WHERE id = $1', [row.id]);
      return plain;
    }
  }
  return null;
}

/**
 * Keep a password (once per password); a label is kept if it had none.
 * `opened` when it just opened a statement (it counts); not when added by hand.
 */
export async function rememberPassword(plain, label = null, { opened = true } = {}) {
  const { rows } = await query(
    `INSERT INTO pdf_password (label, secret, fingerprint, uses, last_used_at) VALUES ($1, $2, $3, $4, CASE WHEN $4 > 0 THEN now() END)
     ON CONFLICT (fingerprint) DO UPDATE SET label = COALESCE(pdf_password.label, EXCLUDED.label), uses = pdf_password.uses + EXCLUDED.uses,
       last_used_at = CASE WHEN EXCLUDED.uses > 0 THEN now() ELSE pdf_password.last_used_at END
     RETURNING id, (xmax = 0) AS created`,
    [label, encrypt(plain), fingerprint(plain), opened ? 1 : 0]
  );
  if (rows[0].created) await audit({ action: 'pdf_password.saved', entityType: 'pdf_password', entityId: rows[0].id, detail: { label } });
  return rows[0].id;
}

export async function listPasswords() {
  const { rows } = await query('SELECT id, label, uses, last_used_at, created_at FROM pdf_password ORDER BY uses DESC, id');
  return rows;
}

/** Forgetting one is a real delete: a secret, not household data, so nothing is kept of it. */
export async function forgetPassword(id) {
  const { rows } = await query('DELETE FROM pdf_password WHERE id = $1 RETURNING id, label', [id]);
  if (rows[0]) await audit({ action: 'pdf_password.forgotten', entityType: 'pdf_password', entityId: id, detail: { label: rows[0].label } });
  return rows.length > 0;
}

/**
 * A stored statement's pages, opened the way Import opens it (D410): with PDF_PASSWORD when it's
 * set, else a remembered password when the file is locked. The readers that run after approval
 * (address, member since, missing rows) opened only with PDF_PASSWORD, so a locked statement
 * (every Zolve one) was skipped without a word.
 */
export async function pagesOf(buffer) {
  const { extractPdfPages } = await import('../parse/pdf-pages.js');
  const password = process.env.PDF_PASSWORD
    ?? ((await isLocked(buffer).catch(() => false)) ? await findSavedPassword(buffer, { count: false }) : undefined);
  return extractPdfPages(buffer, password ?? undefined);
}
