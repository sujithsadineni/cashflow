/**
 * The card carousel's fixed color palette. Shared between account
 * creation paths (Settings, and the "found a new account" flow off a
 * parsed statement) so every new card gets a distinct-looking default
 * without the user having to configure it.
 *
 * Deliberately more muted than spend/earn — a card's color is
 * personalization, not a third app-wide accent color.
 */
export const CARD_PALETTE = [
  '#3B4B6B', // slate blue
  '#6B4B8A', // plum
  '#8A5A3B', // terracotta
  '#4B6B5A', // sage
  '#6B5A3B', // bronze
  '#3B6B7A', // teal
  '#5A5A6B', // warm gray-blue
  '#7A4B4B', // muted brick
];

export const randomCardColor = () => CARD_PALETTE[Math.floor(Math.random() * CARD_PALETTE.length)];
