import { test } from 'node:test';
import assert from 'node:assert/strict';
import { namesOnStatement, startingRole } from './statement-names.js';

test('the holder and each section\'s name, once each, with the card ending its rows printed (D400)', () => {
  const names = namesOnStatement({ detected_holder: 'ALEX J MORGAN' }, [
    { spender_name: 'Alex J  Morgan', card_ending: '1001' },
    { spender_name: 'SAM RIVERA', card_ending: '2002' },
    { spender_name: 'SAM RIVERA', card_ending: '2002' },
    { spender_name: null, description: 'Zelle from TAYLOR BROOKS' },
  ]);
  assert.deepEqual(names, [{ printed: 'ALEX J MORGAN', card_ending: '1001' }, { printed: 'SAM RIVERA', card_ending: '2002' }]);
  assert.deepEqual(names.map(startingRole), ['owner', 'additional']);
  assert.equal(startingRole({ printed: 'SAM', card_ending: null }, 1), 'co_owner');
  assert.deepEqual(namesOnStatement({ detected_holder: 'ALEX MORGAN' }, []), [{ printed: 'ALEX MORGAN', card_ending: null }]);
});
