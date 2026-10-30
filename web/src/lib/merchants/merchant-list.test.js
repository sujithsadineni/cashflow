import { test } from 'node:test';
import assert from 'node:assert/strict';
import { iconSource, filterCounts, listMerchants, renamePreview, sourceWords } from './merchant-list.js';

// Invented merchants with the real shape; "Costco" is a chain the app has a logo for.
const m = (merchant, transaction_count, lines = []) => ({ merchant, transaction_count, aliases: lines.map((line) => ({ line, n: 1 })) });
const merchants = [m('Corner Bakery', 3, ['corner bakery 0042']), m('Costco', 40), m('Northwind Diner', 12), m('Pine Garage', 1), m('Ridge Tea', 7)];
// Ridge Tea's emoji is from before D301: it no longer counts.
const icons = { 'Ridge Tea': { emoji: '🧋' }, 'Pine Garage': { domain: 'pinegarage.com' }, 'Northwind Diner': { image_path: 'data/x.png' } };

test('a logo has one source: uploaded or a website first, then built in, else none', () => {
  assert.deepEqual(iconSource('Northwind Diner', icons['Northwind Diner']), { kind: 'photo' });
  assert.deepEqual(iconSource('Pine Garage', icons['Pine Garage']), { kind: 'website', domain: 'pinegarage.com' });
  assert.deepEqual(iconSource('Ridge Tea', icons['Ridge Tea']), { kind: 'none' });
  assert.deepEqual(iconSource('Costco', { emoji: '🛒' }), { kind: 'logo', domain: 'costco.com' });
  assert.deepEqual(iconSource('Corner Bakery', undefined), { kind: 'none' });
});

test('counts per filter', () => {
  assert.deepEqual(filterCounts(merchants, icons), { needs: 2, chosen: 2, all: 5 });
});

test('the list: filtered, searched by name or bank line, most-used first', () => {
  assert.deepEqual(listMerchants(merchants, icons, { filter: 'needs' }).map((x) => x.merchant), ['Ridge Tea', 'Corner Bakery']);
  assert.deepEqual(listMerchants(merchants, icons, { filter: 'chosen' }).map((x) => x.merchant), ['Northwind Diner', 'Pine Garage']);
  assert.deepEqual(listMerchants(merchants, icons, { filter: 'all', search: '0042' }).map((x) => x.merchant), ['Corner Bakery']);
  assert.deepEqual(listMerchants(merchants, icons, { filter: 'all', search: 'COST' }).map((x) => x.merchant), ['Costco']);
});

test('renaming as typed: a new name, a merge under the existing spelling, or nothing', () => {
  assert.deepEqual(renamePreview('Pine Garage', ' Pine  Auto ', merchants), { to: 'Pine Auto', merge: false });
  assert.deepEqual(renamePreview('Pine Garage', 'costco', merchants), { to: 'Costco', merge: true, intoCount: 40 });
  assert.deepEqual(renamePreview('Pine Garage', 'Pine Garage', merchants), { same: true });
  assert.deepEqual(renamePreview('Pine Garage', '  ', merchants), { error: 'Give it a name' });
});

test('the source in words', () => {
  assert.equal(sourceWords({ kind: 'logo', domain: 'costco.com' }), 'Built in · costco.com');
  assert.equal(sourceWords({ kind: 'none' }), 'Its category’s icon');
});
