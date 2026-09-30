import { createContext, useContext, useEffect, useState } from 'react';
import { setGlobalPrivacyMode } from './api';

/**
 * The Settings toggle that drives it. A per-browser display
 * preference (localStorage), not household data — it doesn't belong
 * in Postgres any more than a sidebar being collapsed would.
 */
const STORAGE_KEY = 'cashflow_privacy_mode';

const PrivacyContext = createContext({ privacyMode: false, setPrivacyMode: () => {} });

export function PrivacyProvider({ children }) {
  const [privacyMode, setPrivacyModeState] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });

  // api.js's formatters read a plain module-level flag, not context
  // (see the comment on setGlobalPrivacyMode) -- this keeps the two in sync.
  useEffect(() => {
    setGlobalPrivacyMode(privacyMode);
  }, [privacyMode]);

  const setPrivacyMode = (value) => {
    setPrivacyModeState(value);
    try {
      localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
    } catch {
      // Private browsing / blocked storage: the toggle still works
      // for this session, it just won't be remembered next time.
    }
  };

  return (
    <PrivacyContext.Provider value={{ privacyMode, setPrivacyMode }}>
      {children}
    </PrivacyContext.Provider>
  );
}

export const usePrivacy = () => useContext(PrivacyContext);
