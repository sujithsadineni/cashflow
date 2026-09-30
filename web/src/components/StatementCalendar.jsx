import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { MonthStatusGrid } from './MonthStatusGrid';

/**
 * A per-account calendar: one year grid, colored by whether we have a
 * statement on file for that month. The grid itself (colors, legend,
 * year stepper, full month names) lives in `MonthStatusGrid.jsx`,
 * shared with the Statements page's own per-account grid — this
 * component is just that page's data source (statement-months) and
 * click behavior. Missing/upcoming still send you to /import; an
 * uploaded tile now calls `onMonthClick` (the Cards page uses it to
 * filter that card's own transaction list down to the clicked month)
 * instead of doing nothing, which is what it used to do here.
 *
 * "Has a statement" comes from the `statement` table, credited to the
 * month the statement CLOSED in (period_end) — that's how issuers
 * themselves label a statement, even when the period spans two
 * calendar months (e.g. Mar 21 - Apr 21).
 */
export function StatementCalendar({ accountId, onMonthClick }) {
  const [months, setMonths] = useState(null); // null while loading
  const [error, setError] = useState(null);
  const [yearIdx, setYearIdx] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    setMonths(null);
    setError(null);
    setYearIdx(0);
    api.accounts
      .statementMonths(accountId)
      .then((data) => { if (!cancelled) setMonths(data.months); })
      .catch((err) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [accountId]);

  if (error) return <p className="text-sm text-spend">{error}</p>;
  if (months === null) return null;

  const monthSet = new Set(months);
  const now = new Date();

  const years = new Set([now.getFullYear()]);
  for (const m of months) years.add(Number(m.slice(0, 4)));
  const sortedYears = [...years].sort((a, b) => b - a); // newest first

  const clampedIdx = Math.min(yearIdx, sortedYears.length - 1);
  const year = sortedYears[clampedIdx];

  return (
    <MonthStatusGrid
      year={year}
      uploadedMonths={monthSet}
      canGoPrevYear={clampedIdx < sortedYears.length - 1}
      canGoNextYear={clampedIdx > 0}
      onPrevYear={() => setYearIdx((i) => Math.min(i + 1, sortedYears.length - 1))}
      onNextYear={() => setYearIdx((i) => Math.max(i - 1, 0))}
      clickableStates={['uploaded', 'upcoming', 'missing']}
      compact
      onTileClick={(state, key) => {
        if (state === 'missing' || state === 'upcoming') navigate('/import');
        else if (state === 'uploaded') onMonthClick?.(key);
      }}
    />
  );
}
