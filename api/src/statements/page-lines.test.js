import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageLines, lineScore, locateRows } from './page-lines.js';

const item = (str, x, y, w = 30) => ({ str, transform: [10, 0, 0, 10, x, y], width: w });

test('words on one baseline are one line, with its box as page fractions from the top', () => {
  const lines = pageLines([item('09/14', 50, 700), item('COFFEE', 100, 700.5), item('5.75', 400, 700), item('Total', 50, 650)], 500, 800);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].text, '09/14 COFFEE 5.75');
  assert.equal(lines[0].left, 0.1);
  assert.ok(lines[0].top > 0 && lines[0].top < lines[0].bottom && lines[0].bottom < lines[1].top);
});

test("a line needs the row's amount, then gains for its date and first word", () => {
  const row = { amount_cents: -123456, posted_date: '2026-09-14', description: 'COFFEE SHOP 42' };
  assert.equal(lineScore('09/14 COFFEE SHOP 42 1,234.56', row), 4);
  assert.equal(lineScore('Sep 14 Coffee Shop $1234.56', row), 4);
  assert.equal(lineScore('09/14 COFFEE SHOP 42 11,234.56', row), 0, 'a longer number is not the amount');
  assert.equal(lineScore('09/14 COFFEE SHOP', row), 0);
});

test('rows land on lines in order, so repeated lines each get their own', () => {
  const pages = [
    { n: 1, lines: [{ text: 'Opening balance 0.00', top: 0.1, bottom: 0.12, left: 0, right: 1 }, { text: '10/13 INTEREST CHARGED 0.00', top: 0.2, bottom: 0.22, left: 0, right: 1 }] },
    { n: 2, lines: [{ text: '10/13 INTEREST CHARGED 0.00', top: 0.3, bottom: 0.32, left: 0, right: 1 }, { text: '10/13 INTEREST CHARGED 0.00', top: 0.4, bottom: 0.42, left: 0, right: 1 }] },
  ];
  const rows = [1, 2, 3].map((id) => ({ id, amount_cents: 0, posted_date: '2026-10-13', description: 'INTEREST CHARGED' }));
  rows.push({ id: 4, amount_cents: 999, posted_date: '2026-10-13', description: 'NOTHING' });
  const found = locateRows(pages, rows);
  assert.deepEqual([found[1].page, found[1].top], [1, 0.2], 'not the opening balance, which has neither date nor word');
  assert.deepEqual([found[2].page, found[2].top], [2, 0.3]);
  assert.deepEqual([found[3].page, found[3].top], [2, 0.4]);
  assert.equal(found[4], undefined, 'a row nothing prints has no box');
});
