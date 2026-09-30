import { useEffect, useState } from 'react';
import { api, formatMoney } from '../api';
import { LoanProgress, LoanInsights } from './LoanProgress';
import { percentClearedFor, VIVID_LOAN, loanMonthStatus } from '../loan-progress';
import { useDesign } from '../design-context';
import { DetailDialog, ShowMore } from './ui/DetailDialog';

/**
 * Level 3 of the Loans drill-down: one loan, month by month.
 *
 * Built on GET /api/loans/:id/history, so every month shows what was
 * actually paid — the issuer's printed payments for a loan linked to a
 * card, or Loan payments matched by the lender's name otherwise — and
 * what was still owed at that month's end (the same balance formula the
 * rest of the app uses). The first version of this grid coloured a
 * month "paid" just because it was in the past; it now only says paid
 * when a payment was found.
 *
 * The calendar keeps StatementCalendar's visual language (a 4x3 year
 * grid with a year stepper). Classic uses the existing earn/warn/spend
 * tokens; Vivid its own palette.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (ym) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const ymOf = (year, month) => `${year}-${String(month).padStart(2, '0')}`;

const STATUS_TEXT = {
  paid: 'Paid',
  due: 'Due this month',
  none: 'No payment found',
  ahead: 'Still ahead',
  before: 'Before your records',
  started: 'Loan started',
  untracked: 'Payments not tracked',
};

const PAID_SOURCE_NOTE = {
  statement: 'Paid is read from the linked card’s statements; remaining is the balance at each month’s end.',
  lender_match: 'Paid is every Loan payment whose description names this lender; remaining is the balance at each month’s end.',
  null: 'This loan has no linked card and no lender, so payments can’t be matched to it — add a lender in Settings → Loans to see them.',
};

function YearArrow({ direction, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={direction === 'left' ? 'Previous year' : 'Next year'}
      className="flex size-6 shrink-0 items-center justify-center rounded-full border border-rule
                 text-muted transition-colors hover:bg-band disabled:cursor-not-allowed disabled:opacity-30"
    >
      <svg width="7" height="11" viewBox="0 0 9 14" fill="none" aria-hidden="true"
           style={direction === 'right' ? { transform: 'scaleX(-1)' } : undefined}>
        <path d="M8 1L1.5 7L8 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

/** Every month on a fixed schedule (start + term), as 'YYYY-MM'. */
function scheduleMonths(loan) {
  if (loan.term_months == null || loan.start_date == null) return [];
  const [sy, sm] = loan.start_date.split('-').map(Number);
  return Array.from({ length: loan.term_months }, (_, i) => {
    const idx = sy * 12 + (sm - 1) + i;
    return ymOf(Math.floor(idx / 12), (idx % 12) + 1);
  });
}

