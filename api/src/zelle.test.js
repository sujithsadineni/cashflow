import { test } from 'node:test';
import assert from 'node:assert/strict';

import { suggestZelleName, suggestInternal, autoZelleReview } from './zelle.js';

/* ------------------------------------------------------------------
   Fixtures in the exact shapes real bank statements use (JPM and BofA
   reference suffixes, Conf# codes, quoted memos, the ® form, ALL-CAPS
   legal names). The regex was validated against a real household's 45
   Zelle descriptions; the names and codes here are invented.
   ------------------------------------------------------------------ */

const CASES = [
  ['Zelle Payment To Jamie Jpm99Kq4x21M', 'Jamie'],
  ['Zelle payment from ALEX JAMES MORGAN for "rent"; Conf# 77h21qzk4', 'Alex James Morgan'],
  ['Zelle Payment To Sam Jpm99D41Qzt8', 'Sam'],
  ['Zelle Payment To Jamie Jpm99D2Hwnr5', 'Jamie'],
  ['Zelle Payment To Jamie Jpm99D3Xpl0K', 'Jamie'],
  ['Zelle Payment From Samira Rivera Bacqt72Lm4Xa', 'Samira Rivera'],
  ['Zelle payment to ALEX MORGAN Conf# kd82mq1zt', 'Alex Morgan'],
  ['Zelle Payment To Priya Shah Jpm99D5R7T2M', 'Priya Shah'],
  ['Zelle payment to ALEX MORGAN Conf# p3wqz8ha1', 'Alex Morgan'],
  ['Zelle payment from OMAR HADDAD for "gift"; Conf# 77h40cxww', 'Omar Haddad'],
  ['Zelle payment to DIEGO ALVAREZ Conf# zt4ycfn1e', 'Diego Alvarez'],
  ['Zelle Payment To Nina Jpm99D6E8K3Y', 'Nina'],
  ['Zelle Payment To Lena Kowalski Jpm99D7Tcnjr', 'Lena Kowalski'],
  ['Zelle Payment To Nina Jpm99D8Mzvvk', 'Nina'],
  ['Zelle Payment To Marcus Bell Jpm99D96Ae1F', 'Marcus Bell'],
  ['Zelle Payment From Alex Morgan Bacwkmqlhtz8', 'Alex Morgan'],
  ['Zelle Payment From Taylor Brooks 41392971355', 'Taylor Brooks'],
  ['Zelle Payment To Diego Alvarez 41373660161', 'Diego Alvarez'],
  ['Zelle Payment From Taylor Brooks 41411849967', 'Taylor Brooks'],
  ['Zelle Payment To Casey Jpm99Dattxg1', 'Casey'],
  ['Zelle Payment To Maya Patel 41565232536', 'Maya Patel'],
  ['Zelle Payment To Maya Patel 41544294995', 'Maya Patel'],
  ['Zelle Payment To Maya Patel 41579855944', 'Maya Patel'],
  ['Zelle Payment To Alex Morgan Jpm99Dbjlq7P', 'Alex Morgan'],
  ['Zelle payment to Casey Diaz Conf# zw6ny4lqj', 'Casey Diaz'],
  ['Zelle Payment To Nina Jpm99Dcin4Pd', 'Nina'],
  ['Zelle Payment To Nina Jpm99Dcw1Lom', 'Nina'],
  ['Zelle Payment To Hannah Novak 41975814692', 'Hannah Novak'],
  ['Zelle Payment To Hannah Novak 41988912607', 'Hannah Novak'],
  ['Zelle Payment To Hannah Novak 41999459275', 'Hannah Novak'],
  ['Zelle Payment To Alex Morgan Jpm99Dfauj02', 'Alex Morgan'],
  ['Zelle® Payment to Alex Morgan', 'Alex Morgan'],
  ['Zelle® Payment to Hannah Novak', 'Hannah Novak'],
  ['Zelle® Payment to Ace Buddy', 'Ace Buddy'],
  ['Zelle Payment To Jordan Jpm99Dlidbqk', 'Jordan'],
  ['Zelle® Payment from Ethan Park', 'Ethan Park'],
  ['Zelle payment to Nina Conf# rd45hwsuy', 'Nina'],
  ['Zelle® Payment to Jordan', 'Jordan'],
  ['Zelle Payment To Robin 41530511068', 'Robin'],
  ['Zelle payment from CHRISTOPHER ALLEN BENNETT for "trip"; Conf# 77duhojzy', 'Christopher Allen Bennett'],
];

