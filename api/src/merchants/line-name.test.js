import { test } from 'node:test';
import assert from 'node:assert/strict';
import { learnCities, nameFromLine, knownAs } from './line-name.js';

const lines = [
  'SHEARZ LAKEVIEW TXUSA', 'TAQUERIA LUNA LAKEVIEW TXUSA', 'C & T WOK SPRINGFIELD NCUSA', 'GOURMET HOUSE SPRINGFIELD NC',
  'DOSA PLACE JERSEY CITY NJUSA', 'BAKERY ONE Jersey City NJUSA', 'CORNER LIQUOR   CHICAGO   IL', 'SIREN BAR   CHICAGO   IL',
  'BEAN CAFE RALEIGH NCUSA', 'PHO PLACE RALEIGH NC',
];
const cities = learnCities(lines);

test('the cities a household\'s lines end with are learned from those lines (D367)', () => {
  for (const c of ['lakeview', 'springfield', 'jersey city', 'chicago']) assert.ok(cities.has(c), c);
  assert.ok(!cities.has('shearz'));
});

test('a likely merchant name is read off a line nobody named (D367)', () => {
  const cases = [
    ['AplPay HARLOWS 101 CENTRAL', 'Harlows'],
    ['078 TACO TOWER FT MYERS FL', 'Taco Tower Ft Myers'],
    ['TST* SWEETS HUT - FAIRVIEW FAIRVIEW GA', 'Sweets Hut'],
    ['MOHAN\'S DOSA HOUSE JERSEY CITY NJUSA', 'Mohan\'s Dosa House'],
    ['SHEARZ LAKEVIEW TXUSA', 'Shearz'],
    ['JACK IN THE BOX [redacted] TX', 'Jack In The Box'],
    ['FreeTaxUSA.com PROVO UTUSA', 'FreeTaxUSA'],
    ['Purchase Returns - O\'REILLY 101 LAKEVIEW TXUSA', 'O\'reilly'],
    ['SQ *VELVET SCOOP Midvale TX', 'Velvet Scoop Midvale'],
    ['FLIX   122-2237631 CA', 'Flix'],
    ['CORNER LIQUOR   CHICAGO   IL', 'Corner Liquor'],
    ['TST*RALEIGH - TACO VIDA Raleigh NCUSA', 'Taco Vida'],
  ];
  for (const [line, name] of cases) assert.equal(nameFromLine(line, cities), name, line);
});

test('a line that names no merchant stays unnamed (D367)', () => {
  for (const line of ['EWR C1 SURF MARKET NEWARK NJUSA', 'MERCHANDISE RETURN', 'Annual Fee', 'AplPay STORE GREEN HILL TX', 'K3SV:0001 200.00 credit', 'Reversal Transaction [Financial Charges - Interest]', '100 W MAIN   CHICAGO   IL', '']) {
    assert.equal(nameFromLine(line, cities), null, line);
  }
});

test('a line read as a merchant the household already has takes its name (D367)', () => {
  const canonical = new Map([['o reilly auto parts', { name: 'O\'Reilly Auto Parts', count: 4 }], ['home depot', { name: 'Home Depot', count: 9 }], ['harl', { name: 'Harl', count: 1 }]]);
  assert.equal(knownAs('O\'reilly', canonical), 'O\'Reilly Auto Parts');
  assert.equal(knownAs('Homedepot', canonical), 'Home Depot');
  assert.equal(knownAs('Harlows', canonical), null, 'too short a name to stand for another');
  assert.equal(knownAs('Wm Supercenter', canonical), null);
});

test('wallets, processor codes, company suffixes and cut-short words come off; a city follows many shops (D418)', () => {
  const more = learnCities([...lines, 'LOTUS GROCERY RIVERTON TX', 'DOSA HUT RIVERTON TX', 'CAFE GROCERY RIVERTON TX', 'TAJ GROCERY RIVERTON TX']);
  assert.ok(more.has('riverton'));
  assert.ok(!more.has('grocery riverton'), 'Riverton follows many shops, so "grocery riverton" is no city');
  const cases = [
    ['SamPay DOSA HUT RIVERTON TX', 'Dosa Hut'],
    ['SPICY GRILL RIVERTON TX', 'Spicy Grill'],
    ['SQ *SPICY GRILL FFRiverton TX', 'Spicy Grill Ff'],
    ['FIV*TEA HOUSE - MAIN4400 MAIN ST RIVERTON TX', 'Tea House'],
    ['LOTUS HALAL MEAT LLC 0000 RIVERTON TX', 'Lotus Halal Meat'],
    ['SAMPLE STATE UNIVERS 084870017625 800-555-0100 AR', 'Sample State University'],
    ['AUTO HAUS IMPORTS RIVERTONTXUSA', 'Auto Haus Imports'],
    ['CHECKCARD 0822 TEA HOUSE RIVERTON TX', 'Tea House'],
    ['AMZN Mktp US*8V8JG35R3 Amzn.com/billWAUSA', 'Amazon'],
    ['ACME LENDING CO I DES:Sam Sample ID: INDN:Sam Sample CO ID:', 'Acme Lending Co'],
    ['Daily Cash Adjustment · Daily Cash Adjustment · LOTUS GROCERY RIVERTON TX', 'Lotus Grocery'],
  ];
  for (const [line, name] of cases) assert.equal(nameFromLine(line, more), name, line);
});
