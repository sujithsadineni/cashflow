import { useEffect, useState } from 'react';
import { DesignContext } from './use-design';
import { APPEARANCES, DEFAULT_APPEARANCE, DESIGNS, DEFAULT_DESIGN } from './designs';

/**
 * Which look the app renders in. Per-browser (localStorage), same as
 * Privacy mode: it's how one person likes the screen to look, not
 * household data — two people on two browsers can each pick their own.
 *
 * The default is DEFAULT_DESIGN in designs.js (Vivid since D142); a
 * saved choice always wins over it. Components that have a Vivid version branch on
 * `design === 'vivid'`; everything else just keeps rendering Classic.
 */
const STORAGE_KEY = 'cashflow_design';
// Light / dark / auto (D234). index.html reads the same key before React
// starts, so a dark page never flashes white on load.
const APPEARANCE_KEY = 'cashflow_appearance';

const read = (key, valid, fallback) => {
  try {
    const saved = localStorage.getItem(key);
    return valid.some((d) => d.value === saved) ? saved : fallback;
  } catch {
    return fallback;
  }
};
const write = (key, value) => {
  try { localStorage.setItem(key, value); } catch { /* blocked storage: applies for this session */ }
};
const systemDark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;


export function DesignProvider({ children }) {
  const [design, setDesignState] = useState(() => read(STORAGE_KEY, DESIGNS, DEFAULT_DESIGN));
  const [appearance, setAppearanceState] = useState(() => read(APPEARANCE_KEY, APPEARANCES, DEFAULT_APPEARANCE));
  const [osDark, setOsDark] = useState(systemDark);

  const setDesign = (value) => { setDesignState(value); write(STORAGE_KEY, value); };
  const setAppearance = (value) => { setAppearanceState(value); write(APPEARANCE_KEY, value); };

  // "Auto" tracks the computer's setting live, so switching the Mac to dark
  // at sunset turns the app dark too.
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!query) return undefined;
    const onChange = () => setOsDark(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const theme = appearance === 'system' ? (osDark ? 'dark' : 'light') : appearance;

  // Mirrored onto <html> so plain CSS can key off them: index.css repoints
  // the shared color variables per design (D141) and per theme (D234).
  useEffect(() => {
    document.documentElement.dataset.design = design;
    document.documentElement.dataset.theme = theme;
  }, [design, theme]);

  return <DesignContext.Provider value={{ design, setDesign, appearance, setAppearance, theme }}>{children}</DesignContext.Provider>;
}
