import { useState } from 'react';
import { useApi } from '../../hooks/use-api';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api';
import { MonthStatusGrid } from './MonthStatusGrid';
import { useCardMonths } from '../../hooks/use-statement-gaps';

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
 * month the statement CLOSED in (period_end) — for bank accounts. A
 * credit card's months come judged from the server instead (D269): each
 * month shows what holds its 15th, so a card closing on the 5th has its
 * "Sep 6 – Oct 5" statement on September, where its rows are, and its
 * silent and missing months come from the statement-gap verdicts (D268).
 */
export function StatementCalendar({ accountId, openedOn = null, onMonthClick }) {
  const req = useApi(`statement-months:${accountId}`, () => api.accounts.statementMonths(accountId), { tags: ['imports'] });
  const months = req.loading ? null : req.data?.months ?? null; // null while loading
  const error = req.error;
  // The year being looked at belongs to the card; another card starts on its latest (D211).
  const [yearPick, setYearPick] = useState({ accountId: null, idx: 0 });
  const yearIdx = yearPick.accountId === accountId ? yearPick.idx : 0;
  const setYearIdx = (fn) => setYearPick({ accountId, idx: fn(yearIdx) });
  const navigate = useNavigate();
  const cardMonths = useCardMonths(accountId);

  if (error) return <p className="text-sm text-spend">{error}</p>;
  if (months === null) return null;

  const monthSet = new Set(months);
  const now = new Date();

  const years = new Set([now.getFullYear()]);
  for (const m of [...months, ...Object.keys(cardMonths ?? {})]) years.add(Number(m.slice(0, 4)));
  const sortedYears = [...years].sort((a, b) => b - a); // newest first

  const clampedIdx = Math.min(yearIdx, sortedYears.length - 1);
  const year = sortedYears[clampedIdx];

  return (
    <MonthStatusGrid
      year={year}
      uploadedMonths={monthSet}
      states={cardMonths}
      openedOn={openedOn}
      canGoPrevYear={clampedIdx < sortedYears.length - 1}
      canGoNextYear={clampedIdx > 0}
      onPrevYear={() => setYearIdx((i) => Math.min(i + 1, sortedYears.length - 1))}
      onNextYear={() => setYearIdx((i) => Math.max(i - 1, 0))}
      clickableStates={['uploaded', 'upcoming', 'missing', 'ask']}
      compact
      onTileClick={(state, key) => {
        if (state === 'ask') navigate('/review?tab=silent');
        else if (state === 'missing' || state === 'upcoming') navigate('/import');
        else if (state === 'uploaded') onMonthClick?.(key);
      }}
    />
  );
}
