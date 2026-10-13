import { Segmented } from './Form';
import { ACCOUNT_TYPE_FILTERS } from '../account-filters';

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
    // min-w-0: as a flex item it would otherwise grow to its tabs' width and spill off a phone (D232).
    <div className="flex min-w-0 max-w-full flex-col items-center gap-3">
      <Segmented size={size} tone="info" value={typeFilter} onChange={onTypeFilter} options={ACCOUNT_TYPE_FILTERS} />
      <Segmented size={size} tone="accent2" value={personFilter} onChange={onPersonFilter} options={personOptions} />
    </div>
  );
}
