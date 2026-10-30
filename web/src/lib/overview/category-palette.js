/**
 * One colour per category for "Where it's going" (D373), every one as far
 * from the others as its family's hue range allows.
 *
 * Categories pick in id order (oldest first), each taking the in-gamut
 * colour in its family's range that is farthest — in OKLab, the space
 * where distance matches what the eye sees — from every colour already
 * taken. Id order, not spend order, keeps a category's colour the same in
 * Month and YTD and from one month to the next; a new category picks last,
 * so adding one never repaints the rest. Colour follows the category,
 * never its rank.
 */
import { familyOf } from './spend-families.js';

const rad = (h) => (h * Math.PI) / 180;
export const toLab = ({ L, C, h }) => [L, C * Math.cos(rad(h)), C * Math.sin(rad(h))];
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) * 100;

/** OKLab → linear sRGB; in gamut when every channel is 0–1. */
export function labToLinear([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}
const inGamut = (lab) => labToLinear(lab).every((x) => x >= -0.001 && x <= 1.001);

/**
 * @param {{ id: number, name: string }[]} categories every category, any order
 * @returns {Map<string, { L, C, h, css, onDark: boolean, family }>} keyed by name;
 *   `onDark` says the colour is light enough that text on it should be dark.
 */
export function categoryPalette(categories) {
  const taken = [];
  const out = new Map();
  for (const c of [...categories].sort((a, b) => a.id - b.id)) {
    const family = familyOf(c.name);
    const [h0, h1] = family.hues, [c0, c1] = family.chroma, [l0, l1] = family.lightness ?? [0.46, 0.82];
    let best = null, bestScore = -1;
    for (let h = h0; h <= h1; h += 3) for (let L = l0; L <= l1 + 1e-9; L += 0.03) for (let C = c0; C <= c1 + 1e-9; C += 0.02) {
      const lab = toLab({ L, C, h: h % 360 });
      if (!inGamut(lab)) continue;
      const near = taken.reduce((m, q) => Math.min(m, dist(lab, q)), 99);
      const score = near + C * 2;        // ties go to the richer colour
      if (score > bestScore) { bestScore = score; best = { L: +L.toFixed(2), C: +C.toFixed(2), h: h % 360, lab }; }
    }
    taken.push(best.lab);
    out.set(c.name, { L: best.L, C: best.C, h: best.h, css: `oklch(${best.L} ${best.C} ${best.h})`, onDark: best.L >= 0.7, family });
  }
  return out;
}

/** A family's own colour (D373): the middle of its hue range, so families read apart at a glance. */
export function familyColor(family) {
  const h = ((family.hues[0] + family.hues[1]) / 2) % 360, C = family.chroma[1] * 0.9, L = family.key === 'move' ? 0.76 : 0.62;
  return { L, C: +C.toFixed(3), h, css: `oklch(${L} ${C.toFixed(3)} ${h})`, onDark: L >= 0.7 };
}

/** A colour for a name the palette doesn't know yet (a category added since it loaded). */
export function fallbackColor(name) {
  const family = familyOf(name);
  const h = (family.hues[0] + family.hues[1]) / 2 % 360;
  return { L: 0.62, C: 0.1, h, css: `oklch(0.62 0.1 ${h})`, onDark: false, family };
}