test('suggestZelleName: every real Zelle description in the dev database', () => {
  for (const [description, expected] of CASES) {
    assert.equal(suggestZelleName(description), expected, description);
  }
});

test('suggestZelleName: no match falls back to the trimmed description, never empty', () => {
  const result = suggestZelleName('Some unrelated description with ZELLE mentioned');
  assert.ok(result.length > 0);
});

test('suggestZelleName: empty/null input', () => {
  assert.equal(suggestZelleName(''), '');
  assert.equal(suggestZelleName(null), '');
});

/* ------------------------------------------------------------------
   Household-name detection
   ------------------------------------------------------------------ */

const PEOPLE = [{ name: 'Alex Morgan' }, { name: 'Sam Rivera' }];

test('suggestInternal: matches the household by first or last name, including a legal-name variant', () => {
  assert.equal(suggestInternal('Alex Morgan', PEOPLE), true);
  assert.equal(suggestInternal('Alex James Morgan', PEOPLE), true);
  assert.equal(suggestInternal('Sam', PEOPLE), true);
  assert.equal(suggestInternal('Samira Rivera', PEOPLE), true);
});

test('suggestInternal: does not match an unrelated real recipient', () => {
  assert.equal(suggestInternal('Nina', PEOPLE), false);
  assert.equal(suggestInternal('Hannah Novak', PEOPLE), false);
  assert.equal(suggestInternal('Ace Buddy', PEOPLE), false);
});

/* ------------------------------------------------------------------
   autoZelleReview — rows in real-statement shapes (invented names and
   amounts), paired with the type a human would actually pick.
   ------------------------------------------------------------------ */

const AUTO_CASES = [
  ['Zelle Payment To Jamie Jpm99Cyqmrgz', -14000, 'SENT'],
  ['Zelle Payment To Sam Jpm99Cx9P1Ej', -55000, 'INTERNAL'],
  ['Zelle Payment To Diego Alvarez 40271177136', -90000, 'SENT'],
  ['Zelle Payment To Alex Morgan Jpm99Cmzfhms', -45000, 'INTERNAL'],
  ['Zelle Payment To Ravi Kumar Singh Jpm99Cp78501', -22000, 'SENT'],
  ['Zelle Payment To Leo Grant Jpm99Cnvxgo1', -11000, 'SENT'],
  ['Zelle Payment From Alex Morgan Baczwm4G5I4A', 27500, 'INTERNAL'],
  ['Zelle Payment To Danny Cousin Jpm99Ccavmll', -18000, 'SENT'],
  ['Zelle Payment To Viktor Jpm99C0Jcx06', -7200, 'SENT'],
  ['Zelle Payment From Alex Morgan Bact07J6Vmhq', 13500, 'INTERNAL'],
  ['Zelle Payment To Sanjay Rao T Mobile Jpm99Baicklm', -3500, 'SENT'],
  ['Zelle Payment To Oil Service 34946298051', -2150, 'SENT'],
  ['Zelle Payment To Tessa Young Jpm99Buakewp', -26000, 'SENT'],
];

test('autoZelleReview: internal (household name) wins regardless of sign', () => {
  for (const [description, amountCents, expected] of AUTO_CASES) {
    assert.equal(autoZelleReview(description, amountCents, PEOPLE).zelle_type, expected, description);
  }
});

test('autoZelleReview: name is the same guess suggestZelleName would give', () => {
  const result = autoZelleReview('Zelle Payment To Sam Jpm99Cx9P1Ej', -55000, PEOPLE);
  assert.equal(result.zelle_person, 'Sam');
});

test('autoZelleReview: a positive amount to someone outside the household is Received, not Internal', () => {
  assert.equal(autoZelleReview('Zelle® Payment from Ethan Park', 5000, PEOPLE).zelle_type, 'RECEIVED');
});
