/**
 * Apple's activity indicator (D376): twelve spokes, each a step dimmer
 * than the one before, turning in twelve ticks a second — the spinner
 * macOS and iOS draw while something loads. It replaces the "Loading…"
 * text everywhere. In ink and greys, so it sits in every design and
 * theme; under Reduce Motion it breathes instead of turning.
 *
 *   <Loading />            a block, the spinner in its middle
 *   <Loading page />       the middle of the page, while a whole page loads
 *   <Loading size={14} />  smaller, inside a row
 *   <Spinner />            just the spinner, inline
 */
const SPOKES = Array.from({ length: 12 }, (_, i) => i);

export function Spinner({ size = 20, className = '', label = 'Loading' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role="status" aria-label={label} className={`activity-indicator shrink-0 ${className}`}>
      {SPOKES.map((i) => (
        <rect key={i} x="11" y="1.5" width="2" height="6" rx="1" fill="currentColor"
          opacity={0.18 + (0.82 * (12 - i)) / 12} transform={`rotate(${-i * 30} 12 12)`} />
      ))}
    </svg>
  );
}

/**
 * Skeleton screens (D389, the owner's preference): grey shapes where a
 * page's content will be, so it arrives without the page jumping. For a
 * whole page or a list; the spinner stays for small spots (a dialog, a row).
 * Still in Classic, a slow sheen in Vivid and Glass (index.css `.skeleton`).
 *
 *   <PageSkeleton />          a page: title, a row of figures, a list
 *   <ListSkeleton rows={8} /> a list's rows
 */
const WIDTHS = ['w-3/5', 'w-2/5', 'w-1/2', 'w-2/3', 'w-1/3', 'w-3/4', 'w-1/2', 'w-2/5'];

export function Skeleton({ className = '', round = false }) {
  return <span aria-hidden="true" className={`skeleton block ${round ? 'rounded-full' : 'rounded-md'} ${className}`} />;
}

function SkeletonRow({ i }) {
  return (
    <div className="flex items-center gap-3 border-b border-rule py-3 last:border-b-0">
      <Skeleton round className="h-8 w-8 shrink-0" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className={`h-3 ${WIDTHS[i % WIDTHS.length]}`} />
        <Skeleton className="h-2.5 w-1/4" />
      </div>
      <Skeleton className="h-3 w-16 shrink-0" />
    </div>
  );
}

export function ListSkeleton({ rows = 8, className = '' }) {
  return (
    <div role="status" aria-label="Loading" data-skeleton="" className={`w-full ${className}`}>
      {Array.from({ length: rows }, (_, i) => <SkeletonRow key={i} i={i} />)}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div role="status" aria-label="Loading" data-skeleton="" className="w-full">
      <Skeleton className="mb-2 h-6 w-48" />
      <Skeleton className="mb-6 h-3 w-72 max-w-full" />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-3 rounded-xl border border-rule p-4">
            <Skeleton className="h-2.5 w-1/2" />
            <Skeleton className="h-6 w-3/4" />
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-rule px-4">
        {Array.from({ length: 6 }, (_, i) => <SkeletonRow key={i} i={i} />)}
      </div>
    </div>
  );
}

export function Loading({ page = false, size, className = '', tone = 'text-muted' }) {
  return (
    <div className={`flex w-full items-center justify-center ${page ? 'min-h-[60vh]' : 'py-10'} ${tone} ${className}`}>
      <Spinner size={size ?? (page ? 28 : 20)} />
    </div>
  );
}
