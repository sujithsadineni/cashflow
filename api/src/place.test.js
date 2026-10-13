import { test } from 'node:test';
import assert from 'node:assert/strict';
import { learnPlaces, parsePlace, placeFor } from './place.js';

// Shapes copied from real statement lines (D224).
const p = (d) => {
  const r = parsePlace(d);
  return r && (r.online ? 'online' : `${r.town ?? '-'}, ${r.state ?? '-'}${r.store ? ` #${r.store}` : ''}`);
};

test('town and state, with or without a store number, ZIP, "USA" or trailers', () => {
  assert.equal(p('COSTCO WHSE #1204 FAIRVIEW NC'), 'Fairview, NC #1204');
  assert.equal(p('COSTCO WHSE #0103   RIVERTON   NC'), 'Riverton, NC #103');
  assert.equal(p('CEDAR HALAL MEAT LLC SHELBYVILLE NCUSA'), 'Shelbyville, NC');
  assert.equal(p('AplPay FOOD LION #7777 SHELBYVILLE NC - GROCERY STORE'), 'Shelbyville, NC #7777');
  assert.equal(p('TARGET T-0001 100 MAIN RD CEDAR PARK 30001 GA USA'), 'Cedar Park, GA');
  assert.equal(p('H&M 0001GLENDALE 1 Main Circle GLENDALE30002 GA USA'), 'Glendale, GA');
  assert.equal(p('Daily Cash Adjustment · TARGET T-0001 100 MAIN RD CEDAR PARK 30001 GA USA (RETURN)'), 'Cedar Park, GA');
  assert.equal(p('Spectrum SAINT LOUIS MOUSA'), 'Saint Louis, MO');
  assert.equal(p('LEEANN CHIN ASHFORD GA'), 'Ashford, GA');
  assert.equal(p('Ikea Click And Collect NOTTINGHAM MD FURNITURE/LAMP/LIGHTING'), 'Nottingham, MD');
  assert.equal(p('DFW AIRPORT PARKING   DFW AIRPORT TX'), 'DFW Airport, TX');
});

test('merchant words and street words never become the town', () => {
  assert.equal(p('TST* BASIL & LIME INDI LAKEVIEW NC'), 'Lakeview, NC');
  assert.equal(p('SIAM THAI LLC CEDAR PARK GA'), 'Cedar Park, GA');
  assert.equal(p('Calvin Klein 1 Outlet Way Millbrook 30000 GA USA'), 'Millbrook, GA');
  assert.equal(p('SQ *BEN & JERRY\'S HIGH ST Oakdale GA'), 'Oakdale, GA');
});

test('online: websites, apps and marketplaces, whatever head office prints', () => {
  for (const d of ['WWW COSTCO COM ISSAQUAH WAUSA', 'WWW COSTCO COM 800-955-2292 WA', 'AMAZON MKTPL*D95B67213440 Terry Ave N SEATTLE 98109 WA USA',
    'DD *DOORDASH CURRYHOUS 8559731040 CA', 'Groupon, Inc. groupon.com IL', 'LYFT *2 RIDES 08-27 548 Market St. Ste 68514 SAN FRANCISCO94104 CA USA',
    'AMAZON PAY INDIA PRIVA#26,1, Brigade Gateway, 8th Floor, Dr. Rajkum Bangalore 560055 IND']) {
    assert.equal(p(d), 'online', d);
  }
});

test('nothing to say: a phone number instead of a town, Zelle, or no place at all', () => {
  assert.equal(p('ALLSTATE *PAYMENT 800-255-7828 IL'), '-, IL');
  assert.equal(placeFor({ merchant: 'Allstate', description: 'ALLSTATE *PAYMENT 800-255-7828 IL' }), null); // no town, no store: no pill
  assert.equal(parsePlace('Zelle payment to Sam Conf# abc'), null);
  assert.equal(parsePlace('COMCAST-XFINITY CABLE SVCS'), null);
});

// Stand-ins for household/known-places.js, which a public clone doesn't have.
const KNOWN = { 'costco|#102': { town: 'Glendale', state: 'GA' }, 'tel:9195550104': { town: 'Lakeview', state: 'NC' } };

test('a store that prints a phone number gets its town from its other rows; a cut-short town is completed', () => {
  const rows = [
    { merchant: 'Costco', description: 'COSTCO WHSE #0101 MAPLETON GA' },
    { merchant: 'Costco', description: 'COSTCO WHSE #0101 770-555-0101 GA' },
    { merchant: 'Costco', description: 'COSTCO WHSE #0102 678-555-0102 GA' },
    { merchant: 'Cedar Halal', description: 'CEDAR HALAL MEAT LLC 100 MAIN ST. SHELBYVIL27000 NC USA' },
    { merchant: 'Cedar Halal', description: 'CEDAR HALAL MEAT LLC SHELBYVILLE NCUSA' },
  ];
  const learned = learnPlaces(rows);
  assert.deepEqual(placeFor(rows[1], learned), { online: false, town: 'Mapleton', state: 'GA', store: '101', label: 'Mapleton, GA', title: 'Mapleton, GA · Warehouse #101' });
  assert.equal(placeFor(rows[2], learned, KNOWN).label, 'Glendale, GA'); // no row says it: from a public store list (KNOWN_PLACES)
  assert.equal(placeFor(rows[3], learned).label, 'Shelbyville, NC');
  assert.deepEqual(placeFor({ merchant: 'Costco', description: 'WWW COSTCO COM ISSAQUAH WAUSA' }, learned), { online: true, town: null, state: null, store: null, label: 'Online', title: 'Online' });
});

test('ZIP+4, a town the bank cut short, and a store nobody lists', () => {
  assert.equal(p('THE HOME DEPOT #0001 100 MAIN RD MAPLETON 300010000 GA USA'), 'Mapleton, GA #1');
  assert.equal(p('CITY PARKING LLC 300 MAIN STREET S RIVERTON 270010000 NC USA'), 'Riverton, NC');
  assert.equal(p('TST* HARBOR GRILL RESTAUR KILL DEVIL HI NC'), 'Kill Devil Hills, NC');
  // Not in any directory: its state and number, never a guessed town.
  assert.equal(placeFor({ merchant: 'Cold Stone Creamery', description: 'COLD STONE CREAMERY #2 980-5550103 NC' }, learnPlaces([])).label, 'NC #2');
});

test('a local phone line takes the merchant’s one town; a toll-free one, or a merchant in many towns, stays blank', () => {
  const rows = [
    { merchant: 'Spice Central', description: 'AplPay SPICE CENTRAL SHELBYVILLE NC' },
    { merchant: 'Spice Central', description: 'Card Purchase 01/30 Spice Central 919-5550105 NC Card 1789' },
    { merchant: 'Starbucks', description: 'STARBUCKS 1234 LAKEVIEW NC' },
    { merchant: 'Starbucks', description: 'STARBUCKS 8007827282 800-782-7282 WA' },
    { merchant: 'Taco Bell', description: 'TACO BELL 100001 GLENDALE GA' },
    { merchant: 'Taco Bell', description: 'TACO BELL 100002 HILLCREST GA' },
    { merchant: 'Taco Bell', description: 'TACO BELL 404-555-1212 GA' },
  ];
  const learned = learnPlaces(rows);
  assert.equal(placeFor(rows[1], learned).label, 'Shelbyville, NC');
  assert.equal(placeFor(rows[3], learned), null); // a head-office 800 number
  assert.equal(placeFor(rows[6], learned), null); // which of its two towns? don't guess
  assert.equal(placeFor({ merchant: 'Corner Deli', description: 'CORNER DELI 919-5550104 NC' }, learned, KNOWN).label, 'Lakeview, NC');
});
