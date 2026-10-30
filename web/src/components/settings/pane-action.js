import { createContext } from 'react';

/**
 * Where a Settings pane can put its one action, opposite its title (D297:
 * Accounts' "Add Account"). Glass Settings provides its header's slot
 * element; elsewhere it's null and the pane shows the action itself.
 */
export const PaneActionSlot = createContext(null);
