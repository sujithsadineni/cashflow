import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bankLabel, billGroupText, linkedDisplay, needsAttention, paymentExplanation, paymentName, targetName } from './payment-source.js';

const sofi = { account_id: 8, account_name: 'Checking Account', account_type: 'CHECKING', issuer: 'SoFi', mask: '5506', accounts_at_bank: 1 };
const bofa = { account_id: 11, account_name: 'Adv SafeBalance Banking', account_type: 'CHECKING', issuer: 'Bank of America', mask: '5508', accounts_at_bank: 2 };

test('the bank gets its account number only when there is more than one there', () => {
  assert.equal(bankLabel(sofi), 'SoFi');
  assert.equal(bankLabel(bofa), 'Bank of America ···5508');
});

test('a verified payment is named for its bank; an unverified one keeps its own name and asks for attention', () => {
  const verified = { status: 'verified', bank: { ...sofi, posted_date: '2026-08-18', description: 'AMEX EPAYMENT ACH PMT' } };
  assert.equal(paymentName(verified), 'Paid by SoFi checking');
  assert.equal(paymentName({ status: 'verified', bank: bofa }), 'Paid by Bank of America checking ···5508');
  assert.equal(paymentName({ status: 'unverified', reason: 'no_match' }), null);
  assert.equal(needsAttention({ payment_source: { status: 'unverified' } }), true);
  assert.equal(needsAttention({ payment_source: verified }), false);
  assert.equal(needsAttention({ payment_source: null }), false);
  assert.equal(paymentExplanation(verified, '2026-08-17').lines[0], 'Checking Account ···5506 sent the same amount on Aug 18, 1 day later.');
});

test('statement missing says which bank, where its statements end, and what to upload', () => {
  const e = paymentExplanation({ status: 'unverified', reason: 'statement_missing', likely: sofi, covered_from: '2026-03-24', covered_until: '2026-08-31', window: { from: '2026-09-12', to: '2026-09-23' } }, '2026-09-18');
  assert.equal(e.verified, false);
  assert.deepEqual(e.lines, [
    'This most likely came from SoFi, but its statements in the app end Aug 31.',
    "Upload the SoFi statement that starts Sep 1. It's checked again automatically, and this turns verified once the payment is found.",
  ]);
});

test("the bank side reads as paying off the card, with the card issuer's logo", () => {
  const target = { status: 'verified', card: { account_name: 'Blue Cash Preferred', issuer: 'American Express', mask: '5507', posted_date: '2026-03-17', description: 'MOBILE PAYMENT - THANK YOU', accounts_with_name: 1 } };
  assert.equal(targetName(target), 'Paid off your Blue Cash Preferred');
  assert.equal(targetName({ ...target, card: { ...target.card, account_name: 'Zolve Credit Card', mask: '5509', accounts_with_name: 2 } }), 'Paid off your Zolve Credit Card ···5509');
  assert.deepEqual(linkedDisplay({ payment_source: null, payment_target: target }), { name: 'Paid off your Blue Cash Preferred', logo: 'American Express', zelle: false, link: target });
  assert.equal(paymentExplanation(null, '2026-03-17', target).title, 'Verified: paid off your Blue Cash Preferred');
  assert.equal(linkedDisplay({ payment_source: null, payment_target: null }), null);
});

test('before the first statement, it says where they start; bank bills say which card statement to upload', () => {
  const e = paymentExplanation({ status: 'unverified', reason: 'statement_missing', likely: sofi, covered_from: '2026-03-24', covered_until: '2026-08-31', window: { from: '2025-12-24', to: '2026-01-04' } }, '2025-12-30');
  assert.equal(e.lines[0], 'This most likely came from SoFi, but its statements in the app start Mar 24, 2026.');
  assert.equal(e.lines[1], "Upload the SoFi statement covering Dec 30. It's checked again automatically, and this turns verified once the payment is found.");
  const g = billGroupText({ reason: 'card_statement_missing', card: { name: 'Apple Card' }, month: '2025-10', count: 1, covered_from: '2026-01-01', covered_until: '2026-08-31' });
  assert.equal(g.title, 'Apple Card: statement for October 2025 missing');
  const other = billGroupText({ reason: 'not_on_card', card: null, candidates: ['Blue Cash Preferred', 'Blue Cash Everyday'], issuer: 'American Express', month: '2026-06', count: 1 });
  assert.equal(other.title, 'Paid to another American Express card?');
  assert.equal(other.lines[0].startsWith('Blue Cash Preferred and Blue Cash Everyday are covered for June 2026'), true);
});

test('paid by a person, in cash, by hand, or named by the card (D200)', () => {
  const person = { status: 'verified', via: 'person', person: 'Alex', part_count: 2 };
  assert.equal(paymentName(person), 'Paid by Alex');
  assert.equal(linkedDisplay({ payment_source: person }).zelle, true);
  assert.equal(paymentExplanation(person, '2026-08-04').lines[0], 'Alex paid this, and was paid back by Zelle in 2 parts adding up to it, within a few days.');
  assert.equal(paymentName({ status: 'verified', via: 'cash', location: 'Riverton, NC' }), 'Paid in cash at an ATM · Riverton, NC');
  assert.equal(paymentName({ status: 'verified', via: 'outside', label: 'Robinhood' }), 'Paid from Robinhood');
  const named = { status: 'named', via: 'statement', reason: 'statement_missing', likely: { ...bofa, mask: '5504' }, covered_from: '2025-12-17', covered_until: '2026-09-16', window: { from: '2025-03-04', to: '2025-03-15' } };
  assert.equal(paymentName(named), 'Paid by Bank of America checking ···5504');
  assert.equal(needsAttention({ payment_source: named }), false);
  const e = paymentExplanation(named, '2025-03-10');
  assert.equal(e.named, true);
  assert.equal(e.lines[1], 'To confirm it, upload Bank of America checking ···5504’s statement covering Mar 10. Its statements in the app start Dec 17, 2025.');
});

test('a Zelle that paid someone back reads as that, on the bank side', () => {
  const target = { status: 'verified', via: 'person', person: 'Alex', part_count: 2, card: { account_name: 'Customized Cash Rewards', issuer: 'BOFA', mask: '5501', posted_date: '2026-08-04', description: 'BA ELECTRONIC PAYMENT', accounts_with_name: 1 } };
  assert.equal(targetName(target), 'Alex paid your Customized Cash Rewards');
  assert.equal(paymentExplanation(null, '2026-08-05', target).lines[0], 'Alex paid Customized Cash Rewards ···5501 on Aug 4, and 2 Zelles to them add up to it.');
});
