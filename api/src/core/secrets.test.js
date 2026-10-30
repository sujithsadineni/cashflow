import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { encrypt, decrypt, fingerprint } from './secrets.js';

const key = randomBytes(32);

test('a secret comes back as it went in, and reads as nothing like it', () => {
  const sealed = encrypt('open-sesame', key);
  assert.ok(!sealed.includes('open-sesame'));
  assert.equal(decrypt(sealed, key), 'open-sesame');
  assert.notEqual(encrypt('open-sesame', key), sealed, 'a fresh IV each time');
});

test('another key cannot read it, and a changed byte is refused', () => {
  const sealed = encrypt('open-sesame', key);
  assert.throws(() => decrypt(sealed, randomBytes(32)));
  const [iv, tag, body] = sealed.split('.');
  const flipped = Buffer.from(body, 'base64'); flipped[0] ^= 1;
  assert.throws(() => decrypt([iv, tag, flipped.toString('base64')].join('.'), key));
});

test('the same password has one fingerprint', () => {
  assert.equal(fingerprint('a', key), fingerprint('a', key));
  assert.notEqual(fingerprint('a', key), fingerprint('b', key));
});
