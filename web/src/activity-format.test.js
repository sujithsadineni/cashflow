import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeAction, describeDetail, fieldLabel, formatValue, subjectOf } from './activity-format.js';

// Real detail shapes, copied from this household's audit_log.
const lookup = {
  categories: [{ id: 7, name: 'Shopping' }, { id: 16, name: 'Costco' }],
  accounts: [{ id: 7, name: 'Chase Total Checking' }],
  people: [{ id: 1, name: 'Alex Morgan' }],
};

test('describeAction: a known action gets its label and emoji; an unknown one is still readable', () => {
  assert.deepEqual(describeAction('transaction.edited'), { emoji: '✏️', label: 'Transaction edited' });
  assert.deepEqual(describeAction('widget.got_polished'), { emoji: '•', label: 'Widget got polished' });
});

test('fieldLabel strips id/cents/bytes and humanizes', () => {
  assert.equal(fieldLabel('category_id'), 'Category');
  assert.equal(fieldLabel('current_balance_cents'), 'Current balance');
  assert.equal(fieldLabel('match_name_contains'), 'Match name contains');
});

test('formatValue: ids become names, cents become money, bytes become KB, empty becomes a dash', () => {
  assert.equal(formatValue('category_id', 16, lookup), 'Costco');
  assert.equal(formatValue('category_id', 999, lookup), '#999');
  assert.equal(formatValue('amount_cents', -12500, lookup), '−$125.00');
  assert.equal(formatValue('size_bytes', 80299), '78 KB');
  assert.equal(formatValue('nickname', null), '—');
  assert.equal(formatValue('all', false), 'No');
});

test('describeDetail: a D142 edit shows from → to with names resolved', () => {
  const d = describeDetail({ changed: ['category_id'], changes: { category_id: { from: 16, to: 7 } } }, lookup);
  assert.deepEqual(d.changes, [{ label: 'Category', from: 'Costco', to: 'Shopping' }]);
  assert.equal(d.legacyFields, null);
  assert.deepEqual(d.facts, []);
});

test('describeDetail: a pre-D142 edit admits it only knows which fields changed', () => {
  const d = describeDetail({ changed: ['category_id', 'merchant'] }, lookup);
  assert.deepEqual(d.changes, []);
  assert.deepEqual(d.legacyFields, ['Category', 'Merchant']);
});

test('describeDetail: a merchant cleanup (from/to at the top level) reads as a name change', () => {
  const d = describeDetail({ to: 'Barclaycard', from: null }, lookup);
  assert.deepEqual(d.changes, [{ label: 'Name', from: '—', to: 'Barclaycard' }]);
});

test('describeDetail: other facts become labeled values; nested objects are kept for their own list', () => {
  const d = describeDetail(
    { rows_parsed: 12, detected_account: null, extraction_report: { pages_total: 2 }, suggested_account_id: 7 },
    lookup
  );
  assert.deepEqual(d.facts, [
    { label: 'Rows parsed', value: '12' },
    { label: 'Detected account', value: '—' },
    { label: 'Extraction report', nested: { pages_total: 2 } },
    { label: 'Suggested account', value: 'Chase Total Checking' },
  ]);
});

test('subjectOf: the name the entry recorded, and the entity it touched', () => {
  assert.deepEqual(subjectOf({ entity_type: 'import_batch', entity_id: 5, detail: { original_filename: 'x.pdf' } }), {
    name: 'x.pdf',
    entity: 'Import batch #5',
  });
  assert.deepEqual(subjectOf({ entity_type: null, detail: {} }), { name: null, entity: null });
  // No name in the detail: the API's joined `subject` fills in; an entity with no id prints no "#null".
  assert.deepEqual(subjectOf({ entity_type: 'transaction', entity_id: 1610, subject: 'Costco', detail: { changed: ['category_id'] } }), {
    name: 'Costco',
    entity: 'Transaction #1610',
  });
  assert.equal(subjectOf({ entity_type: 'app_setting', entity_id: null, detail: {} }).entity, 'App setting');
});
