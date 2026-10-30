import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memberSince } from './member-since.js';

test('reads the opening date the way statements print it (D393)', () => {
  assert.equal(memberSince('Primary Account Holder  Member since Mar 24, 2026  Monthly Statement Period'), '2026-03-24');
  assert.equal(memberSince('MEMBER SINCE: 03/04/2021'), '2021-03-04');
  assert.equal(memberSince('Customer since September 2019'), '2019-09-01');
  assert.equal(memberSince('Cardmember Since 2015'), '2015-01-01', 'a year alone is its first day');
  assert.equal(memberSince('Account opened on 2024-11-02'), '2024-11-02');
});

test('nothing printed, or nothing that is a date, reads as nothing', () => {
  assert.equal(memberSince(''), null);
  assert.equal(memberSince(null), null);
  assert.equal(memberSince('Payment due date Mar 24, 2026'), null, 'another date is not the opening one');
  assert.equal(memberSince('Member since Feb 30, 2026'), null, 'not a real day');
  assert.equal(memberSince('member since our founding'), null);
});
