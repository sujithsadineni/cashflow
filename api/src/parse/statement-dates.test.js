import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractStatementDates } from './statement-dates.js';

// Invented statements in each issuer's layout (D155: no household data in tests).
const read = (text, periodEnd, owedCents) => extractStatementDates([{ text }], { periodEnd, owedCents });

test('the label and the value on one line (Amex, Bank of America)', () => {
  const amex = 'Closing Date 03/24/26\nNew Balance $512.40\nMinimum Payment Due $40.00\nPayment Due Date 04/19/26\nAccount Summary';
  assert.deepEqual(read(amex, '2026-03-24', 51240), { payment_due_date: '2026-04-19', minimum_payment_cents: 4000 });
  const bofa = '$ 120.00 Total Minimum Payment Due -$ 500.00\nPayment Due Date 04/10/2026 $ 87.66 Purchases and Adjustments\nStatement Closing Date 03/13/2026';
  assert.deepEqual(read(bofa, '2026-03-13', 900000), { payment_due_date: '2026-04-10', minimum_payment_cents: 12000 });
});

test('a colon, and the date before its label (Barclays); a scheduled-autopay date is not the due date', () => {
  const text = 'Payments - Thank You - $300.00 Minimum Payment Due: $98.80\nBalance Transfers + $5,000.00 Payment Due Date: 05/02/26\nYour minimum payment of $98.80 is scheduled to be paid on 04/30/26.';
  assert.deepEqual(read(text, '2026-04-05', 588000), { payment_due_date: '2026-05-02', minimum_payment_cents: 9880 });
});

test('a written-out date (Robinhood)', () => {
  const text = 'Minimum Payment Due $25.00\nStatement Closing Date March 24, 2026\nPayment Due Date April 17, 2026\nDays in Billing Cycle 30';
  assert.deepEqual(read(text, '2026-03-24', 40000), { payment_due_date: '2026-04-17', minimum_payment_cents: 2500 });
});

test('the label in one column and its value lines later (Bilt)', () => {
  const text = 'Minimum payment due Payment information\nGo to the app to schedule payments\n$30.00\nPayment due by Account summary\nCredit limit $10,000.00\nApr 6, 2026';
  assert.deepEqual(read(text, '2026-03-11', 145400), { payment_due_date: '2026-04-06', minimum_payment_cents: 3000 });
});

test('a table row under a header (Apple): the minimum is in its column, not the balance', () => {
  const text = 'Your March Balance Minimum Payment\nas of Mar 31, 2026 Payment Due Due By\n$122.69 $25.00 Apr 30, 2026';
  assert.deepEqual(read(text, '2026-03-31', 12269), { payment_due_date: '2026-04-30', minimum_payment_cents: 2500 });
});

test('"$" printed as a control character, values two lines on (Zolve)', () => {
  const text = 'Previous Balance $299.99 New Balance Minimum Payment Due Payment Due Date\n- Payments $299.99\n\u0000 7.75 \u0000 7.75 04/14/2026';
  assert.deepEqual(read(text, '2026-03-17', 775), { payment_due_date: '2026-04-14', minimum_payment_cents: 775 });
});

test('a summary amount before the label is not the minimum, nor a fitting line before its column (Zolve, to June 2026)', () => {
  const text = 'Previous Balance $50.00\nPayments $1,300.00 New Balance Payment Due Date Minimum Payment Due\nOther Credits $0.00\n$700.00 11/10/2025 $90.00\nPurchases $1,950.00';
  assert.deepEqual(read(text, '2025-10-14', 70000), { payment_due_date: '2025-11-10', minimum_payment_cents: 9000 });
  const credit = 'Payments $500.00 New Balance Payment Due Date Minimum Payment Due\nOther Credits $0.00\n($180.00) 08/10/2025 $0.00';
  assert.deepEqual(read(credit, '2025-07-14', -18000), { payment_due_date: '2025-08-10', minimum_payment_cents: 0 });
});

test('summary amounts sharing the table\'s lines are not its cells (Zolve)', () => {
  const b = 'New Balance Payment Due Date Minimum Payment Due\nOther Credits $0.00 $68.00 05/10/2026 $25.00\nPurchases $68.00';
  assert.deepEqual(read(b, '2026-04-14', 6800), { payment_due_date: '2026-05-10', minimum_payment_cents: 2500 });
  const a = 'Previous Balance $7.00 New Balance Minimum Payment Due Payment Due Date\n- Payments $7.00\n\u0000 500.00 \u0000 25.00 10/14/2026';
  assert.deepEqual(read(a, '2026-09-17', 50000), { payment_due_date: '2026-10-14', minimum_payment_cents: 2500 });
});

test('nothing that fits is null, never a guess', () => {
  assert.deepEqual(read('Statement Period 03/06/26 - 04/05/26\nPayment Due Date', '2026-04-05', 1000), { payment_due_date: null, minimum_payment_cents: null });
  assert.deepEqual(read('Payment Due Date 04/10/26', null, null).payment_due_date, null, 'no closing date to check it against');
});
