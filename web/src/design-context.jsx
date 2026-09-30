import { createContext, useContext, useEffect, useState } from 'react';
import { DESIGNS, DEFAULT_DESIGN } from './designs';

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

const DesignContext = createContext({ design: DEFAULT_DESIGN, setDesign: () => {} });

export function DesignProvider({ children }) {
  const [design, setDesignState] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return DESIGNS.some((d) => d.value === saved) ? saved : DEFAULT_DESIGN;
    } catch {
      return DEFAULT_DESIGN;
    }
  });

  const setDesign = (value) => {
    setDesignState(value);
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // Blocked storage: the choice still applies for this session.
    }
  };

  // Mirrored onto <html> so plain CSS can key off it too — index.css
  // repoints the shared color variables for Vivid (D141).
  useEffect(() => {
    document.documentElement.dataset.design = design;
  }, [design]);

  return <DesignContext.Provider value={{ design, setDesign }}>{children}</DesignContext.Provider>;
}

export const useDesign = () => useContext(DesignContext);
