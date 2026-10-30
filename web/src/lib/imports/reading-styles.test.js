import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markLine, lineStep, runningTotals, tapeEnding, isReadingStyle, DEFAULT_READING_STYLE, SAMPLE_ROWS, SAMPLE_TALLY } from './reading-styles.js';

const joined = (segs) => segs.map((s) => s.text).join('');
const marked = (segs) => Object.fromEntries(segs.filter((s) => s.mark).map((s) => [s.mark, s.text]));

test('C is the default style', () => {
  assert.equal(DEFAULT_READING_STYLE, 'paper');
  assert.equal(isReadingStyle('tape'), true);
  assert.equal(isReadingStyle('confetti'), false);
});

test('a line is cut into date, merchant and amount, and joins back exactly', () => {
  const raw = '09/16  TRADER JOE S #552  SAN JOSE CA            48.12';
  const segs = markLine(raw, 'TRADER JOE S #552');
  assert.equal(joined(segs), raw);
  assert.deepEqual(marked(segs), { date: '09/16', merchant: 'TRADER JOE S #552', amount: '48.12' });
});

test('two leading dates, a $ amount, and text after the amount', () => {
  const segs = markLine('09/02/2026 09/03/2026 COFFEE SHOP 42 SEATTLE $5.75 | ref:123', 'Coffee shop 42');
  assert.deepEqual(marked(segs), { date: '09/02/2026 09/03/2026', merchant: 'COFFEE SHOP 42', amount: '$5.75' });
});

test('a month-name date, as some issuers print it', () => {
  assert.equal(marked(markLine('Sep 14   Sep 15   COFFEE SHOP   5.75', 'COFFEE SHOP')).date, 'Sep 14   Sep 15');
});

test('without the description on the line, the words after the date up to a wide gap', () => {
  const segs = markLine('10/05   10/06   AMAZON MKTPL 2K4   WA   1234   5678   63.77', 'something else');
  assert.equal(marked(segs).merchant, 'AMAZON MKTPL 2K4');
  assert.equal(marked(segs).amount, '63.77');
});

test('a line with no raw text or no amount still marks what it can', () => {
  assert.deepEqual(markLine(null, 'X'), []);
  assert.deepEqual(marked(markLine('SOME PAYMENT', 'SOME PAYMENT')), { merchant: 'SOME PAYMENT' });
  assert.deepEqual(marked(markLine('-1,284.00 credit', null)), { amount: '-1,284.00' }, 'a merchant is only looked for before the amount');
});

test('about 10.5 seconds whatever the length, within 180–1050 ms a line', () => {
  assert.equal(lineStep(5), 1050);
  assert.equal(lineStep(20), 525);
  assert.equal(lineStep(80), 180);
  assert.equal(lineStep(20, 220), 525);
  assert.equal(Math.round(lineStep(73, 260) * 73), 18000, 'a long statement in a slower style still ends in about 18 seconds');
});

test('the tape counts up and ends on the tally', () => {
  assert.deepEqual(runningTotals([{ amount_cents: -500 }, { amount_cents: 200 }, { amount_cents: null }]), [-500, -300, -300]);
  assert.deepEqual(tapeEnding({ status: 'match', rows_cents: -300 }), { kind: 'match', cents: -300 });
  assert.equal(tapeEnding({ status: 'off', rows_cents: -300, expected_cents: -400, diff_cents: 100 }).gap, 100);
  assert.equal(tapeEnding(null).kind, 'unknown');
  assert.equal(SAMPLE_TALLY.rows_cents, runningTotals(SAMPLE_ROWS).at(-1));
});
