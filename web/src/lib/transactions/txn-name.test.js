import { test } from 'node:test';
import assert from 'node:assert/strict';
import { txnName, tidyDescription, zelleParts, showsZelleName } from './txn-name.js';

const z = (description, amount_cents, extra = {}) => txnName({ description, amount_cents, merchant: null, ...extra });

test('Bank of America shape: direction, full name, the memo set apart (D396)', () => {
  assert.equal(z('Zelle payment from JORDAN MICHAEL LEE for "rent + wifi"; Conf# 99c00abc', 86000), 'From Jordan Michael Lee — “rent + wifi”');
  assert.equal(z('Zelle payment to Sam Rivera Conf# ab3cd4ef5', -10000), 'To Sam Rivera');
});

test('Chase shape: the reference number and Jpm code are not part of the name', () => {
  assert.equal(z('Zelle Payment To Sam Rivera Jpm99Abcdefg', -28000), 'To Sam Rivera');
  assert.equal(z('Zelle Payment From Jordan Lee 12345678901', 50000), 'From Jordan Lee');
  assert.equal(z('Zelle® Payment to Sam Rivera', -500), 'To Sam Rivera');
});

test("the contact's nickname wins, then the contact's full name", () => {
  assert.equal(z('Zelle payment to SAMANTHA RIVERA Conf# x', -500, { contact_nickname: 'Sammy', contact_name: 'Samantha Rivera' }), 'To Sammy');
  assert.equal(z('Zelle payment to S RIVERA Conf# x', -500, { contact_name: 'Samantha Rivera' }), 'To Samantha Rivera');
});

test('a merchant of just "zelle" is replaced; a real merchant is left alone', () => {
  assert.equal(z('Zelle payment to Sam Rivera Conf# x', -500, { merchant: 'zelle' }), 'To Sam Rivera');
  assert.equal(txnName({ merchant: 'Costco', description: 'COSTCO WHSE', amount_cents: -100 }), 'Costco');
  assert.equal(txnName({ merchant: null, description: 'SOMETHING ELSE', amount_cents: -100 }), 'Something Else');
});

test('a name keeps the capitals it was written with, else gets normal ones; the pieces for a list (D396)', () => {
  assert.equal(z('Zelle payment to DESHAWN MCDONALD Conf# x', -500, { contact_name: 'DeShawn McDonald' }), 'To DeShawn McDonald');
  assert.equal(z("Zelle payment from mary-jane o'neil for \"trip\"; Conf# x", 1900), "From Mary-Jane O'Neil — “trip”");
  assert.deepEqual(zelleParts({ description: 'Zelle payment from JORDAN LEE for "top golf"; Conf# x', amount_cents: 1900 }), { direction: 'From', person: 'Jordan Lee', memo: 'top golf' });
  assert.equal(zelleParts({ description: 'COSTCO WHSE', amount_cents: -100 }), null);
  assert.equal(zelleParts({ description: 'Zelle payment from JORDAN LEE for "OCTOBER RENT"; Conf# x', amount_cents: 1 }).memo, 'October rent', 'a shouted memo in sentence case');
  assert.equal(zelleParts({ description: 'Zelle payment from JORDAN LEE for "Wifi + TV"; Conf# x', amount_cents: 1 }).memo, 'Wifi + TV', 'one typed with care is kept');
  assert.equal(showsZelleName({ description: 'Zelle payment to Sam Rivera', amount_cents: -1, merchant: null }), true);
  assert.equal(showsZelleName({ description: 'Zelle payment to Sam Rivera', amount_cents: -1, merchant: 'Landlord' }), false, 'a name the household gave wins');
});

test('an unnamed bank line is made readable, never saved', () => {
  assert.equal(tidyDescription('TST* HARBOR GRILL RESTAUR SHELBYVILLE NC'), 'Harbor Grill Restaur Shelbyville');
  assert.equal(tidyDescription('TOUS LES JOURS SPRINGFIELD SPRINGFIELD NC'), 'Tous Les Jours Springfield');
  assert.equal(tidyDescription('HUDSON ST1748 OGDENVILLE FL'), 'Hudson Ogdenville');
  assert.equal(tidyDescription('ANNAPURNA EATS LLC SPRINGFIELD NC'), 'Annapurna Eats Springfield');
  assert.equal(tidyDescription('SQ *MUSEUM CAFE - WEST Springfield NC'), 'SQ *MUSEUM CAFE - WEST Springfield NC'.replace('SQ *', '').replace(' NC', ''));
  assert.equal(tidyDescription('Too Good To Go Inc. 7876184541 DE'), 'Too Good To Go');
});

test('an account\'s short label: its nickname, the last four only when the nickname is shared (D353)', async () => {
  const { accountShort } = await import('./txn-name.js');
  assert.deepEqual(accountShort({ account_name: 'Customized Cash Rewards', account_mask: '5108', account_nickname: 'BofA Custom', account_nickname_shared: false }),
    { label: 'BofA Custom', full: 'Customized Cash Rewards ··5108' });
  assert.equal(accountShort({ account_name: 'Zolve Credit Card', account_mask: '5114', account_nickname: 'Zolve', account_nickname_shared: true }).label, 'Zolve ··5114');
  assert.equal(accountShort({ account_name: 'Bilt Blue Card', account_mask: '5102', account_nickname: null }).label, 'Bilt Blue Card ··5102');
});
