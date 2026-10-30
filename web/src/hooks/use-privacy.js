import { createContext, useContext } from 'react';

/** Privacy mode (masked amounts). Context and hook apart from PrivacyProvider, for fast refresh (D222). */
export const PrivacyContext = createContext({ privacyMode: false, setPrivacyMode: () => {} });

export const usePrivacy = () => useContext(PrivacyContext);
