import { test } from 'node:test';
import assert from 'node:assert/strict';
import { issueUrl, shareLinks, REPO_URL } from './support-links.js';

const parse = (url) => Object.fromEntries(new URL(url).searchParams);

test('a feature request opens a new issue with title, body and the enhancement label', () => {
  const url = issueUrl({ kind: 'feature', title: '  Dark mode  ', description: 'Please add it.\n', page: '/overview' });
  assert.ok(url.startsWith(`${REPO_URL}/issues/new?`));
  const q = parse(url);
  assert.equal(q.title, 'Dark mode');
  assert.equal(q.labels, 'enhancement');
  assert.match(q.body, /### What would you like cashflow to do\?\n\nPlease add it\.\n/);
  assert.match(q.body, /page `\/overview`/);
  assert.doesNotMatch(q.body, /Screenshot/);
});

test('an error report is labelled bug and reminds the person to paste their screenshot', () => {
  const q = parse(issueUrl({ kind: 'bug', title: 'Crash', description: 'It broke', hasImage: true }));
  assert.equal(q.labels, 'bug');
  assert.match(q.body, /### Screenshot/);
  assert.match(q.body, /⌘V/);
});

test('share links carry the repo URL, encoded', () => {
  const { linkedin, x } = shareLinks();
  assert.equal(new URL(linkedin).searchParams.get('url'), REPO_URL);
  assert.equal(new URL(x).searchParams.get('url'), REPO_URL);
});
