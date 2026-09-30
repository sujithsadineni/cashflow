/**
 * Database access.
 *
 * One connection pool for the whole app. Opening a new connection per
 * query would be slow; the pool keeps a handful open and hands them out.
 */

import pg from 'pg';
import { logger } from './logger.js';

/**
 * Type parsing.
 *
 * By default the pg driver returns some numeric types as JavaScript
 * strings, because a Postgres BIGINT can hold values larger than
 * JavaScript's Number can represent exactly.
 *
 * Our money columns are INTEGER cents, which are nowhere near that
 * limit, so parsing them as numbers is safe and saves converting
 * everywhere. We do this explicitly rather than relying on defaults,
 * because "is this a number or a string?" is exactly the kind of
 * ambiguity that produces a bug you find three months later.
 *
 * 20 = int8 (bigint). 1700 = numeric — deliberately left as a string,
 * since we don't use it for money and silently converting it to a
 * float would defeat the point of having it.
 */
pg.types.setTypeParser(20, (value) => parseInt(value, 10));

// 1082 = DATE. The driver's default turns '2026-04-02' into a JS Date
// at *local* midnight, which shifts by a day the moment it crosses a
// timezone (serialization, hashing, display). A posted date is a
// calendar date, not an instant — keep it as the plain string.
pg.types.setTypeParser(1082, (value) => value);

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,                        // at most 10 open connections
  idleTimeoutMillis: 30_000,      // close idle ones after 30s
  connectionTimeoutMillis: 5_000, // fail fast if the DB is down
});

pool.on('error', (err) => {
  logger.error({ err }, 'unexpected database pool error');
});

/**
 * Run a query. Logs anything slower than 200ms so you notice
 * performance problems while they're small.
 *
 * Always pass values as the second argument:
 *     query('SELECT * FROM person WHERE id = $1', [id])
 *
 * Never build SQL by string concatenation. Parameterised queries are
 * how you avoid SQL injection — the driver sends the query and the
 * values separately, so a value can never be interpreted as SQL.
 */
export async function query(text, params) {
  const started = Date.now();
  const result = await pool.query(text, params);
  const ms = Date.now() - started;

  if (ms > 200) {
    logger.warn({ ms, rows: result.rowCount, sql: text.slice(0, 120) }, 'slow query');
  }
  return result;
}

/**
 * Run several statements as one transaction: either all of them
 * commit, or none do.
 *
 * You'll want this when approving an import — moving 80 rows from
 * staging into `transaction` and updating the batch status has to be
 * all-or-nothing. A half-finished import is worse than a failed one.
 *
 *     await withTransaction(async (client) => {
 *       await client.query('INSERT ...');
 *       await client.query('UPDATE ...');
 *     });
 */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err }, 'transaction rolled back');
    throw err;
  } finally {
    client.release(); // always return the connection to the pool
  }
}

/** Used at startup to confirm the database is actually reachable. */
export async function checkConnection() {
  const { rows } = await query('SELECT current_database() AS db, version() AS version');
  return rows[0];
}
