/**
 * The small secondary cards on Overview (Cashback & Interest, Fees &
 * Interest, To India, Zelle Transfers, Investment) — shared between
 * Settings (the visibility toggle list) and Overview (which ones
 * actually render), so the two can never drift out of sync on what
 * "every card" means. Icons stay local to Overview.jsx (only it draws
 * them); this is just the ordered key/label list.
 *
 * The next card that gets added — the household already knows there
 * will be one — is one line here plus its own tile in Overview.jsx,
 * not a schema change: `app_setting`'s `overview_cards` value is a
 * plain array of keys, defaulting to "every key in this list" when
 * unset, so an existing household with an old saved preference still
 * sees a brand-new card as soon as it ships (their saved list just
 * won't have opted it out).
 */
// `emoji`/`tint` draw the Vivid preview tile in Settings → Overview
// cards (D151) — the same emoji each card's own popup uses.
export const OVERVIEW_CARDS = [
  { key: 'cashback_interest', label: 'Cashback & Interest', emoji: '🎁', tint: 'bg-vivid-green/10' },
  { key: 'fee_interest', label: 'Fees & Interest', emoji: '🧾', tint: 'bg-vivid-red/10' },
  { key: 'investment', label: 'Investment', emoji: '📊', tint: 'bg-vivid-blue/10' },
  { key: 'india_transfer', label: 'To India', emoji: '🌏', tint: 'bg-vivid-teal/10' },
  { key: 'zelle', label: 'Zelle Transfers', emoji: '💸', tint: 'bg-vivid-pink/10' },
  { key: 'credit_used', label: 'Credit used', emoji: '💳', tint: 'bg-vivid-amber/10' },
];

export const OVERVIEW_CARDS_SETTING_KEY = 'overview_cards';

/**
 * The cards on, from the saved setting (D311). It's saved as the cards
 * switched off ({ hidden: [...] }), so a card added later starts on, as
 * Settings promises. An older save is the list of cards on (an array) and
 * reads as it always did: until the next toggle rewrites it, a card it
 * doesn't name stays off.
 */
export function visibleCards(saved) {
  const all = OVERVIEW_CARDS.map((c) => c.key);
  if (Array.isArray(saved)) return all.filter((k) => saved.includes(k));
  const hidden = saved?.hidden ?? [];
  return all.filter((k) => !hidden.includes(k));
}

/** What to save after switching `key`: the cards now off. */
export function toggledSetting(visible, key) {
  const next = visible.includes(key) ? visible.filter((k) => k !== key) : [...visible, key];
  return { visible: next, saved: { hidden: OVERVIEW_CARDS.map((c) => c.key).filter((k) => !next.includes(k)) } };
}

/**
 * The sections under "Where it's going" (D375): off by default, so Overview
 * reads at one glance on a laptop, each brought back in Settings → Overview
 * cards. Saved as the sections switched on ({ shown: [...] }) — the reverse
 * of the cards above — so a section added later starts off too.
 */
export const OVERVIEW_SECTIONS = [
  { key: 'by_person', label: 'Spending by person' },
  { key: 'largest', label: 'Largest this month' },
  { key: 'activity', label: 'Activity chart' },
];
export const OVERVIEW_SECTIONS_SETTING_KEY = 'overview_sections';
export const shownSections = (saved) => OVERVIEW_SECTIONS.map((s) => s.key).filter((k) => (saved?.shown ?? []).includes(k));
export function toggledSections(shown, key) {
  const next = shown.includes(key) ? shown.filter((k) => k !== key) : [...shown, key];
  return { shown: next, saved: { shown: next } };
}

/**
 * How Overview lays its cards out at laptop width (D378), from the 08 mock:
 * Slim rows (D375, the default), the numbers as a rail beside "Where it's
 * going", or a bento with the small cards in a column beside it. Below 1024px
 * every layout stacks the same way. Saved as { layout: key }; an unknown or
 * unset value reads as Slim rows.
 */
export const OVERVIEW_LAYOUTS = [
  { key: 'slim', label: 'Slim rows', description: 'The cards in two short rows, the card under them.' },
  { key: 'rail', label: 'Stats rail', description: 'Every number in a column on the left; the card gets the full height.' },
  { key: 'bento', label: 'Bento', description: 'The four cards on top; the small cards in a column beside it.' },
];
export const OVERVIEW_LAYOUT_SETTING_KEY = 'overview_layout';
export const layoutFrom = (saved) => (OVERVIEW_LAYOUTS.some((l) => l.key === saved?.layout) ? saved.layout : 'slim');
