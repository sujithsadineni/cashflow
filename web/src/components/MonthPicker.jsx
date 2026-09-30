import { useDesign } from '../design-context';
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
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function MonthPicker({ value, onChange }) {
  const { design } = useDesign();
  const selectedClass = design === 'vivid' ? 'bg-vivid-green text-white' : 'bg-ink text-paper';
  const [year, monthNum] = value.split('-').map(Number);
  const now = new Date();
  const thisYear = now.getFullYear();
  const thisMonth = now.getMonth() + 1;

  const pick = (i) => onChange(`${year}-${String(i + 1).padStart(2, '0')}`);
  const stepYear = (delta) => onChange(`${year + delta}-${String(monthNum).padStart(2, '0')}`);

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
          disabled={year >= thisYear}
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
          const isFuture = year > thisYear || (year === thisYear && i + 1 > thisMonth);
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
