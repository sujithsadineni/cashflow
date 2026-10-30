import { useDesign } from '../../hooks/use-design';
/**
 * An always-visible year stepper + 12 month buttons — replaces the
 * old click-to-open dropdown panel (a button that read like a date,
 * opening a 3x4 grid). That was a 2-click round trip for the single
 * most common action on this page; asked directly for something
 * faster, this is every month one click away, all the time, same
 * idea as the Statements page's own year grid.
 *
 * No separate "year being browsed" state: stepping the year jumps
 * the selection straight to the same month in that year, since
 * there's no reason to browse without picking once the whole grid is
 * always on screen (unlike a dropdown, where you browse before
 * confirming).
 *
 * `ahead`: how many months past this one can be picked (Recurring looks a
 * year ahead at bills to come; everything else stops at this month). One
 * picker for every page (D312).
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function MonthPicker({ value, onChange, ahead = 0 }) {
  const { design } = useDesign();
  const selectedClass = design === 'vivid' ? 'bg-vivid-green text-white' : 'bg-ink text-paper';
  const [year, monthNum] = value.split('-').map(Number);
  const now = new Date();
  const thisYear = now.getFullYear();
  const thisMonth = now.getMonth() + 1;
  // The last month that can be picked, as a month count.
  const last = thisYear * 12 + thisMonth + ahead;
  const lastYear = Math.floor((last - 1) / 12);

  const pick = (i) => onChange(`${year}-${String(i + 1).padStart(2, '0')}`);
  // Stepping lands on the same month, or the last pickable one when that's past it.
  const stepYear = (delta) => {
    const m = Math.min((year + delta) * 12 + monthNum, last);
    onChange(`${Math.floor((m - 1) / 12)}-${String(((m - 1) % 12) + 1).padStart(2, '0')}`);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1">
        <button
          onClick={() => stepYear(-1)}
          aria-label="Previous year"
          className="flex size-6 items-center justify-center rounded-full border border-rule
                     text-muted transition-colors hover:bg-band hover:text-ink"
        >
          ‹
        </button>
        <span className="w-11 text-center text-sm font-medium text-ink tnum">{year}</span>
        <button
          onClick={() => stepYear(1)}
          disabled={year >= lastYear}
          aria-label="Next year"
          className="flex size-6 items-center justify-center rounded-full border border-rule
                     text-muted transition-colors hover:bg-band hover:text-ink
                     disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
        >
          ›
        </button>
      </div>

      <div className="flex flex-wrap gap-1">
        {MONTHS.map((name, i) => {
          const isSelected = i + 1 === monthNum;
          const isFuture = year * 12 + i + 1 > last;
          return (
            <button
              key={name}
              onClick={() => pick(i)}
              disabled={isFuture}
              className={`rounded-md px-2 py-1 text-xs font-medium tnum transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${
                isSelected ? selectedClass : 'text-muted hover:bg-band hover:text-ink'
              }`}
            >
              {name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
