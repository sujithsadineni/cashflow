import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflowType } from './inflow-type.js';

test('card rewards are cashback', () => {
  for (const d of [
    'FOOD LION 7777 SPRINGFIELD - Amex Offer Credit',
    'DISNEYPLUS - $120 Disney Streaming Credit',
    'Redeem Cash Back at Amazon.com Credit',
    'BANKAMERIDEALS CASHBACK',
    'DEALS CASHBACK',
    'YOUR CASH REWARD/REFUND IS ALEX MORGAN',
    'Offer: Grocery Offer',
  ]) assert.equal(inflowType(d), 'cashback', d);
});

test('a merchant giving money back is a refund', () => {
  for (const d of ['FRONTIER AIRLINES 720-5550 CREDIT', 'HM.COM 855-5550 CREDIT', 'RETURN TARGET 00021', 'MERCHANDISE RETURN', 'AMAZON MKTPL REFUND']) {
    assert.equal(inflowType(d), 'refund', d);
  }
});
