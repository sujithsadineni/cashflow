/**
 * The Wallet card of "Where it's going" (D373): the card's colour is the
 * spending itself. Each category is a soft field of its own colour, laid
 * out like a treemap, and the fields blend in OKLab (no muddy midpoints).
 *
 * So the card reads as many colours, not the biggest one's:
 * - a field's area goes with the square root of its spend, with a floor,
 *   so one large category can't wash over the card and a small one still
 *   shows (exact shares are in the strip under the card);
 * - families are interleaved, so neighbouring fields differ in hue;
 * - the blend is sharp enough that each colour holds its own patch, with
 *   soft edges between them.
 *
 * weightsAt() is the exact maths the GPU shader runs (WhereWallet's
 * wallet-gl.js), so the category named under the pointer is always the
 * colour under it.
 */
import { squarify } from './pebble-mosaic.js';
import { toLab, labToLinear } from './category-palette.js';

export const CARD_RATIO = 1.586;      // a real card's proportions
const UH = 1 / CARD_RATIO;
export const SHARPNESS = 7;          // crisp edges: each colour holds its patch, with a short soft seam
export const MAX_FIELDS = 64;
const FLOOR = 0.035;                  // the smallest field's share of the total weight

/** Biggest first, but never two of a family side by side while another family is waiting. */
export function interleave(items) {
  const left = [...items].sort((a, b) => b.value - a.value), out = [];
  while (left.length) {
    const prev = out[out.length - 1];
    const i = Math.max(left.findIndex((x) => !prev || x.family !== prev.family), 0);
    out.push(left.splice(i, 1)[0]);
  }
  return out;
}

/** Field homes: [{ key, value, family, color: { L, C, h } }] → [{ key, lab, x, y, sx, sy }] in card units (width 1). */
export function fieldHomes(items) {
  const list = interleave(items).slice(0, MAX_FIELDS);
  const raw = list.map((i) => Math.sqrt(Math.max(i.value, 0)));
  const sum = raw.reduce((s, v) => s + v, 0) || 1;
  const weighted = list.map((i, k) => ({ ...i, value: Math.max(raw[k], sum * FLOOR) }));
  // Many small fields get a longer reach, so they flow into each other instead of reading as a grid of squares.
  const reach = 0.6 + Math.min(Math.max(list.length - 12, 0), 24) * 0.012;
  return squarify(weighted, { x: 0, y: 0, w: 1, h: UH }).map((t) => ({
    key: t.key, lab: toLab(t.color), x: t.x + t.w / 2, y: t.y + t.h / 2, sx: Math.max(t.w * reach, 0.05), sy: Math.max(t.h * reach, 0.05),
  }));
}

/** A field's live geometry at time t (s): it wanders a little around its home and breathes. */
export function driftField(f, t, still = false) {
  const m = still ? 0 : 1;
  const breathe = 1 + m * Math.sin((t / (f.p1 * 0.7)) * 6.283 + f.ph) * 0.05;
  return {
    cx: f.x + m * Math.sin((t / f.p1) * 6.283 + f.ph) * f.sx * 0.18,
    cy: f.y + m * Math.cos((t / f.p2) * 6.283 + f.ph * 1.7) * f.sy * 0.18,
    csx: Math.max(f.sx * breathe, 0.02), csy: Math.max(f.sy * breathe, 0.02),
  };
}

/** Softmax of each field's pull at (u, v); `fields` carry live cx, cy, csx, csy, amp. Fills and returns `out`. */
export function weightsAt(u, v, fields, out) {
  let max = -1e9;
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i], dx = (u - f.cx) / f.csx, dy = (v - f.cy) / f.csy;
    out[i] = -SHARPNESS * (dx * dx + dy * dy) + Math.log(f.amp + 1e-4);
    if (out[i] > max) max = out[i];
  }
  let sum = 0;
  for (let i = 0; i < fields.length; i++) { out[i] = Math.exp(out[i] - max); sum += out[i]; }
  for (let i = 0; i < fields.length; i++) out[i] /= sum;
  return out;
}

/** OKLab → 0–255 sRGB, clipped. */
export function labToRgb(lab) {
  return labToLinear(lab).map((x) => { x = Math.min(Math.max(x, 0), 1); return 255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055); });
}

export const cardHeight = UH;
