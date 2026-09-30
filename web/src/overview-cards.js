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
];

export const OVERVIEW_CARDS_SETTING_KEY = 'overview_cards';
