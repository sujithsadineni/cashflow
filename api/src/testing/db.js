/**
 * A throwaway Postgres database for route tests (D209): created fresh,
 * built by the same migration files and runner production uses, dropped
 * afterwards. Real Postgres rather than pg-mem, because the routes use
 * json_agg … FILTER, ON CONFLICT … WHERE and other things an emulator
 * gets wrong, and a route test that passes on an emulator proves little.
 *
 * Must be imported before anything that imports src/db.js: it points
 * DATABASE_URL at the test database, and the pool reads it on import.
 */

import pg from 'pg';

const base = new URL(process.env.DATABASE_URL ?? 'postgres://localhost/cashflow');
const name = `cashflow_test_${process.pid}_${Date.now().toString(36)}`;
const admin = new URL(base);
admin.pathname = '/postgres';
const testUrl = new URL(base);
testUrl.pathname = `/${name}`;

let available = true;
try {
  const c = new pg.Client({ connectionString: admin.toString() });
  await c.connect();
  await c.query(`CREATE DATABASE ${name}`);
  await c.end();
} catch {
  available = false; // no Postgres here: route tests skip themselves
}
process.env.DATABASE_URL = testUrl.toString();
process.env.LOG_LEVEL = 'silent';
// Uploads in a route test go to a temp folder, never the real data/statements (D216).
// Shaped <temp>/data/statements: stored paths are saved as "data/statements/…"
// relative to the folder two levels up, exactly as in the real repo.
const { mkdtempSync, mkdirSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
if (!process.env.STATEMENTS_DIR) {
  process.env.STATEMENTS_DIR = `${mkdtempSync(`${tmpdir()}/cashflow-repo-`)}/data/statements`;
  mkdirSync(process.env.STATEMENTS_DIR, { recursive: true });
}

/** Skip route tests cleanly where there's no Postgres. */
export const dbAvailable = available;

/** Build the schema with the real migrations, through the real runner's pieces. */
export async function migrate() {
  const { query } = await import('../db.js');
  const { ensureTable, migrationFiles } = await import('../migrations.js');
  await ensureTable(query);
  for (const f of await migrationFiles()) {
    await query(f.sql);
    await query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [f.name, f.checksum]);
  }
}

/** Close the pool and drop the database. */
export async function teardown() {
  const { pool } = await import('../db.js');
  await pool.end();
  if (!available) return;
  const c = new pg.Client({ connectionString: admin.toString() });
  await c.connect();
  await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await c.end();
}
