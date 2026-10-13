import { useEffect, useState } from 'react';

/** True at Tailwind's xl width (1280px) and up, where Glass Settings lays lists out in two columns (D245). */
export function useWide(query = '(min-width: 1280px)') {
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setWide(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return wide;
}

/** Splits a list into two halves, the first one longer when it's odd. */
export const halves = (items) => {
  const mid = Math.ceil(items.length / 2);
  return [items.slice(0, mid), items.slice(mid)];
};
