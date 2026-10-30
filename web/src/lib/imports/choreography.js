/**
 * How Import paces a statement being read (D325), in one place: the owner
 * found it rushed ("these are small PDFs"), so every beat is named here and
 * tuned here, never scattered as numbers through the components.
 *
 * Each reading box: it works (`step`), its tick lands (`tick`), then the
 * line draws to the next box (`link`). After "Yes, that's it" on Find the
 * card: the deck narrows (`filters`), the card slides to second place
 * (`lift`) and comes forward (`pick`), and its month starts filling. The
 * month fills as the remaining boxes finish (landingFill) and settles with a
 * ring (`settle`). Milliseconds unless the name says seconds.
 */
export const PACE = {
  step: 1300,
  tick: 450,
  link: 450,
  hold: 1000, // the finished row, before it folds away
  stopHold: 1800, // a stop that closes by itself (a file already on file)
  foldSeconds: 0.6, // the boxes folding back into the drop zone
  filters: 650,
  lift: 750,
  pick: 500,
  settle: 900,
};

/** A box's whole turn: working, its tick, the line to the next. */
export const boxTurn = (skips = false) => (skips ? PACE.step / 3 : PACE.step) + PACE.tick + PACE.link;

/**
 * How full the month's tile is while the statement uploads into it, from how
 * many boxes have finished. It starts when Find the card's box is done (a
 * little fill and the arrow rising, so something happens at once) and is
 * full when the last box is.
 */
export function landingFill(finished, { from = 3, total = 6, start = 0.15 } = {}) {
  if (finished <= from) return start;
  if (finished >= total) return 1;
  return start + ((1 - start) * (finished - from)) / (total - from);
}

/** The number a note starts with, to count up to ("48 rows", "41 of 48 sorted"); null when there's none. */
export function leadingNumber(note) {
  const m = /^(\d+)(.*)$/s.exec(note ?? '');
  return m ? { n: Number(m[1]), rest: m[2] } : null;
}
