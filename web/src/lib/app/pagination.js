/**
 * Which page numbers a pager shows (D397): every page when there are seven
 * or fewer; otherwise the first and last, a run of five at either end, or the
 * current page with one either side, and a gap ('…') for what's skipped:
 *   page 1 of 30  → 1 2 3 4 5 … 30
 *   page 15 of 30 → 1 … 14 15 16 … 30
 *   page 30 of 30 → 1 … 26 27 28 29 30
 * Pages count from 1 here; a gap is the string 'gap-start' or 'gap-end' (React keys).
 */
export function pageItems(current, count) {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
  if (current <= 4) return [1, 2, 3, 4, 5, 'gap-end', count];
  if (current >= count - 3) return [1, 'gap-start', count - 4, count - 3, count - 2, count - 1, count];
  return [1, 'gap-start', current - 1, current, current + 1, 'gap-end', count];
}

export const PAGE_SIZES = [10, 25, 50, 100];

/** How many pages a total makes at a page size (at least one). */
export const pageCount = (total, size) => Math.max(1, Math.ceil(total / size));
