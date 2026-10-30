import { formatMoney } from '../../api';

/** Shared by the year explorers on Overview (components/overview/MoneyExplorer.jsx, D285). */
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** An amount with a true minus sign, never a plus: colour says which way it went. */
export const signed = (c) => `${c < 0 ? '−' : ''}${formatMoney(Math.abs(c))}`;
export const NO_FILTER = { kind: null, account: null, month: null };
