import { createContext, useContext } from 'react';
import { DEFAULT_DESIGN } from './designs';

/**
 * The chosen design (Classic / Vivid). The context and its hook live here,
 * apart from DesignProvider (design-context.jsx), so that file only exports
 * a component and React's fast refresh keeps working (D222).
 */
export const DesignContext = createContext({ design: DEFAULT_DESIGN, setDesign: () => {}, appearance: 'system', setAppearance: () => {}, theme: 'light' });

export const useDesign = () => useContext(DesignContext);
