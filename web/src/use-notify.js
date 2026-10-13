import { createContext, useContext } from 'react';

/** Toasts. Context and hook apart from NotificationProvider, for fast refresh (D222). */
export const NotificationContext = createContext(null);

/**
 * `notify('Statement uploaded')`, `notify('Upload failed', { type: 'error' })`,
 * or with a heading and a way to deal with it:
 * `notify('Spending −$5,000.00', { title: '7 fixes change your totals', action: { label: 'Open Review', to: '/review?tab=findings' } })`.
 */
export function useNotify() {
  const notify = useContext(NotificationContext);
  if (!notify) throw new Error('useNotify must be used within a NotificationProvider');
  return notify;
}
