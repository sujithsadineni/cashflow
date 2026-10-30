/**
 * Encryption for the few secrets the app keeps on this computer (D336):
 * remembered PDF passwords. AES-256-GCM with one key, read from
 * PDF_PASSWORD_KEY (64 hex characters) or, failing that, from
 * data/.pdf-password-key, which is made on first use. data/ is outside git
 * and the backups folder, so the key never travels with the database.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KEY_FILE = path.resolve(fileURLToPath(new URL('../../../data/.pdf-password-key', import.meta.url)));
let cached = null;

export function secretKey() {
  if (cached) return cached;
  const fromEnv = process.env.PDF_PASSWORD_KEY;
  if (fromEnv && /^[0-9a-f]{64}$/i.test(fromEnv)) {
    cached = Buffer.from(fromEnv, 'hex');
    return cached;
  }
  try {
    cached = Buffer.from(readFileSync(KEY_FILE, 'utf8').trim(), 'hex');
    if (cached.length === 32) return cached;
  } catch { /* first use */ }
  cached = randomBytes(32);
  mkdirSync(path.dirname(KEY_FILE), { recursive: true });
  writeFileSync(KEY_FILE, cached.toString('hex'), { mode: 0o600 });
  return cached;
}

export function encrypt(plain, key = secretKey()) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString('base64')).join('.');
}

export function decrypt(sealed, key = secretKey()) {
  const [iv, tag, body] = sealed.split('.').map((p) => Buffer.from(p, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}

/** The same password always gives the same fingerprint, without being readable from it. */
export const fingerprint = (plain, key = secretKey()) => createHmac('sha256', key).update(plain).digest('hex');
