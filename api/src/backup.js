/**
 * Backups (D205). Years of statements lived in one local Postgres with no
 * copy anywhere. Once a day (checked at startup and every few hours while
 * the API runs) and on demand from Settings:
 *   - the database: `pg_dump --format=custom` to a dated file, keeping
 *     the newest 30 (restore with pg_restore, see Settings → Backups)
 *   - the statement PDFs: mirrored into the backup folder, copying only
 *     files it doesn't have yet and never deleting, so 30 days of backups
 *     don't mean 30 copies of 50 MB of PDFs
 * The folder sits outside the project (BACKUP_DIR, default
 * ~/cashflow-backups), so deleting or re-cloning the repo can't take the
 * backups with it. The last result is kept in app_setting 'last_backup'.
 */

import { spawn } from 'node:child_process';
import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { query } from './db.js';
import { audit } from './audit.js';
import { logger } from './logger.js';

export const KEEP = 30;
export const EVERY_MS = 24 * 60 * 60 * 1000;
const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
export const backupDir = () => process.env.BACKUP_DIR || path.join(os.homedir(), 'cashflow-backups');

/** "cashflow-2026-10-09-1803.dump" for a local time. */
export function dumpName(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `cashflow-${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}.dump`;
}

/** The dumps to delete: everything past the newest `keep` (names sort by time). */
export function toPrune(names, keep = KEEP) {
  return names.filter((n) => /^cashflow-\d{4}-\d{2}-\d{2}-\d{4}\.dump$/.test(n)).sort().reverse().slice(keep);
}

/** Due when there's no backup yet, or the last one is a day old. */
export const isDue = (lastAt, now = Date.now()) => !lastAt || now - Date.parse(lastAt) >= EVERY_MS;

function pgDump(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.PG_DUMP || 'pg_dump', ['--format=custom', '--no-owner', `--file=${file}`, process.env.DATABASE_URL]);
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim() || `pg_dump exited ${code}`))));
  });
}

async function countFiles(dir) {
  let n = 0;
  for (const e of await readdir(dir, { withFileTypes: true, recursive: true }).catch(() => [])) if (e.isFile()) n++;
  return n;
}

export async function lastBackup() {
  const { rows } = await query(`SELECT value FROM app_setting WHERE key = 'last_backup'`);
  return rows[0]?.value ?? null;
}

let running = null;

/** One backup now. Concurrent calls share the one in flight. */
export function runBackup({ reason = 'manual' } = {}) {
  running ??= (async () => {
    const root = backupDir();
    const dbDir = path.join(root, 'db');
    await mkdir(dbDir, { recursive: true });
    const file = path.join(dbDir, dumpName(new Date()));
    await pgDump(file);
    const { size } = await stat(file);

    // Statement PDFs: copy what's new, overwrite nothing, delete nothing.
    const from = path.join(REPO_ROOT, 'data');
    const to = path.join(root, 'data');
    const before = await countFiles(to);
    await cp(from, to, { recursive: true, force: false, errorOnExist: false }).catch((err) => {
      if (err.code !== 'ENOENT') throw err;
    });
    const statements = await countFiles(to);

    const pruned = toPrune(await readdir(dbDir));
    for (const name of pruned) await rm(path.join(dbDir, name));

    const result = { at: new Date().toISOString(), file, bytes: size, statements, statements_added: statements - before, pruned: pruned.length, reason };
    await query(
      `INSERT INTO app_setting (key, value, updated_at) VALUES ('last_backup', $1, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [result]
    );
    await audit({ action: 'backup.created', detail: { file: path.basename(file), bytes: size, statements_added: result.statements_added, pruned: pruned.length, reason } });
    return result;
  })().finally(() => { running = null; });
  return running;
}

/** At startup and every 3 hours: back up if the last one is a day old. Never throws. */
export function scheduleBackups() {
  const check = async () => {
    try {
      const last = await lastBackup();
      if (isDue(last?.at)) {
        const r = await runBackup({ reason: 'daily' });
        logger.info({ file: r.file, bytes: r.bytes }, 'backup created');
      }
    } catch (err) {
      logger.error({ err }, 'backup failed');
    }
  };
  setTimeout(check, 10_000).unref();
  setInterval(check, 3 * 60 * 60 * 1000).unref();
}
