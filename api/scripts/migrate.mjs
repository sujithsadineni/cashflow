/**
 * D204: apply the db/*.sql files that haven't run yet.
 *   npm run migrate              apply pending migrations, each in its own transaction
 *   npm run migrate -- --status  list what's pending, change nothing
 *   npm run migrate -- --baseline
 *       record every current file as already applied, without running it:
 *       once, for a database built by hand before this runner existed
 */
import { pool, query, withTransaction } from '../src/db.js';
import { audit } from '../src/audit.js';
import { ensureTable, migrationFiles, migrationStatus } from '../src/migrations.js';

const args = process.argv.slice(2);
const files = await migrationFiles();

try {
  if (args.includes('--baseline')) {
    await ensureTable(query);
    const { rows } = await query('SELECT COUNT(*)::int AS n FROM schema_migrations');
    if (rows[0].n > 0) throw new Error('Already tracked: --baseline is only for a database with no record yet.');
    for (const f of files) await query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [f.name, f.checksum]);
    await audit({ action: 'schema.baselined', detail: { files: files.length, last: files.at(-1)?.name } });
    console.log(`Recorded ${files.length} migrations as applied (through ${files.at(-1)?.name}).`);
  } else {
    const status = await migrationStatus(query, files);
    if (!status.tracked && files.length > 0) {
      // A database built before the runner: running 001 again would fail half way.
      const { rows } = await query(`SELECT to_regclass('public.transaction') IS NOT NULL AS built`);
      if (rows[0].built) throw new Error('This database was set up by hand. Run `npm run migrate -- --baseline` once first.');
    }
    for (const name of status.changed) console.warn(`! ${name} changed after it was applied. Put the change in a new migration instead.`);
    if (args.includes('--status')) {
      console.log(status.pending.length ? `Pending:\n${status.pending.map((f) => `  ${f.name}`).join('\n')}` : 'Up to date.');
    } else if (status.pending.length === 0) {
      console.log('Up to date.');
    } else {
      await ensureTable(query);
      for (const f of status.pending) {
        await withTransaction(async (client) => {
          await client.query(f.sql);
          await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [f.name, f.checksum]);
        });
        await audit({ action: 'schema.migrated', detail: { name: f.name } });
        console.log(`✓ ${f.name}`);
      }
    }
  }
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
