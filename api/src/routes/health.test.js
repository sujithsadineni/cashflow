/**
 * Route test for the corner cards' details (D333): the API half and the
 * database half, against a throwaway database built from the real
 * migrations (testing/db.js).
 */
import { dbAvailable, migrate, teardown } from '../testing/db.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

let base, server;

before(async () => {
  if (!dbAvailable) return;
  await migrate();
  const { app } = await import('../index.js');
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(async () => {
  server?.close();
  await teardown();
});

const skip = !dbAvailable && 'needs a local Postgres';

test('details: the API and the database, each with its own facts', { skip }, async () => {
  const res = await fetch(`${base}/health/details`);
  assert.equal(res.status, 200);
  const { api, db } = await res.json();
  assert.ok(api.uptime_seconds >= 0);
  assert.match(api.node, /^v\d+/);
  assert.ok(!Number.isNaN(Date.parse(api.started_at)));
  assert.equal(typeof db.name, 'string');
  assert.match(db.server_version, /^\d+/);
  assert.ok(db.size_bytes > 0);
  assert.equal(typeof db.transactions, 'number');
  assert.ok(db.ping_ms >= 0);
});
