import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseAmountToCents,
  parseDateToISO,
  parseCsvRecords,
  sniffHeader,
  parseStatementCsv,
} from './csv.js';

/* ------------------------------------------------------------------
   Amounts
   ------------------------------------------------------------------ */

test('amount: plain decimals', () => {
  assert.deepEqual(parseAmountToCents('12.34'), { ok: true, cents: 1234 });
  assert.deepEqual(parseAmountToCents('-50.00'), { ok: true, cents: -5000 });
  assert.deepEqual(parseAmountToCents('0.07'), { ok: true, cents: 7 });
});

test('amount: currency symbols, thousands separators, whitespace', () => {
  assert.deepEqual(parseAmountToCents('$1,234.56'), { ok: true, cents: 123456 });
  assert.deepEqual(parseAmountToCents(' $ 2,000 '), { ok: true, cents: 200000 });
  assert.deepEqual(parseAmountToCents('-$97.27'), { ok: true, cents: -9727 });
});

test('amount: parentheses mean negative', () => {
  assert.deepEqual(parseAmountToCents('(84.32)'), { ok: true, cents: -8432 });
  assert.deepEqual(parseAmountToCents('($1,000.00)'), { ok: true, cents: -100000 });
});

test('amount: trailing minus and leading plus', () => {
  assert.deepEqual(parseAmountToCents('84.32-'), { ok: true, cents: -8432 });
  assert.deepEqual(parseAmountToCents('+15.00'), { ok: true, cents: 1500 });
});

test('amount: single decimal digit means tens of cents', () => {
  assert.deepEqual(parseAmountToCents('1.5'), { ok: true, cents: 150 });
});

test('amount: no decimal part means whole dollars', () => {
  assert.deepEqual(parseAmountToCents('3000'), { ok: true, cents: 300000 });
});

test('amount: values floats would mangle', () => {
  // 4.56 * 100 === 455.99999999999994 in floating point
  assert.deepEqual(parseAmountToCents('4.56'), { ok: true, cents: 456 });
  assert.deepEqual(parseAmountToCents('1234567.89'), { ok: true, cents: 123456789 });
});

test('amount: garbage is rejected, never guessed', () => {
  assert.equal(parseAmountToCents('').ok, false);
  assert.equal(parseAmountToCents('  ').ok, false);
  assert.equal(parseAmountToCents('N/A').ok, false);
  assert.equal(parseAmountToCents('12.345').ok, false);   // three decimal places
  assert.equal(parseAmountToCents('12.34.56').ok, false);
  assert.equal(parseAmountToCents(null).ok, false);
  assert.equal(parseAmountToCents(undefined).ok, false);
});

/* ------------------------------------------------------------------
   Dates
   ------------------------------------------------------------------ */

test('date: MM/DD/YYYY and single digits', () => {
  assert.deepEqual(parseDateToISO('03/26/2026'), { ok: true, iso: '2026-03-26' });
  assert.deepEqual(parseDateToISO('4/1/2026'), { ok: true, iso: '2026-04-01' });
});

test('date: ISO YYYY-MM-DD passes through', () => {
  assert.deepEqual(parseDateToISO('2026-04-01'), { ok: true, iso: '2026-04-01' });
  assert.deepEqual(parseDateToISO('2026-4-1'), { ok: true, iso: '2026-04-01' });
});

test('date: two-digit years pivot at 50', () => {
  assert.deepEqual(parseDateToISO('03/26/26'), { ok: true, iso: '2026-03-26' });
  assert.deepEqual(parseDateToISO('03/26/74'), { ok: true, iso: '1974-03-26' });
});

test('date: dashes work like slashes', () => {
  assert.deepEqual(parseDateToISO('03-26-2026'), { ok: true, iso: '2026-03-26' });
});

test('date: impossible dates are rejected', () => {
  assert.equal(parseDateToISO('02/30/2026').ok, false);
  assert.equal(parseDateToISO('13/01/2026').ok, false);
  assert.equal(parseDateToISO('00/10/2026').ok, false);
});

