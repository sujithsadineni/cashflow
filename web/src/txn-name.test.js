import { test } from 'node:test';
import assert from 'node:assert/strict';
import { txnName, tidyDescription } from './txn-name.js';

const z = (description, amount_cents, extra = {}) => txnName({ description, amount_cents, merchant: null, ...extra });

test('Bank of America shape: direction, first name, memo', () => {
  assert.equal(z('Zelle payment from JORDAN MICHAEL LEE for "rent + wifi"; Conf# 99c00abc', 86000), 'From Jordan · rent + wifi');
  assert.equal(z('Zelle payment to Sam Rivera Conf# up3jw8zz9', -10000), 'To Sam');
});

test('Chase shape: the reference number and Jpm code are not part of the name', () => {
  assert.equal(z('Zelle Payment To Sam Rivera Jpm99Atzjdvo', -28000), 'To Sam');
  assert.equal(z('Zelle Payment From Jordan Lee 28281860244', 50000), 'From Jordan');
  assert.equal(z('Zelle® Payment to Sam Rivera', -500), 'To Sam');
});

test("the contact's nickname wins, then the contact's first name", () => {
  assert.equal(z('Zelle payment to SAMANTHA RIVERA Conf# x', -500, { contact_nickname: 'Sammy', contact_name: 'Samantha Rivera' }), 'To Sammy');
  assert.equal(z('Zelle payment to S RIVERA Conf# x', -500, { contact_name: 'Samantha Rivera' }), 'To Samantha');
});

test('a merchant of just "zelle" is replaced; a real merchant is left alone', () => {
  assert.equal(z('Zelle payment to Sam Rivera Conf# x', -500, { merchant: 'zelle' }), 'To Sam');
  assert.equal(txnName({ merchant: 'Costco', description: 'COSTCO WHSE', amount_cents: -100 }), 'Costco');
  assert.equal(txnName({ merchant: null, description: 'SOMETHING ELSE', amount_cents: -100 }), 'Something Else');
});

test('an unnamed bank line is made readable, never saved', () => {
  assert.equal(tidyDescription('TST* HARBOR GRILL RESTAUR SHELBYVILLE NC'), 'Harbor Grill Restaur Shelbyville');
  assert.equal(tidyDescription('TOUS LES JOURS SPRINGFIELD SPRINGFIELD NC'), 'Tous Les Jours Springfield');
  assert.equal(tidyDescription('HUDSON ST1748 OGDENVILLE FL'), 'Hudson Ogdenville');
  assert.equal(tidyDescription('ANNAPURNA EATS LLC SPRINGFIELD NC'), 'Annapurna Eats Springfield');
  assert.equal(tidyDescription('SQ *MUSEUM CAFE - WEST Springfield NC'), 'SQ *MUSEUM CAFE - WEST Springfield NC'.replace('SQ *', '').replace(' NC', ''));
  assert.equal(tidyDescription('Too Good To Go Inc. 7876184541 DE'), 'Too Good To Go');
});
