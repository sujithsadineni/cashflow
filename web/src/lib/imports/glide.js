/**
 * The statement's page follows the line being read (D335), gently: it only
 * moves when the line leaves the middle of the pane, and then glides there
 * over about 0.7 s, easing in and out. A new target mid-glide carries on from
 * where the pane is (no restart, no jolt), and the person scrolling the pane
 * themselves stops it at once. `band` is the share of the pane, round its
 * middle, a line may sit in without the pane moving.
 */

/** Where the pane should scroll to put a line at `lineTop`..`lineBottom` comfortably in view, or null to stay. */
export function glideTarget({ scrollTop, height, maxScroll, lineTop, lineBottom, band = 0.5 }) {
  const margin = (height * (1 - band)) / 2;
  if (lineTop >= scrollTop + margin && lineBottom <= scrollTop + height - margin) return null;
  const centred = (lineTop + lineBottom) / 2 - height / 2;
  return Math.round(Math.min(Math.max(0, centred), Math.max(0, maxScroll)));
}

export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

const glides = new WeakMap();

/** Glide `box` so the element `line` sits in its middle band. */
export function glideTo(box, line, { reduceMotion = false, duration = 700, band } = {}) {
  if (!box || !line) return;
  const boxRect = box.getBoundingClientRect();
  const lineRect = line.getBoundingClientRect();
  const lineTop = lineRect.top - boxRect.top + box.scrollTop;
  const target = glideTarget({ scrollTop: box.scrollTop, height: box.clientHeight, maxScroll: box.scrollHeight - box.clientHeight, lineTop, lineBottom: lineTop + lineRect.height, band });
  if (target == null) return;
  if (reduceMotion) { box.scrollTop = target; return; }

  const running = glides.get(box);
  if (running) { running.to = target; running.from = box.scrollTop; running.t0 = performance.now(); return; }

  const glide = { from: box.scrollTop, to: target, t0: performance.now(), raf: 0 };
  const stop = () => {
    cancelAnimationFrame(glide.raf);
    glides.delete(box);
    box.removeEventListener('wheel', stop);
    box.removeEventListener('touchstart', stop);
  };
  // The person takes over the moment they scroll it themselves.
  box.addEventListener('wheel', stop, { passive: true });
  box.addEventListener('touchstart', stop, { passive: true });
  const step = (now) => {
    const k = Math.min(1, (now - glide.t0) / duration);
    box.scrollTop = glide.from + (glide.to - glide.from) * easeInOut(k);
    if (k < 1) glide.raf = requestAnimationFrame(step);
    else stop();
  };
  glides.set(box, glide);
  glide.raf = requestAnimationFrame(step);
}
