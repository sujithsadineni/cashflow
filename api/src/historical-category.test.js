import { test } from 'node:test';
import assert from 'node:assert/strict';

import { suggestHistoricalCategories } from './historical-category.js';

/** A fake client whose .query() returns canned rows for each of the two queries this module runs. */
function fakeClient({ byMerchant = [], byDescription = [] } = {}) {
  return {
    query: async (sql) => {
      if (sql.includes('t.merchant = ANY')) return { rows: byMerchant };
      if (sql.includes('regexp_replace')) return { rows: byDescription };
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

test('suggests a category by merchant + txn_type when history is consistent', async () => {
  const client = fakeClient({
    byMerchant: [{ merchant: 'Costco', txn_type: 'purchase', category_name: 'Costco', count: 43 }],
  });
  const rows = [{ merchant: 'Costco', txn_type: 'purchase', description: 'COSTCO WHSE #1206' }];
  const result = await suggestHistoricalCategories(rows, client);
  assert.equal(result.get(0), 'Costco');
});

test('the same merchant with a different txn_type gets a different category — real Kohl\'s case', async () => {
  const client = fakeClient({
    byMerchant: [
      { merchant: "Kohl's", txn_type: 'purchase', category_name: 'Shopping', count: 2 },
      { merchant: "Kohl's", txn_type: 'refund', category_name: 'Refund', count: 2 },
    ],
  });
  const rows = [
    { merchant: "Kohl's", txn_type: 'purchase', description: "KOHL'S #706" },
    { merchant: "Kohl's", txn_type: 'refund', description: "KOHL'S #706 (RETURN)" },
  ];
  const result = await suggestHistoricalCategories(rows, client);
  assert.equal(result.get(0), 'Shopping');
  assert.equal(result.get(1), 'Refund');
});

test('picks the most common category when history has a mix, not just the first one seen', async () => {
  const client = fakeClient({
    byMerchant: [
      { merchant: 'Costco', txn_type: 'purchase', category_name: 'Costco', count: 43 },
      { merchant: 'Costco', txn_type: 'purchase', category_name: 'Groceries', count: 5 },
    ],
  });
  const rows = [{ merchant: 'Costco', txn_type: 'purchase', description: 'COSTCO WHSE #0249' }];
  const result = await suggestHistoricalCategories(rows, client);
  assert.equal(result.get(0), 'Costco');
});

test('falls back to an exact normalized-description match when there is no merchant', async () => {
  const client = fakeClient({
    byDescription: [{ norm_desc: 'playstation network san mateo ca', category_name: 'Entertainment', count: 2 }],
  });
  const rows = [{ merchant: null, txn_type: 'purchase', description: 'PlayStation Network   San Mateo   CA' }];
  const result = await suggestHistoricalCategories(rows, client);
  assert.equal(result.get(0), 'Entertainment');
});

test('a genuine tie in history (real case: "ATM PAYMENT ANYTOWN NC" once Cash Deposit, once Card Payment) gets no suggestion', async () => {
  const client = fakeClient({
    byDescription: [
      { norm_desc: 'atm payment anytown nc', category_name: 'Cash Deposit', count: 1 },
      { norm_desc: 'atm payment anytown nc', category_name: 'Card Payment', count: 1 },
    ],
  });
  const rows = [{ merchant: null, txn_type: 'deposit', description: 'ATM PAYMENT   ANYTOWN   NC' }];
  const result = await suggestHistoricalCategories(rows, client);
  assert.equal(result.has(0), false);
});

test('a merchant and description never seen before gets no suggestion — never a fabricated guess', async () => {
  const client = fakeClient();
  const rows = [{ merchant: null, txn_type: 'purchase', description: 'Some Brand New Store XYZ' }];
  const result = await suggestHistoricalCategories(rows, client);
  assert.equal(result.has(0), false);
});

test('does not run the description query at all when every row already has a merchant', async () => {
  let descriptionQueryRan = false;
  const client = {
    query: async (sql) => {
      if (sql.includes('regexp_replace')) descriptionQueryRan = true;
      return { rows: [] };
    },
  };
  const rows = [{ merchant: 'Costco', txn_type: 'purchase', description: 'COSTCO WHSE #1206' }];
  await suggestHistoricalCategories(rows, client);
  assert.equal(descriptionQueryRan, false);
});
