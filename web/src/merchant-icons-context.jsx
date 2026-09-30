import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api';

/**
 * Custom merchant icon overrides (a photo or an emoji), loaded once
 * and shared everywhere `MerchantAvatar` renders. A Context instead
 * of a prop — unlike `people`/`accounts`/`categories`, which already
 * flow down from App.jsx into each page, `MerchantAvatar` is called
 * from eight places at very different nesting depths (deep inside
 * Transactions rows, Cards, Overview's "largest this month", Merchant
 * history, Income's Other Income cards, ...). Threading a new prop
 * through all of them would touch far more files than the feature
 * itself. `MerchantAvatar` reads the override through `useMerchantIcon`
 * internally, so none of its call sites change.
 */

const MerchantIconsContext = createContext({ icons: {}, refresh: () => {} });

export function MerchantIconsProvider({ children }) {
  const [icons, setIcons] = useState({});

  const refresh = useCallback(async () => {
    const rows = await api.merchantIcons.list();
    const byMerchant = {};
    for (const row of rows) byMerchant[row.merchant] = row;
    setIcons(byMerchant);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const value = useMemo(() => ({ icons, refresh }), [icons, refresh]);

  return <MerchantIconsContext.Provider value={value}>{children}</MerchantIconsContext.Provider>;
}

/** The custom icon row for one merchant, or undefined if it has none. */
export function useMerchantIcon(merchant) {
  const { icons } = useContext(MerchantIconsContext);
  return merchant ? icons[merchant] : undefined;
}

export function useMerchantIconsRefresh() {
  return useContext(MerchantIconsContext).refresh;
}
