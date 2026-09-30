import { test } from 'node:test';
import assert from 'node:assert/strict';

import { robinhoodCategoryFor } from './robinhood-category.js';

test('"Robinhood Debits" is Investment', () => {
  assert.deepEqual(
    robinhoodCategoryFor('Robinhood Debits 531595957 Web ID: 5326394001'),
    { category: 'Investment', txn_type: 'transfer' }
  );
});

test('the checking-statement twin of the same company ID is also Investment', () => {
  assert.deepEqual(
    robinhoodCategoryFor('ROBINHOOD DES:DEBITS ID:XXXXXXXXX INDN:Alex james Morgan CO ID:5326394001 WEB'),
    { category: 'Investment', txn_type: 'transfer' }
  );
});

test('"Robinhood Securities" wire transfer is Investment', () => {
  assert.deepEqual(
    robinhoodCategoryFor('Online Realtime Payment To Robinhood Securities Transaction#:6391493 Reference#:7006391493Rx'),
    { category: 'Investment', txn_type: 'transfer' }
  );
});

test('"Robinhood Money ... Payment" is a different, already-correct pattern (Savings) — left alone', () => {
  assert.equal(robinhoodCategoryFor('Robinhood Money Payment PPD ID: 1823032817'), null);
  assert.equal(
    robinhoodCategoryFor('Robinhood Money DES:Payment ID: INDN:ALEX JAMES MORGAN CO ID:1823032817 PPD'),
    null
  );
});

test('a Robinhood Gold Card purchase never mentions "Robinhood" in its own description — unaffected', () => {
  assert.equal(robinhoodCategoryFor('GOLD ANNUAL SUBSCRIPTIO'), null);
});

test('an unrelated description is left alone', () => {
  assert.equal(robinhoodCategoryFor('COSTCO WHSE #0187 770-622-1330 GA'), null);
});

test('null/empty description does not throw', () => {
  assert.equal(robinhoodCategoryFor(null), null);
  assert.equal(robinhoodCategoryFor(''), null);
});
