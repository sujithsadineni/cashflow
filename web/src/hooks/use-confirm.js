import { createContext, useContext } from 'react';

/** The app's confirm sheet. Context and hook apart from ConfirmProvider, for fast refresh (D222). */
export const ConfirmContext = createContext(null);

/**
 * `if (!(await confirm({ title: 'Discard changes?', confirm: 'Discard', destructive: true }))) return;`
 * In place of `window.confirm`, whose dialog is the browser's and looks it (D312).
 * Resolves true or false; Esc, the backdrop and Cancel are false.
 */
export function useConfirm() {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('useConfirm must be used within a ConfirmProvider');
  return confirm;
}
