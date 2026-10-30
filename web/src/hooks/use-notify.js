import { createContext, useContext } from 'react';

/** Toasts. Context and hook apart from NotificationProvider, for fast refresh (D222). */
export const NotificationContext = createContext(null);

/**
 * By name (D384), from lib/app/toast-names.js, which gives it its title and kind
 * (the household can rename it in Settings → Notifications):
 * `notify(account.name, { name: 'account.closed', action: { label: 'Undo', onClick } })`.
 * The message is the line under the name: which thing ("Freedom ···1234"), never
 * the name again. Keep them short (D287): one line, a one-word action.
 */
export function useNotify() {
  const notify = useContext(NotificationContext);
  if (!notify) throw new Error('useNotify must be used within a NotificationProvider');
  return notify;
}