export function LoanScheduleDetail({ loan, onClose }) {
  const vivid = useDesign().design === 'vivid';
  const meta = VIVID_LOAN[loan.loan_type] ?? VIVID_LOAN.other;
  const [history, setHistory] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.loans
      .history(loan.id)
      .then((h) => !cancelled && setHistory(h))
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [loan.id]);

  const now = new Date();
  const currentMonth = ymOf(now.getFullYear(), now.getMonth() + 1);
  const byMonth = new Map((history?.months ?? []).map((m) => [m.month, m]));
  // The calendar covers the schedule when there is one, plus any month with history.
  const allMonths = [...new Set([...scheduleMonths(loan), ...byMonth.keys()])].sort();
  const years = [...new Set(allMonths.map((m) => Number(m.slice(0, 4))))];
  const [yearIdx, setYearIdx] = useState(null);
  // Opens on this year when the loan spans it, otherwise on its latest year.
  const thisYearIdx = years.indexOf(now.getFullYear());
  const shownYearIdx = yearIdx ?? (thisYearIdx !== -1 ? thisYearIdx : Math.max(years.length - 1, 0));
  const year = years[Math.min(shownYearIdx, years.length - 1)];

  const statusOf = (ym) => {
    const h = byMonth.get(ym);
    return loanMonthStatus({ month: ym, paidCents: h?.paid_cents ?? 0, paidSource: history?.paid_source ?? null, currentMonth, recordsFrom: history?.records_from, startMonth: allMonths[0] });
  };
  const STATUS_CLASS = {
    paid: vivid ? 'bg-vivid-green text-white' : 'bg-earn text-white',
    ahead: vivid ? 'bg-vivid-amber text-white' : 'bg-warn text-white',
    none: vivid ? 'bg-vivid-red/15 text-vivid-loss' : 'bg-spend/10 text-spend',
    due: 'border border-rule-str bg-raised text-ink',
    before: 'bg-band text-muted',
    started: 'bg-band text-muted',
    untracked: 'bg-band text-muted',
  };

  const percent = percentClearedFor(loan);
  const rows = [...(history?.months ?? [])].reverse(); // newest first

  const progress = (
    <div>
      <LoanProgress type={loan.loan_type} percent={percent} size="lg" />
      <div className="mt-3">
        <LoanInsights loan={loan} percent={percent} />
      </div>
    </div>
  );

  const calendar = years.length === 0 ? (
    <p className="text-sm text-muted">No months to show yet.</p>
  ) : (
    <div>
      <div className="mb-3 flex items-center justify-center gap-3">
        <YearArrow direction="left" onClick={() => setYearIdx(Math.max(shownYearIdx - 1, 0))} disabled={shownYearIdx === 0} />
        <div className="w-12 text-center text-sm font-medium text-ink tnum">{year}</div>
        <YearArrow direction="right" onClick={() => setYearIdx(Math.min(shownYearIdx + 1, years.length - 1))} disabled={shownYearIdx >= years.length - 1} />
      </div>
      <div className="mx-auto grid max-w-sm grid-cols-4 gap-3">
        {MONTHS.map((label, i) => {
          const ym = ymOf(year, i + 1);
          if (!allMonths.includes(ym)) {
            return <div key={ym} className="rounded-md py-2.5 text-center text-sm text-faint">{label}</div>;
          }
          const status = statusOf(ym);
          const h = byMonth.get(ym);
          const title = `${monthLabel(ym)} — ${STATUS_TEXT[status]}${h?.paid_cents ? `, ${formatMoney(h.paid_cents)} paid` : ''}`;
          return (
            <div key={ym} title={title} className={`rounded-md py-2.5 text-center text-sm font-medium tnum ${STATUS_CLASS[status]}`}>
              {label}
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted">
        {['paid', 'none', 'due', 'ahead', 'started', 'before', 'untracked'].filter((s) => allMonths.some((m) => statusOf(m) === s)).map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className={`size-2.5 rounded-sm ${STATUS_CLASS[s]}`} /> {STATUS_TEXT[s]}
          </span>
        ))}
      </div>
    </div>
  );

  const list = (
    <ShowMore
      items={rows}
      limit={6}
      className="flex flex-col divide-y divide-rule"
      render={(m) => {
        const status = statusOf(m.month);
        return (
          <div key={m.month} className="flex items-center gap-3 py-2 text-sm">
            <span className="w-20 shrink-0 text-ink">{monthLabel(m.month)}</span>
            {/* On phones there's no room for this beside two amounts — the calendar above shows it. */}
            <span className={`hidden min-w-0 flex-1 truncate text-xs sm:block ${status === 'none' ? 'text-spend' : 'text-muted'}`}>{STATUS_TEXT[status]}</span>
            <span className="flex-1 sm:hidden" />
            <span className="w-24 text-right font-mono text-earn tnum">{m.paid_cents ? formatMoney(m.paid_cents) : '—'}</span>
            <span className="w-24 text-right font-mono text-ink tnum">{m.remaining_cents != null ? formatMoney(m.remaining_cents) : '—'}</span>
          </div>
        );
      }}
    />
  );

  const listWithHeader = (
    <div>
      <div className="flex gap-3 border-b border-rule pb-1 text-xs text-faint">
        <span className="w-20 shrink-0">Month</span>
        <span className="flex-1" />
        <span className="w-24 text-right">Paid</span>
        <span className="w-24 text-right">Remaining</span>
      </div>
      {list}
    </div>
  );

  const loading = <p className="text-sm text-muted">{error ?? 'Loading…'}</p>;

  return (
    <DetailDialog
      title={loan.name}
      emoji={meta.emoji}
      tint={meta.tint}
      width="max-w-xl"
      hero={{ label: loan.lender ? `Balance · ${loan.lender}` : 'Balance', value: formatMoney(loan.effective_balance_cents), tone: 'spend' }}
      side={{
        label: 'Paid so far',
        value: history?.total_paid_cents != null ? formatMoney(history.total_paid_cents) : '—',
        tone: 'earn',
      }}
      sections={[
        { key: 'progress', label: 'Progress', content: progress },
        { key: 'calendar', label: 'Month by month', tab: 'Calendar', content: history ? calendar : loading },
        { key: 'list', label: 'Paid and remaining', tab: 'Paid & remaining', count: rows.length || undefined, content: history ? listWithHeader : loading },
      ]}
      note={history ? PAID_SOURCE_NOTE[history.paid_source] : null}
      onClose={onClose}
    />
  );
}
