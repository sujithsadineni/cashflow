/**
 * How wide a line of text is in the page's own font (D373), so a tile or
 * stone shows a name only when the whole name fits. Read off a canvas,
 * which lays text out exactly as the page does; outside a browser (tests,
 * the build) it falls back to an average-width estimate.
 */
let ctx = null;
const cache = new Map();

export function textWidth(text, { size, weight = 500, mono = false }) {
  const key = `${mono ? 'm' : 's'}${weight}/${size}/${text}`;
  if (cache.has(key)) return cache.get(key);
  let width = text.length * size * 0.58;
  if (typeof document !== 'undefined') {
    ctx ??= document.createElement('canvas').getContext('2d');
    const family = mono ? getComputedStyle(document.documentElement).getPropertyValue('--font-mono') : getComputedStyle(document.body).fontFamily;
    ctx.font = `${weight} ${size}px ${family || 'system-ui'}`;
    width = ctx.measureText(text).width * 1.04;        // a hair of slack for the font still loading
  }
  cache.set(key, width);
  return width;
}
