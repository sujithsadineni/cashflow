/**
 * Remembered PDF passwords (D336): kept once per password, listed without
 * the password, encrypted at rest, forgotten for good. Throwaway database,
 * throwaway key (PDF_PASSWORD_KEY), so the real key file is never touched.
 */
import { randomBytes } from 'node:crypto';
process.env.PDF_PASSWORD_KEY = randomBytes(32).toString('hex');
import { dbAvailable, migrate, teardown } from '../testing/db.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

let base, server, query;
before(async () => {
  if (!dbAvailable) return;
  await migrate();
  ({ query } = await import('../core/db.js'));
  const { app } = await import('../index.js');
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(async () => { server?.close(); await teardown(); });
const skip = !dbAvailable && 'needs a local Postgres';
const post = (body) => fetch(`${base}/pdf-passwords`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('a password is kept once, encrypted, and listed without itself', { skip }, async () => {
  assert.equal((await post({ password: 'test-pass-1', label: 'Zolve · Alex' })).status, 201);
  assert.equal((await post({ password: 'test-pass-1' })).status, 201, 'the same one again');
  const list = await (await fetch(`${base}/pdf-passwords`)).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].label, 'Zolve · Alex', 'the label it first had is kept');
  assert.equal(list[0].uses, 0, 'added by hand: nothing opened with it yet');
  assert.ok(!JSON.stringify(list).includes('test-pass-1'), 'never sent back');
  const { rows: [row] } = await query('SELECT secret FROM pdf_password');
  assert.ok(!row.secret.includes('test-pass-1'), 'not readable in the database');
  const { rows: audits } = await query(`SELECT detail::text FROM audit_log WHERE action = 'pdf_password.saved'`);
  assert.equal(audits.length, 1);
  assert.ok(!audits[0].detail.includes('test-pass-1'), 'not in the audit entry');
});

test('a forgotten password is gone', { skip }, async () => {
  const { id } = await (await post({ password: 'test-pass-2' })).json();
  assert.equal((await fetch(`${base}/pdf-passwords/${id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await query('SELECT 1 FROM pdf_password WHERE id = $1', [id])).rows.length, 0);
  assert.equal((await fetch(`${base}/pdf-passwords/${id}`, { method: 'DELETE' })).status, 404);
});
