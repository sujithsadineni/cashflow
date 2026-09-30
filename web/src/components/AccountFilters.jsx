import { useMemo, useState } from 'react';
import { maskName } from '../api';
import { Segmented } from './Form';

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

/**
 * The two segmented controls themselves, stacked and centered — asked
 * for directly, twice: on top of each other rather than side by side,
 * and centered rather than pinned to one edge. Each gets its own tone
 * from the design system's existing "informational accent" pair
 * (`info`/`accent2` — already reserved for exactly this: a dashboard
 * concept that isn't money-in or money-out) so the two controls read
 * as distinct without introducing a new hue.
 *
 * `size` defaults to the Statements page's own choice (`lg`) but the
 * Cards page asked for small instead — its layout has much less
 * vertical room next to the single-card carousel than the Statements
 * deck does.
 */
export function AccountFilterBar({ typeFilter, onTypeFilter, personFilter, onPersonFilter, personOptions, size = 'lg' }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <Segmented size={size} tone="info" value={typeFilter} onChange={onTypeFilter} options={ACCOUNT_TYPE_FILTERS} />
      <Segmented size={size} tone="accent2" value={personFilter} onChange={onPersonFilter} options={personOptions} />
    </div>
  );
}
