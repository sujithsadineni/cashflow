import { formatMoney } from '../api';

/**
 * A small real trend, shared by the Income and Spend dialogs: one bar
 * per month (January through whichever month is selected), current
 * month picked out at full opacity, the rest dimmed. Always real data
 * from `GET /api/summary` (`income_by_month`/`spend_by_month`), never
 * placeholder bars — the whole point is showing the actual shape of
 * the year so far, not decoration.
 */

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const TONE = {
  earn: { full: 'bg-earn', dim: 'bg-earn/35' },
  spend: { full: 'bg-spend', dim: 'bg-spend/35' },
};

export function MiniTrend({ months, valueKey, tone = 'earn' }) {
  const { full, dim } = TONE[tone];
  const max = Math.max(...months.map((m) => Math.abs(m[valueKey])), 1);

  return (
    <div className="flex h-[22px] items-end gap-0.5" role="img" aria-label="Trend by month, so far this year">
      {months.map((m, i) => (
        <span
          key={m.month}
          title={`${MONTH_ABBR[Number(m.month.slice(5, 7)) - 1]}: ${formatMoney(m[valueKey])}`}
          className={`w-[5px] rounded-sm ${i === months.length - 1 ? full : dim}`}
          style={{ height: `${Math.max((Math.abs(m[valueKey]) / max) * 100, 4)}%` }}
        />
      ))}
    </div>
  );
}
