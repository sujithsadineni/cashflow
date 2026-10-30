import { useSyncExternalStore } from 'react';
import { DEFAULT_READING_STYLE, READING_STYLE_KEY, isReadingStyle } from '../lib/imports/reading-styles';

/**
 * The reading style picked in Settings → Animation (D335): per browser, like
 * the design, since it's how one person likes the screen to move. Read
 * through an external store so a pick in Settings reaches an open review at
 * once, and another tab follows through the storage event.
 */
const CHANGED = 'cashflow-reading-style';

const read = () => {
  try {
    const saved = localStorage.getItem(READING_STYLE_KEY);
    return isReadingStyle(saved) ? saved : DEFAULT_READING_STYLE;
  } catch {
    return DEFAULT_READING_STYLE;
  }
};
const subscribe = (onChange) => {
  window.addEventListener(CHANGED, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener('storage', onChange);
  };
};

export function useReadingStyle() {
  const style = useSyncExternalStore(subscribe, read, () => DEFAULT_READING_STYLE);
  const setStyle = (value) => {
    try { localStorage.setItem(READING_STYLE_KEY, value); } catch { /* blocked storage: nothing to remember */ }
    window.dispatchEvent(new Event(CHANGED));
  };
  return [style, setStyle];
}
