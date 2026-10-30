import { test } from 'node:test';
import assert from 'node:assert/strict';

import { redactPan } from './redact.js';

test('redacts a plain unbroken PAN', () => {
  assert.equal(redactPan('Card ending 4111111111111111 was used'), 'Card ending [redacted] was used');
});

test('redacts a space-grouped PAN, the real-world case a plain digit-run regex misses', () => {
  assert.equal(redactPan('Account# 4111 2222 3333 2468'), 'Account# [redacted]');
});

test('redacts a hyphen-grouped PAN', () => {
  assert.equal(redactPan('4111-2222-3333-2468'), '[redacted]');
});

test('does not touch a phone number', () => {
  assert.equal(redactPan('Call 555-010-0199 for support'), 'Call 555-010-0199 for support');
});

test('does not touch a ZIP+4', () => {
  assert.equal(redactPan('Anytown NC 27000-0002'), 'Anytown NC 27000-0002');
});

test('does not touch a 12-digit checking account number', () => {
  assert.equal(redactPan('Account number: 4000 1234 5678'), 'Account number: 4000 1234 5678');
});

test('does not touch an ordinary dollar amount', () => {
  assert.equal(redactPan('Total: $1,234.56'), 'Total: $1,234.56');
});

test('passes through null', () => {
  assert.equal(redactPan(null), null);
});
