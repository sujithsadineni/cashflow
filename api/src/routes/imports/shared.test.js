import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { STATEMENTS_DIR, REPO_ROOT, accountFolderSlug, statementFileName } from './shared.js';

test('statement files resolve to the repo’s data/statements, wherever this module sits (D213)', () => {
  const repo = path.resolve(import.meta.dirname, '../../../..');
  assert.equal(STATEMENTS_DIR, process.env.STATEMENTS_DIR || path.join(repo, 'data', 'statements'));
  assert.equal(REPO_ROOT, path.resolve(STATEMENTS_DIR, '../..'));
  if (!process.env.STATEMENTS_DIR) assert.equal(REPO_ROOT, repo);
});

test('folder and file names', () => {
  assert.equal(accountFolderSlug('Customized Cash Rewards', '5501'), 'customized-cash-rewards-5501');
  assert.deepEqual(statementFileName('2025-01-13', '.pdf'), { year: '2025', fileName: '01 - January 2025.pdf' });
});
