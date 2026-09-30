import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findLeaks, luhn } from './leak-scan.mjs';

// Leak-shaped inputs are assembled at runtime, so this file itself never
// contains a literal card number, email or key for the hook to trip on.
const j = (...parts) => parts.join('');
const CARD = j('4012', '8888', '8888', '1881');
const AMEX = ['3782', '822463', '10005'].join(' ');

test('luhn: a valid card number passes, a one-digit change fails', () => {
  assert.equal(luhn(CARD), true);
  assert.equal(luhn(CARD.slice(0, -1) + '2'), false);
});

test('a real-looking card number is caught; a known test number and a phone are not', () => {
  assert.equal(findLeaks(`Account# ${CARD.match(/.{4}/g).join(' ')}`).length, 1);
  assert.equal(findLeaks('Account# 4111 1111 1111 1111').length, 0);
  assert.equal(findLeaks('Call 1-800-935-9935').length, 0);
  assert.equal(findLeaks('COSTCO WHSE #0187 770-622-1330 GA').length, 0);
  assert.equal(findLeaks(`Amex ${AMEX}`).length, 1);
});

test('emails: example.com is fine, anything else is flagged', () => {
  assert.equal(findLeaks('sam.rivera@example.com').length, 0);
  assert.equal(findLeaks(j('someone', '@', 'gmail.com')).length, 1);
});

test('blocklist terms match case-insensitively', () => {
  assert.equal(findLeaks('Zelle payment to JANE PRIVATE', ['Jane Private']).length, 1);
  assert.equal(findLeaks('Zelle payment to Alex Morgan', ['Jane Private']).length, 0);
});

test('secret shapes are caught', () => {
  assert.equal(findLeaks(j('ANTHROPIC_API_KEY=', 'sk-', 'ant-', 'abcdefghijklmnop')).length, 1);
});

test('lockfiles skip shape checks but still get the blocklist', () => {
  assert.equal(findLeaks(j('"author": "dev', '@', 'gmail.com"'), [], { lockfile: true }).length, 0);
  assert.equal(findLeaks('"name": "jane-private"', ['jane-private'], { lockfile: true }).length, 1);
});

test('an allowed exact string passes; the same term elsewhere is still caught', () => {
  const allow = ['github.com/janeprivate'];
  assert.equal(findLeaks('git clone https://github.com/janeprivate/app.git', ['janeprivate'], { allow }).length, 0);
  assert.equal(findLeaks('Thanks, Jane Private (janeprivate)', ['janeprivate'], { allow }).length, 1);
});
