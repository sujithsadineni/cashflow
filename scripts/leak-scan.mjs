#!/usr/bin/env node
/**
 * Leak scan: fails if anything personal or secret is in the files that
 * get published (scripts/publish-manifest.json). Three kinds of check:
 *
 *   1. Blocklist terms from .private/blocklist.txt — real names, last-4s,
 *      addresses — except inside the manifest's exact `allow` strings
 *      (the public repo's own URLs, which contain the owner's username). That file is git-ignored, because the list itself is
 *      personal; without it only checks 2 and 3 run (with a warning).
 *   2. Shapes: a 13–19 digit card number that passes the Luhn check
 *      (known test numbers excepted), an email outside example.com/.org.
 *   3. Secrets: API-key and private-key shapes.
 *
 * Modes:
 *   node scripts/leak-scan.mjs              every publishable tracked file
 *   node scripts/leak-scan.mjs --staged     staged files only (pre-commit)
 *   node scripts/leak-scan.mjs --dir PATH   every file under PATH (the
 *                                           public export, before a push)
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, matchesGlob, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const manifest = JSON.parse(readFileSync(join(ROOT, 'scripts/publish-manifest.json'), 'utf8'));

// Files that must never be committed, publishable path or not.
const FORBIDDEN_FILES = [/\.env(\..+)?$/, /\.(pdf|csv|ofx|qfx|xlsx?|sqlite|db|pem|key|mp4|mov)$/i, /^\.private\//];
const ALLOWED_FILES = [/\.env\.example$/];

const TEST_PANS = new Set(['4111111111111111', '4111222233332468', '4242424242424242', '5555555555554444']);
const EMAIL_OK = /@(example\.(com|org|net)|anthropic\.com|users\.noreply\.github\.com)$/i;
const SECRETS = [
  [/sk-ant-[A-Za-z0-9_-]{10,}/, 'Anthropic API key'],
  [/sk-[A-Za-z0-9]{32,}/, 'API key'],
  [/gh[pousr]_[A-Za-z0-9]{30,}/, 'GitHub token'],
  [/AKIA[0-9A-Z]{16}/, 'AWS key'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
];

export function luhn(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
  }
  return sum % 10 === 0;
}

/** Every leak in one file's text, as { line, reason }. Pure, so it's testable. */
export function findLeaks(text, terms = [], { lockfile = false, allow = [] } = {}) {
  const found = [];
  // Exact public strings (the repo's own URLs) are removed before the
  // blocklist check, so a name inside them passes but nowhere else does.
  const allowRe = allow.length ? new RegExp(allow.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi') : null;
  const lines = text.split('\n');
  const termRe = terms.length ? new RegExp(terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i') : null;
  lines.forEach((line, i) => {
    const at = i + 1;
    const term = termRe && (allowRe ? line.replace(allowRe, '') : line).match(termRe);
    if (term) found.push({ line: at, reason: `blocklisted term "${term[0]}"` });
    if (lockfile) return; // lockfiles are full of package-author emails and hashes
    // Real card groupings only (4-4-4-4…, Amex 4-6-5, or one unbroken run),
    // so a store number next to a phone number doesn't look like a card.
    for (const m of line.matchAll(/\b(?:\d{13,19}|\d{4}([ -])\d{4}\1\d{4}\1\d{1,7}|\d{4}([ -])\d{6}\2\d{5})\b/g)) {
      const digits = m[0].replace(/\D/g, '');
      if (digits.length >= 13 && !TEST_PANS.has(digits) && luhn(digits)) found.push({ line: at, reason: `card-number shape ${digits.slice(0, 4)}…` });
    }
    for (const m of line.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)) {
      if (!EMAIL_OK.test(m[0])) found.push({ line: at, reason: `email ${m[0]}` });
    }
    for (const [re, what] of SECRETS) if (re.test(line)) found.push({ line: at, reason: what });
  });
  return found;
}

const isPublishable = (p) =>
  manifest.include.some((g) => matchesGlob(p, g)) && !manifest.exclude.some((g) => matchesGlob(p, g));
const isForbidden = (p) => FORBIDDEN_FILES.some((re) => re.test(p)) && !ALLOWED_FILES.some((re) => re.test(p));
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });

function walk(dir, base = dir) {
  return readdirSync(dir).flatMap((name) => {
    if (name === '.git' || name === 'node_modules') return [];
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full, base) : [relative(base, full)];
  });
}

function main() {
  const args = process.argv.slice(2);
  const blocklistPath = join(ROOT, '.private/blocklist.txt');
  const terms = existsSync(blocklistPath)
    ? readFileSync(blocklistPath, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    : [];
  if (!terms.length) console.warn('leak-scan: no .private/blocklist.txt — name checks skipped, shape and secret checks still run');

  let files; // [path, () => text]
  if (args[0] === '--dir') {
    const dir = args[1];
    files = walk(dir).map((p) => [p, () => readFileSync(join(dir, p), 'utf8')]);
  } else if (args[0] === '--staged') {
    const staged = git('diff', '--cached', '--name-only', '--diff-filter=ACMR').split('\n').filter(Boolean);
    files = staged.map((p) => [p, () => git('show', `:${p}`)]);
  } else {
    files = git('ls-files').split('\n').filter(Boolean).map((p) => [p, () => readFileSync(join(ROOT, p), 'utf8')]);
  }

  const problems = [];
  let scanned = 0;
  for (const [path, read] of files) {
    if (isForbidden(path)) problems.push(`${path}: this kind of file never belongs in git`);
    // In --dir mode everything is headed for the public repo, so everything is scanned.
    if (args[0] !== '--dir' && !isPublishable(path)) continue;
    if (/\.(png|jpe?g|gif|webp|ico|woff2?)$/i.test(path)) continue;
    scanned++;
    for (const { line, reason } of findLeaks(read(), terms, { lockfile: path.endsWith('package-lock.json'), allow: manifest.allow ?? [] })) {
      problems.push(`${path}:${line}: ${reason}`);
    }
  }

  if (problems.length) {
    console.error(`leak-scan: ${problems.length} problem(s) in ${scanned} file(s):\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`leak-scan: clean (${scanned} file(s), ${terms.length} blocklist term(s))`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
