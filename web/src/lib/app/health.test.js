import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readHealth, uptimeLabel } from './health.js';

test('both up when the API answers ok', () => {
  const h = readHealth({ status: 200, body: { status: 'ok', database: 'books', postgres: 'PostgreSQL 16.4 (Homebrew) on aarch64-apple-darwin', uptime_seconds: 90 } });
  assert.equal(h.api, 'ok');
  assert.equal(h.db, 'ok');
  assert.equal(h.database, 'books');
  assert.equal(h.postgres, 'PostgreSQL 16.4');
});

test('a 503 means the API is up but the database is not', () => {
  assert.deepEqual(readHealth({ status: 503, body: { status: 'error' } }), { api: 'ok', db: 'down' });
});

test('no answer means the API is down and the database unknown', () => {
  assert.deepEqual(readHealth({ unreachable: true }), { api: 'down', db: 'unknown' });
});

test("the dev proxy's 502 for a stopped API is the API down, not the database", () => {
  assert.deepEqual(readHealth({ status: 502, body: {} }), { api: 'down', db: 'unknown' });
  assert.deepEqual(readHealth({ status: 503, body: {} }), { api: 'down', db: 'unknown' });
});

test('before the first check, both are checking', () => {
  assert.deepEqual(readHealth(null), { api: 'checking', db: 'checking' });
});

test('uptime in words', () => {
  assert.equal(uptimeLabel(30), 'under a minute');
  assert.equal(uptimeLabel(180), '3 min');
  assert.equal(uptimeLabel(7500), '2 h 5 min');
  assert.equal(uptimeLabel(7200), '2 h');
  assert.equal(uptimeLabel(86400 * 4), '4 days');
  assert.equal(uptimeLabel(null), null);
});

test('sizes, times ago and round trips in words', async () => {
  const { bytesLabel, agoLabel, msLabel } = await import('./health.js');
  assert.equal(bytesLabel(512), '512 bytes');
  assert.equal(bytesLabel(5 * 1024 * 1024 + 300000), '5.3 MB');
  assert.equal(bytesLabel(48213504), '46 MB');
  assert.equal(agoLabel(1000, 3000), 'just now');
  assert.equal(agoLabel(0, 40_000), '40 s ago');
  assert.equal(agoLabel(0, 200_000), '3 min ago');
  assert.equal(agoLabel(null, 0), null);
  assert.equal(msLabel(0.4), 'under 1 ms');
  assert.equal(msLabel(4.4), '4 ms');
  assert.equal(msLabel(1234), '1.2 s');
});