test('date: garbage is rejected', () => {
  assert.equal(parseDateToISO('').ok, false);
  assert.equal(parseDateToISO('yesterday').ok, false);
  assert.equal(parseDateToISO('2026').ok, false);
  assert.equal(parseDateToISO(null).ok, false);
});

/* ------------------------------------------------------------------
   CSV records
   ------------------------------------------------------------------ */

test('csv: quoted fields keep their commas', () => {
  const records = parseCsvRecords('a,"b, with comma",c\n1,2,3');
  assert.deepEqual(records, [['a', 'b, with comma', 'c'], ['1', '2', '3']]);
});

test('csv: escaped quotes and CRLF endings', () => {
  const records = parseCsvRecords('name\r\n"say ""hi"""\r\n');
  assert.deepEqual(records, [['name'], ['say "hi"']]);
});

test('csv: blank lines are dropped', () => {
  const records = parseCsvRecords('a,b\n\n1,2\n\n');
  assert.deepEqual(records, [['a', 'b'], ['1', '2']]);
});

/* ------------------------------------------------------------------
   Header sniffing
   ------------------------------------------------------------------ */

test('header: common variants map to roles', () => {
  assert.deepEqual(sniffHeader(['Date', 'Description', 'Amount']), {
    date: 0, description: 1, amount: 2,
  });
  assert.deepEqual(sniffHeader(['Transaction Date', 'Payee', 'Debit', 'Credit']), {
    date: 0, description: 1, debit: 2, credit: 3,
  });
  assert.deepEqual(sniffHeader(['Posted Date', 'Merchant', 'Amount']), {
    date: 0, description: 1, amount: 2,
  });
});

test('header: Description beats Memo when both exist', () => {
  const mapping = sniffHeader(['Date', 'Memo', 'Description', 'Amount']);
  assert.equal(mapping.description, 2);
});

/* ------------------------------------------------------------------
   Whole files
   ------------------------------------------------------------------ */

test('file: single amount column, signs preserved', () => {
  const result = parseStatementCsv(
    'Date,Description,Amount\n' +
    '03/26/2026,FOOD LION #2196,-100.00\n' +
    '03/31/2026,PAYROLL,"$6,853.59"\n'
  );
  assert.equal(result.ok, true);
  assert.equal(result.rows.length, 2);
  assert.deepEqual(
    result.rows.map((r) => [r.posted_date, r.amount_cents, r.confidence]),
    [['2026-03-26', -10000, 'HIGH'], ['2026-03-31', 685359, 'HIGH']]
  );
});

test('file: separate debit/credit columns normalise to our sign convention', () => {
  const result = parseStatementCsv(
    'Transaction Date,Payee,Debit,Credit\n' +
    '2026-04-01,GROCERY,50.00,\n' +
    '2026-04-02,REFUND,,20.00\n'
  );
  assert.equal(result.ok, true);
  assert.equal(result.rows[0].amount_cents, -5000);  // debit -> money out
  assert.equal(result.rows[1].amount_cents, 2000);   // credit -> money in
  assert.equal(result.rows[0].confidence, 'HIGH');
});

test('file: unreadable fields flag the row LOW instead of dropping it', () => {
  const result = parseStatementCsv(
    'Date,Description,Amount\n' +
    'not-a-date,MYSTERY,12.00\n' +
    '04/02/2026,,7.00\n' +
    '04/03/2026,FINE,4.00\n'
  );
  assert.equal(result.ok, true);
  assert.equal(result.rows.length, 3);
  assert.equal(result.rows[0].confidence, 'LOW');   // bad date
  assert.equal(result.rows[0].posted_date, null);
  assert.equal(result.rows[0].amount_cents, 1200);  // amount still kept
  assert.equal(result.rows[1].confidence, 'LOW');   // missing description
  assert.equal(result.rows[2].confidence, 'HIGH');
});

test('file: header the sniffer cannot map is an error, not a guess', () => {
  const result = parseStatementCsv('Foo,Bar,Baz\n1,2,3\n');
  assert.equal(result.ok, false);
  assert.match(result.error, /date column/);
});

test('file: empty file is an error', () => {
  assert.equal(parseStatementCsv('').ok, false);
  assert.equal(parseStatementCsv('Date,Description,Amount\n').ok, false);
});
