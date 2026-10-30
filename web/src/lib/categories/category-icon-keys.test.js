import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ICON_CATALOG, defaultIconFor } from './category-icon-keys.js';

// The API only accepts icon keys on its own list (validate.js). Investment's
// trend-up was missing from it, so picking that icon in Settings was refused (D262).
test("the API's icon allow-list is exactly the web's catalog", () => {
  const src = readFileSync(new URL('../../../../api/src/core/validate.js', import.meta.url), 'utf8');
  const list = src.match(/const CATEGORY_ICON_KEYS = \[([^\]]*)\]/)[1];
  assert.deepEqual([...list.matchAll(/'([^']+)'/g)].map((m) => m[1]), ICON_CATALOG);
});

test('the audit categories and Education get their own icons by name', () => {
  const expected = {
    Education: 'school', 'Personal Care': 'cut', 'Auto Maintenance': 'wrench', 'Parking & Tolls': 'ticket',
    Government: 'document', 'Gifts & Donations': 'gift', Fitness: 'barbell', Home: 'bed', Phone: 'phone',
  };
  for (const [name, key] of Object.entries(expected)) assert.equal(defaultIconFor(name), key, name);
});

test('the new rules leave the older categories as they were', () => {
  const expected = { Rent: 'home', Transport: 'car', Utilities: 'bolt', 'Annual Fee': 'star', 'Consulting Fee': 'briefcase' };
  for (const [name, key] of Object.entries(expected)) assert.equal(defaultIconFor(name), key, name);
});

// D373: no two of the household's kinds of category share an icon any more.
test("related categories get their own icons, not their neighbour's", () => {
  const expected = {
    'Transfer to India': 'globe', 'Balance Transfer': 'compare', 'Balance Transfer Fee': 'receipt', Zelle: 'people', Transfers: 'swap',
    Groceries: 'cart', Costco: 'storefront', Dining: 'fork', 'Fast Food': 'fast-food', Shopping: 'bag', Clothing: 'shirt',
    Utilities: 'bolt', 'EV Charging': 'battery', Salary: 'cash', 'Cash Deposit': 'tray-down', Interest: 'percent', 'Interest Earned': 'leaf',
    'Bank Fees': 'bank', Loan: 'hourglass', Refund: 'undo', 'Tax-Refund': 'library', 'Account Verification': 'check', Uncategorized: 'dot',
  };
  for (const [name, key] of Object.entries(expected)) assert.equal(defaultIconFor(name), key, name);
  const used = Object.values(expected);
  assert.equal(new Set(used).size, used.length, 'two categories share an icon');
});

