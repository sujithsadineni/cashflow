import { formatMoney, formatShortDate } from '../../api';

const BAR = { muted: 'bg-muted', warn: 'bg-warn', spend: 'bg-spend' };
const TEXT = { muted: 'text-ink', warn: 'text-warn', spend: 'text-spend' };

/**
 * How much of a credit limit is used (D346): the figures the statement printed
 * and a thin bar. `u` comes from cardUtilisation() or householdUtilisation().
 * Quiet under 30%, amber from 30%, red from 70% (lib/cards/utilisation.js).
 */
export function UtilisationBar({ u, note, className = '', compact = false, trailing = null }) {
  if (!u) return null;
  const width = `${Math.min(Math.max(u.pct, u.used > 0 ? 1 : 0), 100)}%`;
  // Compact (D360): one short box, the share used and what's left over the bar in four fifths of it,
  // and a control (the statement's Date | Printed) in the last fifth.
  if (compact) {
    return (
      // Four fifths and one, but never narrower than the control needs.
      <div className={`grid grid-cols-[minmax(0,4fr)_minmax(7rem,1fr)] items-center gap-3 ${className}`}>
        <div className="min-w-0">
          <div className="truncate text-[12.5px] leading-4 text-muted">
            <span className={`font-medium tnum ${TEXT[u.tone]}`}>{u.pct}%</span> of {u.manual ? 'your' : 'the'} limit used
            {u.available != null && <>{' · '}<span className="font-mono tnum">{formatMoney(u.available)}</span> left{u.availableEstimated && !u.manual ? ' (est.)' : ''}</>}
          </div>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-band" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={u.pct} aria-label="Credit used">
            <div className={`h-full rounded-full ${BAR[u.tone]}`} style={{ width }} />
          </div>
        </div>
        <div className="flex justify-end">{trailing}</div>
      </div>
    );
  }
  return (
    <div className={className}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[13px] text-muted">
        <span>
          <span className={`font-medium tnum ${TEXT[u.tone]}`}>{u.pct}%</span> of the limit used
          {' · '}<span className="font-mono tnum">{formatMoney(u.used)}</span> of <span className="font-mono tnum">{formatMoney(u.limit)}</span>
        </span>
        <span className="tnum">
          {u.available != null && <><span className="font-mono">{formatMoney(u.available)}</span> available{u.availableEstimated ? ' (est.)' : ''}</>}
          {u.asOf && <>{u.available != null ? ' · ' : ''}as of {formatShortDate(u.asOf)}</>}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-band" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={u.pct} aria-label="Credit used">
        <div className={`h-full rounded-full ${BAR[u.tone]}`} style={{ width }} />
      </div>
      {note && <p className="mt-1 text-[12px] text-faint">{note}</p>}
    </div>
  );
}
