import { useEffect, useState } from 'react';

/**
 * An element's height as it changes (D360): the statement's fixed head is
 * measured so the table's header can stick right under it. Returns a callback
 * ref and the height in px (0 until measured).
 */
export function useHeight() {
  const [node, setNode] = useState(null);
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (!node) return undefined;
    const observer = new ResizeObserver(([entry]) => setHeight(Math.round(entry.borderBoxSize?.[0]?.blockSize ?? entry.target.offsetHeight)));
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return [setNode, height];
}
