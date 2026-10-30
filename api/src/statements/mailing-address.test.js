import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeKey, mailingAddress, addressLine, addressKey } from './mailing-address.js';

// Invented people and places, laid out the ways real first pages are.

test('a block on its own: name, street, city line', () => {
  const page = ['Account Summary', '', 'JORDAN A LEE', '123 MAPLE AVE APT 4B', 'SPRINGFIELD, IL 62701-1234', '', 'Payment due'].join('\n');
  assert.deepEqual(mailingAddress(page, ['Jordan A Lee']), { street: ['123 MAPLE AVE APT 4B'], city: 'SPRINGFIELD', state: 'IL', zip: '62701' });
});

test('a block sharing its lines with another column (read in the name\'s column)', () => {
  const page = [
    'Customer Service: 1-800-555-0100     ',
    'International Calls: 1-302-555-0101          JORDAN LEE',
    'Hours: 24/7                                   456 OAK STREET',
    'Lost or stolen: 1-800-555-0102                RIVERTON, UT 84065',
  ].join('\n');
  assert.deepEqual(mailingAddress(page, ['JORDAN LEE']), { street: ['456 OAK STREET'], city: 'RIVERTON', state: 'UT', zip: '84065' });
});

test('a joint holder line is passed over; two street lines are kept', () => {
  const page = ['JORDAN LEE', 'CASEY LEE', '789 PINE RD', 'UNIT 12', 'LAKEWOOD CO 80226'].join('\n');
  assert.deepEqual(mailingAddress(page, ['jordan lee']), { street: ['789 PINE RD', 'UNIT 12'], city: 'LAKEWOOD', state: 'CO', zip: '80226' });
});

test('no city line near the name, no name, or no names: nothing guessed', () => {
  assert.equal(mailingAddress(['JORDAN LEE', 'Your statement', 'for March'].join('\n'), ['Jordan Lee']), null);
  assert.equal(mailingAddress(['SOMEONE ELSE', '1 A ST', 'X, NY 10001'].join('\n'), ['Jordan Lee']), null);
  assert.equal(mailingAddress('JORDAN LEE\n1 A ST\nX, NY 10001', []), null);
  // The issuer's payment address isn't the holder's: it has no holder name above it.
  assert.equal(mailingAddress(['Make payments to:', 'PO BOX 15019', 'WILMINGTON, DE 19850'].join('\n'), ['Jordan Lee']), null);
});

test('one line for showing', () => {
  assert.equal(addressLine({ street: ['123 MAPLE AVE', 'APT 4B'], city: 'SPRINGFIELD', state: 'IL', zip: '62701' }), '123 MAPLE AVE, APT 4B, SPRINGFIELD, IL 62701');
  assert.equal(addressLine(null), null);
});

test('the layouts real banks print: another column between, a glued date, a comma after the state, a ZIP alone', () => {
  // Another column's line between the street and the city.
  assert.deepEqual(mailingAddress(['JORDAN LEE', '123 MAPLE AVE', 'NORTHWIND BANK, N.A.', 'SPRINGFIELD, IL 62701'].join('\n'), ['Jordan Lee']),
    { street: ['123 MAPLE AVE'], city: 'SPRINGFIELD', state: 'IL', zip: '62701' });
  // A date glued onto the street line.
  assert.deepEqual(mailingAddress(['JORDAN LEE', '123 MAPLE WAY NW 09/13/26', 'SPRINGFIELD IL 62701'].join('\n'), ['Jordan Lee']),
    { street: ['123 MAPLE WAY NW'], city: 'SPRINGFIELD', state: 'IL', zip: '62701' });
  // A comma after the state.
  assert.deepEqual(mailingAddress(['JORDAN LEE', '123 MAPLE AVE, APT 4,', 'SPRINGFIELD, IL, 62701'].join('\n'), ['Jordan Lee']),
    { street: ['123 MAPLE AVE, APT 4'], city: 'SPRINGFIELD', state: 'IL', zip: '62701' });
  // The city and state ending the street line, the ZIP on its own.
  assert.deepEqual(mailingAddress(['JORDAN LEE', '123 MAPLE AVE, SPRINGFIELD, IL,', '62701'].join('\n'), ['Jordan Lee']),
    { street: ['123 MAPLE AVE'], city: 'SPRINGFIELD', state: 'IL', zip: '62701' });
  // Three spaces between words isn't a column break; a middle initial in between still matches.
  assert.deepEqual(mailingAddress(['Calls: 1-800-555-0100          JORDAN   A   LEE', '                                123   OAK   ST', '                                RIVERTON   UT   84065'].join('\n'), ['Jordan Lee']),
    { street: ['123 OAK ST'], city: 'RIVERTON', state: 'UT', zip: '84065' });
});

test('two spellings of one address share a key', () => {
  const a = { street: ['123 Maple Ave., Apt 4'], city: 'Springfield', state: 'IL', zip: '62701' };
  const b = { street: ['123 MAPLE AVE APT 4'], city: 'SPRINGFIELD', state: 'IL', zip: '62701' };
  assert.equal(addressKey(a), addressKey(b));
  assert.equal(addressKey(null), null);
});

test('placeKey: one place however it is spelled, a different unit is another', () => {
  const a = placeKey('12 OAK WOODS DR, SPRINGFIELD, IL 62701');
  assert.equal(a, '12|62701');
  assert.equal(placeKey('12 Oak Wods Dr., Springfield, IL 62701-1234'), a);
  assert.equal(placeKey('40 Elm Rd, Apt 4B, Springfield, IL 62701'), '40-4B|62701');
  assert.notEqual(placeKey('40 Elm Rd, Apt 5, Springfield, IL 62701'), placeKey('40 Elm Rd, Apt 4B, Springfield, IL 62701'));
  assert.equal(placeKey('No zip here'), null);
});
