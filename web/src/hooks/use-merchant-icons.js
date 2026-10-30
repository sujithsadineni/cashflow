import { createContext, useContext } from 'react';

/** Custom merchant icons. Context and hooks apart from MerchantIconsProvider, for fast refresh (D222). */
export const MerchantIconsContext = createContext({ icons: {}, refresh: () => {} });

export function useMerchantIcon(merchant) {
  const { icons } = useContext(MerchantIconsContext);
  return merchant ? icons[merchant] : undefined;
}

export function useMerchantIconsRefresh() {
  return useContext(MerchantIconsContext).refresh;
}
