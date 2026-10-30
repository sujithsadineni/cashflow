import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineDetail } from './line-detail.js';

// Each bank's real line shape; merchants and places invented.
test('Bank of America: bought, then posted, the year from the posted date', () => {
  assert.deepEqual(lineDetail('03/11   03/13   CORNER CAFE 33418   ANYTOWN   TX   0139   5119   11.32', 'CORNER CAFE 33418', '2026-03-13'), { sale_date: '2026-03-11', wallet: null });
  assert.equal(lineDetail('12/30   01/02   CAFE   ANYTOWN   TX', 'CAFE', '2026-01-02').sale_date, '2025-12-30', 'bought in December, posted in January');
});

test('Barclays and Zolve', () => {
  assert.equal(lineDetail('Apr 26   Apr 27   TACO STAND 3267 ANYTOWN NC   66   $21.93', 'TACO STAND', '2026-04-27').sale_date, '2026-04-26');
  assert.equal(lineDetail('11/20/2024 11/21/2024 CORNER STORE 50711 ANYTOWN TXUSA $50.00', 'CORNER STORE', '2024-11-21').sale_date, '2024-11-20');
});

test('the same day twice, or one date, says nothing', () => {
  assert.equal(lineDetail('11/30/2025 11/30/2025 TACO STAND NCUSA $9.62', 'TACO STAND', '2025-11-30').sale_date, null);
  assert.equal(lineDetail('06/02/2025 BOOKSHOP 85250 AZ USA 1% $0.04 $3.50', 'BOOKSHOP', '2025-06-02').sale_date, null);
});

test('the wallet, from the line or the description when no line was saved', () => {
  assert.equal(lineDetail('AplPay PARKING INC   ANYTOWN   IL 06/21/23   $8.95', 'AplPay PARKING INC', '2023-06-21').wallet, 'Apple Pay');
  assert.equal(lineDetail(null, 'AplPay CORNER STORE', '2024-09-27').wallet, 'Apple Pay');
  assert.equal(lineDetail('SAMSUNG PAY TACO STAND', 'x', '2026-01-01').wallet, 'Samsung Pay');
  assert.deepEqual(lineDetail(null, 'CAFE', null), { sale_date: null, wallet: null });
});
