/**
 * What a tile or stone of "Where it's going" shows (D373), by the room it
 * has — the owner's order: the icon first; the name under it once the
 * whole name fits; the amount too once all three fit. A name is never cut
 * short ("Entertai…"): one that doesn't fit isn't shown, and the hover
 * card has it. Widths are measured in the real font (measureText), not
 * guessed from the number of letters.
 */
export const TILE_TEXT = { pad: 10, gap: 4, nameLine: 16, amountLine: 21 };

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/**
 * @param {{ w: number, h: number, nameWidth: number, amountWidth: number }} box px
 * @returns {{ show: 'none' | 'icon' | 'name' | 'all', icon: number }} icon size in px
 */
export function tileContent({ w, h, nameWidth, amountWidth }) {
  const { pad, gap, nameLine, amountLine } = TILE_TEXT;
  const iw = w - pad * 2, ih = h - pad * 2;
  if (iw < 12 || ih < 12) return { show: 'none', icon: 0 };
  const text = (lines) => lines.reduce((s, l) => s + l + gap, 0);
  const fits = nameWidth <= iw;
  const all = text([nameLine, amountLine]), one = text([nameLine]);
  if (fits && amountWidth <= iw && ih >= 18 + all) return { show: 'all', icon: Math.round(clamp(Math.min(iw * 0.4, ih - all) * 0.6, 18, 34)) };
  if (fits && ih >= 16 + one) return { show: 'name', icon: Math.round(clamp(Math.min(iw * 0.4, ih - one) * 0.6, 16, 28)) };
  return { show: 'icon', icon: Math.round(clamp(Math.min(iw, ih) * 0.6, 12, 28)) };
}
