import { useEffect, useState } from 'react';

/**
 * Which of a statement table's columns fit the space it has (D335), by its
 * own width rather than the screen's: beside the real pages the table is
 * narrow on a wide screen. Type goes first, then date and category move under
 * the merchant's name. `count` is the columns shown, for a panel's colSpan.
 * Returns a callback ref for the table's container, and the columns.
 */
export function useColumns() {
  const [node, setNode] = useState(null);
  const [width, setWidth] = useState(null);
  useEffect(() => {
    if (!node) return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  const w = width ?? (typeof window !== 'undefined' ? window.innerWidth : 1024);
  const date = w >= 620;
  const type = w >= 860;
  return [setNode, { date, category: date, type, count: 4 + (date ? 2 : 0) + (type ? 1 : 0) }];
}
