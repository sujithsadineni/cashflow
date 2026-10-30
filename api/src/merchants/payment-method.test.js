import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPaymentMethod, paidWith, PAYMENT_METHOD_KEYS } from './payment-method.js';

// Each bank's real wording; merchants and places invented.
const town = { town: 'Anytown', state: 'TX' };

test('wallets and named services, from the line or the description', () => {
  assert.equal(readPaymentMethod({ raw: 'AplPay PARKING INC   ANYTOWN   IL', description: 'AplPay PARKING INC', txn_type: 'purchase', place: town }), 'apple_pay');
  assert.equal(readPaymentMethod({ description: 'AplPay CORNER STORE', txn_type: 'refund' }), 'apple_pay');
  assert.equal(readPaymentMethod({ description: 'SAMSUNG PAY TACO STAND', txn_type: 'purchase' }), 'samsung_pay');
  assert.equal(readPaymentMethod({ description: 'PAYPAL *BOOKSHOP', txn_type: 'purchase', place: { online: true } }), 'paypal', 'PayPal over plain online');
  assert.equal(readPaymentMethod({ description: 'Zelle payment to A Friend Conf# 123', txn_type: 'transfer' }), 'zelle');
});

test('a purchase without a wallet: online, or in person (tap, chip and swipe are never printed)', () => {
  assert.equal(readPaymentMethod({ description: 'BOOKSHOP.COM', txn_type: 'purchase', place: { online: true } }), 'online');
  assert.equal(readPaymentMethod({ description: 'TACO STAND 3267 ANYTOWN TX', txn_type: 'purchase', place: town }), 'in_person');
  assert.equal(readPaymentMethod({ description: 'TACO STAND', txn_type: 'purchase', place: null }), null);
  assert.equal(readPaymentMethod({ description: 'STREAMING CO BURBANK CA', txn_type: 'purchase', place: { town: 'Burbank', state: 'CA' }, billed: true }), 'online', 'a subscription is billed, not bought in person');
});

test('card payments and bank moves', () => {
  const pay = (description) => readPaymentMethod({ description, txn_type: 'payment' });
  assert.equal(pay('AUTOPAY PAYMENT RECEIVED - THANK YOU'), 'autopay', 'autopay before "payment received"');
  assert.equal(pay('MOBILE PAYMENT - THANK YOU'), 'app');
  assert.equal(pay('ONLINE/MOBILE PAYMENT CONF#M1'), 'app');
  assert.equal(pay('ONLINE BANKING PAYMENT TO CRD 5108'), 'app');
  assert.equal(pay('BILL PAYMENT FROM BANK'), 'bill_pay');
  assert.equal(pay('ATM PAYMENT   ANYTOWN   TX'), 'atm');
  assert.equal(pay('AMERICAN EXPRESS DES:ACH PMT ID:123'), 'ach');
  assert.equal(pay('ELECTRONIC PAYMENT RECEIVED-THANK'), 'ach');
  assert.equal(pay('PAYMENT'), null);
  const move = (description) => readPaymentMethod({ description, txn_type: 'transfer' });
  assert.equal(move('DIRECT DEPOSIT   SOME BANK'), 'ach');
  assert.equal(move('10/01 ONLINE REALTIME PAYMENT TO A BROKER'), 'ach');
  assert.equal(move('A BANK ACCTVERIFY'), 'ach');
  assert.equal(move('DEBIT ADJUSTMENT'), null, 'an adjustment is no way of paying');
  assert.equal(readPaymentMethod({ description: 'ATM CASH DEPOSIT 1/2 MAIN ST', txn_type: 'deposit' }), 'atm');
  assert.equal(readPaymentMethod({ description: 'WIRE TYPE:INTL IN', txn_type: 'deposit' }), 'wire');
});

test('"ATM" and "check" only count on money moves, not purchases', () => {
  assert.equal(readPaymentMethod({ description: 'ATM SNACKS', txn_type: 'purchase', place: town }), 'in_person');
});

test('a person\'s pick wins; the statement\'s stays known', () => {
  assert.deepEqual(paidWith('tap', { description: 'TACO STAND', txn_type: 'purchase', place: town }), { key: 'tap', label: 'Tap', source: 'you', read: 'in_person' });
  assert.deepEqual(paidWith(null, { description: 'AplPay CAFE', txn_type: 'purchase' }), { key: 'apple_pay', label: 'Apple Pay', source: 'statement', read: 'apple_pay' });
  assert.equal(paidWith(null, { description: 'CAFE', txn_type: 'purchase' }), null);
  assert.equal(new Set(PAYMENT_METHOD_KEYS).size, PAYMENT_METHOD_KEYS.length);
});
