import { useMemo } from 'react';
import { MerchantIconsContext } from './use-merchant-icons';
import { useApi } from './use-api';
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


export function MerchantIconsProvider({ children }) {
  // useApi (D211): `refresh` reloads after an icon is changed in Settings.
  const req = useApi('merchant-icons', async () => {
    const byMerchant = {};
    for (const row of await api.merchantIcons.list()) byMerchant[row.merchant] = row;
    return byMerchant;
  });
  const icons = useMemo(() => req.data ?? {}, [req.data]);
  const refresh = req.reload;

  const value = useMemo(() => ({ icons, refresh }), [icons, refresh]);

  return <MerchantIconsContext.Provider value={value}>{children}</MerchantIconsContext.Provider>;
}

/** The custom icon row for one merchant, or undefined if it has none. */
