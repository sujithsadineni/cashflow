import { test } from 'node:test';
import assert from 'node:assert/strict';
import { landingFill, leadingNumber, boxTurn, PACE } from './choreography.js';

test('the month fills as the boxes after Find the card finish', () => {
  assert.equal(landingFill(3), 0.15, 'a little fill as soon as the card is shown');
  assert.equal(landingFill(2), 0.15);
  assert.ok(Math.abs(landingFill(4) - (0.15 + 0.85 / 3)) < 1e-9);
  assert.ok(landingFill(5) > landingFill(4));
  assert.equal(landingFill(6), 1, 'full when Check totals is done');
  assert.equal(landingFill(9), 1);
});

test('a note\'s leading number counts up; the rest stays', () => {
  assert.deepEqual(leadingNumber('48 rows · Sep 12 – Oct 11'), { n: 48, rest: ' rows · Sep 12 – Oct 11' });
  assert.deepEqual(leadingNumber('41 of 48 sorted'), { n: 41, rest: ' of 48 sorted' });
  assert.equal(leadingNumber('Totals match'), null);
  assert.equal(leadingNumber(null), null);
});

test('a box takes its time; a skipped one goes quicker', () => {
  assert.equal(boxTurn(), PACE.step + PACE.tick + PACE.link);
  assert.ok(boxTurn(true) < boxTurn());
});
