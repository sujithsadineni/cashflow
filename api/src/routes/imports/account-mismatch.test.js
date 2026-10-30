import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statementMismatch } from './account.js';

const apple = { name: 'Apple Card', issuer: 'Goldman Sachs Bank USA', account_type: 'CREDIT_CARD' };
const bofaChecking = { name: 'Adv SafeBalance', issuer: 'Bank of America', account_type: 'CHECKING' };

test('a bank statement is never quietly attached to a card, nor one bank\'s to another\'s', () => {
  const bofa = { detected_issuer: 'Bank of America', detected_account_type: 'CHECKING' };
  assert.match(statementMismatch(bofa, apple), /Bank of America account statement, and Apple Card is a credit card/);
  assert.equal(statementMismatch(bofa, bofaChecking), null);
  assert.equal(statementMismatch({ detected_issuer: 'Bank of America, N.A.', detected_account_type: 'SAVINGS' }, bofaChecking), null, 'same bank, both bank accounts');
  assert.match(statementMismatch({ detected_issuer: 'Chase', detected_account_type: 'CHECKING' }, bofaChecking), /from Chase/);
  assert.equal(statementMismatch({ detected_issuer: null, detected_account_type: null }, apple), null, 'a CSV says nothing: the person decides');
  assert.equal(statementMismatch({ detected_issuer: 'Goldman Sachs Bank USA', detected_account_type: 'CREDIT_CARD' }, apple), null);
});
