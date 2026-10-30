import { test } from 'node:test';
import assert from 'node:assert/strict';
import { subBrand } from './sub-brands.js';

test('a line that names a brand\'s product is that product, with its own category (D420)', () => {
  const cases = [
    ['TESLA SUBSCRIPTION US PALO ALTO CA', 'Tesla Subscription', 'Subscriptions'],
    ['TESLA SUPERCHARGER US 1234-567 CA', 'Tesla Supercharger', 'EV Charging'],
    ['TESLA INC SUPERCHARGER PALO ALTO', 'Tesla Supercharger', 'EV Charging'],
    ['GOOGLE *YOUTUBEPREMIUM G.CO/HELPPAY# CA', 'YouTube', 'Subscriptions'],
    ['UBER *EATS 8005550100 CA', 'Uber Eats', 'Dining'],
    ['AplPay UBER EATS help.uber.com CA', 'Uber Eats', 'Dining'],
    ['UBER ONE HELP.UBER.COM CA', 'Uber One', 'Subscriptions'],
    ['CINEMARK MOVIE CLUB 800-555-0100 TX', 'Cinemark Movie Club', 'Subscriptions'],
  ];
  for (const [line, merchant, category] of cases) assert.deepEqual([subBrand(line)?.merchant, subBrand(line)?.category], [merchant, category], line);
  for (const line of ['UBER TRIP 8005550100 CA', 'TESLA', 'GOOGLE *CLOUD 1234', 'CINEMARK 1234 TX']) assert.equal(subBrand(line), null, line);
});
