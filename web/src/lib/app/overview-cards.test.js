import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OVERVIEW_CARDS, toggledSetting, visibleCards, layoutFrom } from './overview-cards.js';

const ALL = OVERVIEW_CARDS.map((c) => c.key);

test('unset means every card on; a save of cards switched off keeps a new card on (D311)', () => {
  assert.deepEqual(visibleCards(null), ALL);
  assert.deepEqual(visibleCards({ hidden: ['zelle'] }), ALL.filter((k) => k !== 'zelle'));
  assert.deepEqual(visibleCards({ hidden: ['a_card_since_removed'] }), ALL);
});

test('an older save (the cards on) reads as before', () => {
  assert.deepEqual(visibleCards(['investment', 'zelle']), ['investment', 'zelle']);
});

test('switching a card saves what is off', () => {
  const { visible, saved } = toggledSetting(ALL, 'zelle');
  assert.equal(visible.includes('zelle'), false);
  assert.deepEqual(saved, { hidden: ['zelle'] });
  assert.deepEqual(toggledSetting(visible, 'zelle').saved, { hidden: [] });
});

// D375: the sections under "Where it's going" start off, and so does one added later.
test('Overview sections are off until switched on, and remember only what was switched on', async () => {
  const { shownSections, toggledSections, OVERVIEW_SECTIONS } = await import('./overview-cards.js');
  assert.deepEqual(shownSections(null), []);
  assert.deepEqual(shownSections({ shown: ['largest', 'not-a-section'] }), ['largest']);
  const on = toggledSections([], 'activity');
  assert.deepEqual(on, { shown: ['activity'], saved: { shown: ['activity'] } });
  assert.deepEqual(toggledSections(on.shown, 'activity').shown, []);
  assert.deepEqual(OVERVIEW_SECTIONS.map((s) => s.key), ['by_person', 'largest', 'activity']);
});

test('the layout reads as Slim rows unless a known one is saved (D378)', () => {
  assert.equal(layoutFrom(null), 'slim');
  assert.equal(layoutFrom({ layout: 'rail' }), 'rail');
  assert.equal(layoutFrom({ layout: 'bento' }), 'bento');
  assert.equal(layoutFrom({ layout: 'a_layout_since_removed' }), 'slim');
});
