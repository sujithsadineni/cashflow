import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loanArt } from './loan-art.js';

test('a known lender lends its colours and wordmark', () => {
  const art = loanArt({ lender: 'Wells Fargo', loan_type: 'car' });
  assert.equal(art.base, '#D71E28');
  assert.equal(art.wordmarkColor, '#FFCD41');
  assert.equal(art.wordmark, 'WELLS FARGO');
  assert.equal(art.kind, 'Auto Loan');
});

test('any other lender takes a quiet colour for the kind of loan', () => {
  const art = loanArt({ lender: 'Northwind Consulting', loan_type: 'other' });
  assert.equal(art.base, '#43365E');
  assert.match(art.deep, /^color-mix\(in srgb, #43365E 55%, black\)$/);
  assert.equal(art.wordmark, 'NORTHWIND CONSULTING');
  assert.equal(art.kind, 'Loan');
  assert.equal(loanArt({ lender: null, loan_type: 'home' }).wordmark, '');
});
