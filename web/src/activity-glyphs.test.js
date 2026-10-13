import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activityGlyph, dayLabel, TONES } from './activity-glyphs.js';
import { describeDetail } from './activity-format.js';

test('activityGlyph: a known action gets its glyph and its area colour', () => {
  assert.deepEqual(activityGlyph('import.uploaded'), { icon: 'cloud-upload', color: TONES.imports });
  assert.deepEqual(activityGlyph('recurring.linked'), { icon: 'link', color: TONES.recurring });
});

test('activityGlyph: removals and failures are red, whatever their area', () => {
  assert.equal(activityGlyph('import.deleted').color, TONES.alert);
  assert.equal(activityGlyph('category.deleted').color, TONES.alert);
  assert.equal(activityGlyph('import.parse_failed').color, TONES.alert);
});

test('activityGlyph: an unknown action still gets a glyph, coloured by its area or grey', () => {
  assert.deepEqual(activityGlyph('loan.got_polished'), { icon: 'ellipse', color: TONES.money });
  assert.deepEqual(activityGlyph('widget.spun'), { icon: 'ellipse', color: TONES.system });
});

test('dayLabel: Today, Yesterday, a weekday this week, else the full date', () => {
  const now = new Date(2026, 9, 13, 9, 0); // Tue Oct 13 2026
  assert.equal(dayLabel(new Date(2026, 9, 13, 0, 5), now), 'Today');
  assert.equal(dayLabel(new Date(2026, 9, 12, 23, 59), now), 'Yesterday');
  assert.equal(dayLabel(new Date(2026, 9, 9, 12, 0), now), 'Friday');
  assert.equal(dayLabel(new Date(2026, 9, 5, 12, 0), now), 'Monday, October 5');
  assert.equal(dayLabel(new Date(2025, 11, 31, 12, 0), now), 'Wednesday, December 31, 2025');
});

test('describeDetail: a run whose "changed" list is empty is not shown as a legacy edit', () => {
  const { legacyFields, facts } = describeDetail({ payments: 112, changed: [] });
  assert.equal(legacyFields, null);
  assert.deepEqual(facts, [{ label: 'Payments', value: '112' }]);
});

// D253: every action the API writes has words and a glyph. Scans the API's
// own source, so a new audit action without them fails here, not on screen.
test('every audit action the API writes has a label and a glyph', async () => {
  const { readFileSync, readdirSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { describeAction } = await import('./activity-format.js');
  const { activityGlyph } = await import('./activity-glyphs.js');
  const root = new URL('../../api/src', import.meta.url).pathname;
  const files = [];
  const walk = (dir) => readdirSync(dir).forEach((f) => { const p = join(dir, f); statSync(p).isDirectory() ? walk(p) : f.endsWith('.js') && !f.endsWith('.test.js') && files.push(p); });
  walk(root);
  const actions = new Set();
  for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(/audit\(\{\s*action:\s*'([a-z_]+\.[a-z_]+)'/g)) actions.add(m[1]);
  assert.ok(actions.size > 30, `found ${actions.size} actions`);
  const unlabelled = [...actions].filter((a) => describeAction(a).emoji === '•');
  const unglyphed = [...actions].filter((a) => activityGlyph(a).icon === 'ellipse');
  assert.deepEqual(unlabelled, [], 'no label');
  assert.deepEqual(unglyphed, [], 'no glyph');
});

// D253: the Glass glyph bundles hold every icon the code can ask for (a missing
// one draws an empty tile). Read as text: the bundles are JSX.
test('the Glass glyph bundles cover every activity and category icon', async () => {
  const { readFileSync } = await import('node:fs');
  const { ACTIVITY_ICON_NAMES } = await import('./activity-glyphs.js');
  const { ICON_CATALOG } = await import('./category-icon-keys.js');
  const activity = readFileSync(new URL('./glass-activity-glyphs.jsx', import.meta.url), 'utf8');
  const category = readFileSync(new URL('./glass-category-glyphs.jsx', import.meta.url), 'utf8');
  assert.deepEqual(ACTIVITY_ICON_NAMES.filter((n) => !activity.includes(`'${n}':`)), []);
  assert.deepEqual(ICON_CATALOG.filter((k) => !category.includes(`'${k}':`)), []);
});
