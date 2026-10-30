/**
 * How toasts look and where they show (D387), chosen in Settings →
 * Notifications, each design only its own (owner's ask): Glass has two of
 * Apple's looks, Vivid two colourful ones (four kept of seven, D388), Classic
 * its one quiet look. Every
 * design picks one of four places. Saved for the household in app_setting
 * `toast_look` as { glass: { style, position }, vivid: {…}, classic: {…} };
 * anything missing or unknown reads as the design's first look, bottom centre.
 */

export const TOAST_STYLES = {
  classic: [
    { key: 'ledger', label: 'Ledger', description: 'Quiet, as Classic is: solid paper, a hairline, a ring for the time left.' },
  ],
  glass: [
    { key: 'capsule', label: 'Liquid capsule', description: 'Frosted glass. Rises as a capsule holding its glyph, opens out, a light sweeps across once.' },
    { key: 'island', label: 'Dynamic Island', description: 'Always black. A small pill springs open into the toast, and shrinks back into the pill to leave.' },
  ],
  vivid: [
    { key: 'candy', label: 'Candy', description: 'A colour for each kind with an emoji tile. Pops in with a bounce; a success throws confetti.' },
    { key: 'sticker', label: 'Sticker', description: 'A coloured border with a 3D edge and a tilted emoji. Drops in and wobbles before it settles.' },
  ],
};

export const TOAST_POSITIONS = [
  { key: 'bottom-center', label: 'Bottom centre' },
  { key: 'top-center', label: 'Top centre' },
  { key: 'bottom-right', label: 'Bottom right' },
  { key: 'top-right', label: 'Top right' },
];

export const TOAST_LOOK_SETTING_KEY = 'toast_look';

/** The look and place for a design. */
export function lookFor(saved, design) {
  const styles = TOAST_STYLES[design] ?? TOAST_STYLES.classic;
  const own = saved?.[design] ?? {};
  return {
    style: styles.some((s) => s.key === own.style) ? own.style : styles[0].key,
    position: TOAST_POSITIONS.some((p) => p.key === own.position) ? own.position : 'bottom-center',
  };
}

/** Everything saved after changing a design's look or place; other designs keep theirs. */
export function lookChanged(saved, design, change) {
  return { ...(saved ?? {}), [design]: { ...lookFor(saved, design), ...change } };
}
