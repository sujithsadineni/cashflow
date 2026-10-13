/**
 * Which db/*.sql files have run (D204). Until now each was applied by
 * hand with `psql -f` and nothing recorded which ones had: a restore or a
 * second machine meant guessing. `schema_migrations` records each file
 * once, with a checksum, and `npm run migrate` applies only the new ones,
 * each in its own transaction. The API refuses to start while one is
 * pending, so code never runs against a schema it doesn't expect.
 */

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../../db');

/** Every migration file, in order: "001_schema.sql" … */
export async function migrationFiles(dir = MIGRATIONS_DIR) {
  const names = (await readdir(dir)).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
  return Promise.all(names.map(async (name) => {
    const sql = await readFile(path.join(dir, name), 'utf8');
    return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
  }));
}

export async function ensureTable(query) {
  await query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name        TEXT PRIMARY KEY,
    checksum    TEXT NOT NULL,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
}

/**
 * Files not yet recorded, and recorded files whose contents changed since
 * (an applied migration is history: edit it and a fresh setup no longer
 * matches this database).
 * @returns { pending: [file], changed: [name], tracked: boolean }
 */
export async function migrationStatus(query, files) {
  const { rows: exists } = await query(`SELECT to_regclass('public.schema_migrations') IS NOT NULL AS ok`);
  if (!exists[0].ok) return { pending: files, changed: [], tracked: false };
  const { rows } = await query('SELECT name, checksum FROM schema_migrations');
  const applied = new Map(rows.map((r) => [r.name, r.checksum]));
  return {
    pending: files.filter((f) => !applied.has(f.name)),
    changed: files.filter((f) => applied.has(f.name) && applied.get(f.name) !== f.checksum).map((f) => f.name),
    tracked: true,
  };
}
