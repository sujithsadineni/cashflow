import { test } from 'node:test';
import assert from 'node:assert/strict';
import { approvalToasts, editedToast } from './toast-words.js';

test('approving says what was saved, then everything found in it (D317)', () => {
  const [saved, found] = approvalToasts({ rows_approved: 42, follow_up: { bills_linked: ['Netflix'], new_bills: ['Hulu'], payments_verified: 3, transfers_linked: 1, review_added: 2 } });
  assert.equal(saved.message, '42 rows');
  assert.equal(saved.options.name, 'statement.saved');
  assert.equal(found.options.name, 'statement.found');
  assert.equal(found.message, 'Netflix charged · new recurring: Hulu · 3 payments matched · 1 transfer linked · 2 rows to review');
  assert.deepEqual(found.options.action, { label: 'Show', to: '/recurring' });
  assert.equal(approvalToasts({ rows_approved: 5, follow_up: {} }).length, 1);
  assert.equal(approvalToasts({ rows_approved: 0, follow_up: null })[0].message, 'No activity this period');
});

test('an edit in place is named by what changed, the line saying which and to what (D384)', () => {
  const t = editedToast('Costco', 'category', 'Groceries', () => {});
  assert.equal(t.message, 'Costco → Groceries');
  assert.equal(t.options.name, 'txn.category');
  assert.equal(editedToast('Costco', 'txn_type', 'Purchase').options.name, 'txn.type');
  assert.equal(editedToast(null, 'merchant', null).message, 'Transaction → none');
  assert.equal(t.options.action.label, 'Undo');
});
