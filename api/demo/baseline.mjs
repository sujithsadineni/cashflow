// The demo database is built straight from db/*.sql (rebuild.sh), so this
// records each file as applied: the API refuses to start on a database
// with no migration record (D204).
import { pool, query } from '../src/db.js';
import { ensureTable, migrationFiles } from '../src/migrations.js';

await ensureTable(query);
for (const f of await migrationFiles()) await query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [f.name, f.checksum]);
await pool.end();
