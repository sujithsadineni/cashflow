/**
 * "Pebbles fixed" for "Where it's going" (D373): the card filled with one
 * tile per category, grouped by family, a few px apart. Plain geometry —
 * WhereMosaic.jsx positions the tiles from it.
 *
 * Tiles are sized on spend^0.36 rather than spend, with a floor, so the
 * biggest don't swamp the card and a $1 category still gets a tile you
 * can see and hover; the exact amounts are on the tiles,
 * the hover card and the list.
 */

/** Squarified treemap (Bruls, Huizing, van Wijk): `items` are { value, … }; returns them with x, y, w, h. */
export function squarify(items, rect) {
  const out = [], total = items.reduce((s, i) => s + i.value, 0);
  if (!total || rect.w <= 0 || rect.h <= 0) return out;
  const scale = (rect.w * rect.h) / total, r = { ...rect };
  let rest = items.map((i) => ({ ...i, area: i.value * scale }));
  const worst = (row, side) => {
    const s = row.reduce((a, i) => a + i.area, 0), mx = Math.max(...row.map((i) => i.area)), mn = Math.min(...row.map((i) => i.area));
    return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
  };
  while (rest.length) {
    const side = Math.min(r.w, r.h); const row = [rest[0]]; let i = 1;
    while (i < rest.length && worst([...row, rest[i]], side) <= worst(row, side)) row.push(rest[i++]);
    rest = rest.slice(i);
    const s = row.reduce((a, it) => a + it.area, 0);
    if (r.w >= r.h) { const cw = s / r.h; let y = r.y; for (const it of row) { const h = it.area / cw; out.push({ ...it, x: r.x, y, w: cw, h }); y += h; } r.x += cw; r.w -= cw; }
    else { const rh = s / r.w; let x = r.x; for (const it of row) { const w = it.area / rh; out.push({ ...it, x, y: r.y, w, h: rh }); x += w; } r.y += rh; r.h -= rh; }
  }
  return out;
}

export const MOSAIC = { gap: 3, familyGap: 8, header: 22, weight: 0.36, minTile: 64 };

/**
 * @param families [{ key, name, items: [{ key, value }] }]
 * @param area { x, y, w, h } the part of the card the tiles may use
 * @returns { heads: [{ key, x, y, w, shown }], tiles: [{ key, family, x, y, w, h }] }
 */
export function mosaicLayout(families, area) {
  const { gap, familyGap, header, weight, minTile } = MOSAIC;
  const shown = families;
  // A floor under every tile's weight, worth about a minTile² square of the area,
  // so a few-cent category gets a tile you can see and hover rather than a sliver.
  const raw = (v) => Math.pow(Math.max(v, 1), weight);
  const sum = shown.reduce((s, f) => s + f.items.reduce((t, c) => t + raw(c.value), 0), 0);
  const floor = (sum * minTile * minTile) / Math.max(area.w * area.h, 1);
  const wt = (v) => Math.max(raw(v), floor);
  const heads = [], tiles = [];
  for (const fr of squarify(shown.map((f) => ({ f, value: f.items.reduce((s, c) => s + wt(c.value), 0) })), area)) {
    const f = fr.f, x = fr.x + familyGap / 2, y = fr.y + familyGap / 2, w = fr.w - familyGap, h = fr.h - familyGap;
    const head = h > 64 && w > 96;
    heads.push({ key: f.key, x, y, w, shown: head });
    const inner = { x, y: y + (head ? header : 0), w, h: h - (head ? header : 0) };
    for (const t of squarify(f.items.map((c) => ({ key: c.key, value: wt(c.value) })), inner)) {
      tiles.push({ key: t.key, family: f.key, x: t.x + gap / 2, y: t.y + gap / 2, w: Math.max(t.w - gap, 0), h: Math.max(t.h - gap, 0) });
    }
  }
  return { heads, tiles };
}
