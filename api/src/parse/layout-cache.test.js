import { test } from 'node:test';
import assert from 'node:assert/strict';

import { guessIssuerFromPageOne } from './layout-cache.js';

test('does not misdetect "purchase(s)" as Chase — plain substring matching used to', () => {
  assert.equal(guessIssuerFromPageOne('Purchases (Including New Card Purchases)'), null);
  assert.equal(guessIssuerFromPageOne('Bilt Blue Card\nCardless Inc. is the servicer'), 'bilt');
});

test('still matches a real Chase reference correctly', () => {
  assert.equal(guessIssuerFromPageOne('JPMorgan Chase Bank, N.A.'), 'chase');
});

test('bilt is matched over its servicer "Cardless" when both appear', () => {
  assert.equal(guessIssuerFromPageOne('Bilt Blue Card. Cardless Inc. is the servicer of the Bilt Cards.'), 'bilt');
});

test('no known issuer mentioned returns null, not a false positive', () => {
  assert.equal(guessIssuerFromPageOne('Fidelity Rewards Visa statement'), null);
});

test('Robinhood is known, but a statement from another bank that mentions it stays that bank', () => {
  assert.equal(guessIssuerFromPageOne('Questions? Contact support via the Robinhood Banking app'), 'robinhood');
  assert.equal(guessIssuerFromPageOne('Chase Total Checking\n12/26 Robinhood Debits 892655044'), 'chase');
});

test('Barclays is known, and a "Barclaycard" payment line elsewhere is not Barclays', () => {
  assert.equal(guessIssuerFromPageOne('Download the Barclays US App for fast,'), 'barclays');
  assert.equal(guessIssuerFromPageOne('Some Bank statement\nBARCLAYCARD US CREDITCARD 123'), null);
});
