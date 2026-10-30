import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { migrationFiles, migrationStatus } from './migrations.js';

// A stand-in for db.query: answers the two questions migrationStatus asks.
const fakeQuery = (applied) => async (sql) =>
  sql.includes('to_regclass') ? { rows: [{ ok: applied !== null }] } : { rows: applied ?? [] };

test('files are read in order, and only NNN_name.sql counts', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mig-'));
  await writeFile(path.join(dir, '002_b.sql'), 'SELECT 2;');
  await writeFile(path.join(dir, '001_a.sql'), 'SELECT 1;');
  await writeFile(path.join(dir, 'notes.md'), 'not a migration');
  const files = await migrationFiles(dir);
  assert.deepEqual(files.map((f) => f.name), ['001_a.sql', '002_b.sql']);
  assert.equal(files[0].checksum.length, 64);
});

test('pending, edited after applying, and a database with no record at all', async () => {
  const files = [{ name: '001_a.sql', checksum: 'x' }, { name: '002_b.sql', checksum: 'y' }];
  const s = await migrationStatus(fakeQuery([{ name: '001_a.sql', checksum: 'OLD' }]), files);
  assert.deepEqual(s.pending.map((f) => f.name), ['002_b.sql']);
  assert.deepEqual(s.changed, ['001_a.sql']);
  assert.equal((await migrationStatus(fakeQuery(null), files)).tracked, false);
});
