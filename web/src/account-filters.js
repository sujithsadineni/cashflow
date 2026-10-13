import { useMemo, useState } from 'react';
import { maskName } from './api';

// "Bank accounts" groups CHECKING + SAVINGS — a household member
// thinking "show me the cards" vs. "show me the accounts" doesn't
// draw the line between those two the way the schema does.
export const ACCOUNT_TYPE_FILTERS = [
  { value: 'ALL', label: 'All accounts' },
  { value: 'BANK', label: 'Bank accounts' },
  { value: 'CREDIT_CARD', label: 'Credit cards' },
];

/**
 * Shared "which of my accounts" filter state — by account type and by
 * person. Used by both the Statements page's card deck and the Cards
 * page's carousel, so the two never drift into slightly different
 * filtering rules. Never reorders or copies `accounts`; just says
 * which ids currently qualify, and hands back the filtered list too
 * for callers (like the carousel) that don't need the unfiltered set.
 */
export function useAccountFilters(accounts, people) {
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [personFilter, setPersonFilter] = useState('ALL'); // 'ALL' or a person id, as a string

  // "Both" reads better than "All" for a two-person household filter —
  // this app's whole scope is exactly these two people, never a
  // variable-sized group, so the specific word fits.
  const personOptions = useMemo(() => [
    { value: 'ALL', label: 'Both' },
    ...people.map((p) => ({ value: String(p.id), label: maskName(p.name) })),
  ], [people]);

  const visibleIds = useMemo(() => new Set(
    accounts
      .filter((a) => {
        if (typeFilter === 'CREDIT_CARD' && a.account_type !== 'CREDIT_CARD') return false;
        if (typeFilter === 'BANK' && a.account_type === 'CREDIT_CARD') return false;
        if (personFilter !== 'ALL' && String(a.person_id) !== personFilter) return false;
        return true;
      })
      .map((a) => a.id)
  ), [accounts, typeFilter, personFilter]);

  const filteredAccounts = useMemo(
    () => accounts.filter((a) => visibleIds.has(a.id)),
    [accounts, visibleIds]
  );

  return { typeFilter, setTypeFilter, personFilter, setPersonFilter, personOptions, visibleIds, filteredAccounts };
}
