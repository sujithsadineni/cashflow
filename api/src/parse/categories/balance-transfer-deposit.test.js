import { test } from 'node:test';
import assert from 'node:assert/strict';
import { balanceTransferDepositFor } from './balance-transfer-deposit.js';

test('a card-services direct deposit is a balance transfer, whatever its ID or name', () => {
  for (const line of ['BOA CS DES:DIRECT DEP ID:[redacted] INDN:ALEX SAMPLE CO ID:0245907484 PPD', 'BOA CS   DES:DIRECT DEP ID:[redacted] INDN:SAM SAMPLE', 'BOA CS DES:DIRECT DEP INDN:SAM SAMPLE CO ID:0245907484']) {
    assert.deepEqual(balanceTransferDepositFor(line), { merchant: 'BofA Balance Transfer', category: 'Balance Transfer', txn_type: 'transfer' }, line);
  }
});

test('a salary direct deposit is not', () => {
  assert.equal(balanceTransferDepositFor('ACME INC DES:DIRECT DEP ID:123456789012ABC INDN:ALEX SAMPLE'), null);
  assert.equal(balanceTransferDepositFor('BANK OF AMERICA ONLINE BANKING TRANSFER'), null);
  assert.equal(balanceTransferDepositFor(null), null);
});
