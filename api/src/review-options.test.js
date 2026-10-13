import { test } from 'node:test';
import assert from 'node:assert/strict';
import { typeOptions, buildCategoryIndex, categoryOptions, wordsOf } from './review-options.js';

const values = (opts) => opts.map((o) => o.value);

test('typeOptions: money out on a card is a purchase first; on a bank, purchase then transfer', () => {
  assert.deepEqual(values(typeOptions({ amount_cents: -1600, account_type: 'CREDIT_CARD' })), ['purchase', 'fee', 'interest']);
  assert.deepEqual(values(typeOptions({ amount_cents: -1600, account_type: 'CHECKING' })), ['purchase', 'transfer', 'payment']);
});

test('typeOptions: money in reads the words (a reward is cashback), Zelle goes by who, history leads', () => {
  assert.equal(typeOptions({ amount_cents: 500, account_type: 'CREDIT_CARD', description: 'Amex Offer credit' })[0].value, 'cashback');
  assert.equal(typeOptions({ amount_cents: 500, account_type: 'CREDIT_CARD', description: 'KOHLS RETURN' })[0].value, 'refund');
  assert.equal(typeOptions({ amount_cents: -5000, account_type: 'CHECKING', zelle_type: 'INTERNAL' })[0].value, 'transfer');
  assert.equal(typeOptions({ amount_cents: -5000, account_type: 'CREDIT_CARD' }, 'fee')[0].value, 'fee');
  assert.ok(typeOptions({ amount_cents: -5000, account_type: 'CREDIT_CARD' }).every((o) => o.why));
});

test('wordsOf: skips filler words and keeps the first four', () => {
  assert.deepEqual(wordsOf({ description: 'AplPay GLOW NAILS PRIVERTON NC' }), ['glow', 'nails', 'priverton']);
  assert.deepEqual(wordsOf({ merchant: "Annapurna South Indian Cuisine Riverton" }), ['annapurna', 'south', 'indian', 'cuisine']);
});

const history = [
  { id: 1, merchant: 'Ross', description: 'ROSS STORES #12 RIVERTON NC', category_name: 'Shopping', txn_type: 'purchase' },
  { id: 2, merchant: 'Biryani N Bowl', description: 'BIRYANI N BOWL LAKEVIEW NC', category_name: 'Dining', txn_type: 'purchase' },
  { id: 3, merchant: 'Biryani Pot', description: 'BIRYANI POT GREENWOOD NC', category_name: 'Dining', txn_type: 'purchase' },
  { id: 4, merchant: 'Whole Foods', description: 'WHOLE FOODS RIVERTON NC', category_name: 'Groceries', txn_type: 'purchase' },
  { id: 5, merchant: 'Taco Bar', description: 'TACO BAR LAKEVIEW NC', category_name: 'Dining', txn_type: 'purchase' },
  { id: 6, merchant: 'Street Parking', description: 'STREET PARKING LAKEVIEW NC', category_name: 'Transport', txn_type: 'purchase' },
  { id: 7, merchant: 'Amex', description: 'AMERICAN EXPRESS ACH PMT', category_name: 'Card Payment', txn_type: 'payment' },
  { id: 8, merchant: 'Amex', description: 'AMERICAN EXPRESS ACH PMT', category_name: 'Card Payment', txn_type: 'payment' },
  { id: 9, merchant: 'Target', description: 'TARGET RIVERTON NC', category_name: 'Shopping', txn_type: 'purchase' },
  { id: 10, merchant: null, description: 'MYSTERY THING', category_name: 'Uncategorized', txn_type: 'purchase' },
];
const index = buildCategoryIndex(history);

test('categoryOptions: the same merchant leads, even with one earlier row', () => {
  const [first] = categoryOptions({ id: 99, merchant: 'Ross', description: 'ROSS', txn_type: 'purchase', amount_cents: -3751 }, index);
  assert.deepEqual(first, { value: 'Shopping', why: 'Like your other row from here' });
});

test('categoryOptions: shared rarer words vote ("biryani" is Dining)', () => {
  const opts = categoryOptions({ id: 99, merchant: 'Biryani House', description: 'BIRYANI HOUSE', txn_type: 'purchase', amount_cents: -2000 }, index);
  assert.equal(opts[0].value, 'Dining');
  assert.match(opts[0].why, /^Like Biryani/);
});

test('categoryOptions: a town is learned from the data and never votes', () => {
  assert.ok(index.places.has('lakeview'));
  assert.ok(index.places.has('riverton'));
  const opts = categoryOptions({ id: 99, merchant: null, description: 'HOMEGOODS LAKEVIEW NC', txn_type: 'purchase', amount_cents: -2356 }, index);
  assert.ok(opts.every((o) => !o.why.startsWith('Like')), JSON.stringify(opts));
});

test('categoryOptions: never Uncategorized, never a category the type contradicts, never a deleted one', () => {
  const opts = categoryOptions({ id: 99, merchant: null, description: 'EXPRESS CAR WASH', txn_type: 'purchase', amount_cents: -1200 }, index);
  assert.ok(!values(opts).includes('Card Payment'));
  assert.ok(!values(opts).includes('Uncategorized'));
  const onlyDining = categoryOptions({ id: 99, merchant: 'Ross', txn_type: 'purchase', amount_cents: -100 }, index, { valid: new Set(['Dining']) });
  assert.deepEqual(values(onlyDining), ['Dining']);
});

test('categoryOptions: with nothing to go on, the categories most used for its type', () => {
  const opts = categoryOptions({ id: 99, merchant: null, description: 'ZZZ', txn_type: null, amount_cents: -100 }, index);
  assert.equal(opts[0].value, 'Dining');
  assert.equal(opts[0].why, 'Often used for purchases');
  assert.ok(opts.length <= 4);
});
