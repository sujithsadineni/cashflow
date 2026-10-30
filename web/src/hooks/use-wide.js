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

/** Splits a list into n columns read top to bottom, the first ones longer when it doesn't divide evenly. */
export const columnsOf = (items, n) => {
  const per = Math.ceil(items.length / n);
  return Array.from({ length: n }, (_, i) => items.slice(i * per, (i + 1) * per));
};

/** Splits a list into two halves, the first one longer when it's odd. */
export const halves = (items) => columnsOf(items, 2);
