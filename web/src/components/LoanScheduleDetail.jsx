import { useState } from 'react';
import { formatMoney } from '../api';
import { loanTypeIcon } from './LoanIcons';
import { LoanProgress, LoanInsights } from './LoanProgress';
import { percentClearedFor, VIVID_LOAN } from '../loan-progress';
import { useDesign } from '../design-context';

/**
 * Level 3 of the Loans drill-down: one specific loan. Two shapes,
 * chosen by what data the loan actually has, not by its `loan_type` —
 * a loan with a known term, start date and payment (the Wells Fargo
 * car loan) gets the paid/remaining month grid; anything without that
 * schedule (a 0% balance-transfer card has a deadline and a balance,
 * not a fixed amortization schedule) gets the simpler view.
 *
 * The grid reuses StatementCalendar's exact visual language (a
 * 4x3 year grid, a year stepper) so a household already used to
 * reading that calendar reads this one the same way — green/orange
 * are `earn`/`warn`, the two closest existing tokens to "paid" and
 * "still owing", not a new accent color.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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

/** Every calendar month the loan spans, in order, as {year, month, index} — index is an absolute month count for easy comparison. */
function buildSchedule(loan) {
  const [sy, sm] = loan.start_date.split('-').map(Number);
  const startIndex = sy * 12 + (sm - 1);
  const months = [];
  for (let i = 0; i < loan.term_months; i++) {
    const idx = startIndex + i;
    months.push({ year: Math.floor(idx / 12), month: (idx % 12) + 1, index: idx });
  }
  return months;
}

const fullMonthLabel = (iso) => {
  const [y, m] = iso.split('-').map(Number);
  return `${['January','February','March','April','May','June','July','August','September','October','November','December'][m - 1]} ${y}`;
};

export function LoanScheduleDetail({ loan, onClose }) {
  const hasSchedule = loan.term_months != null && loan.start_date != null;
  const { design } = useDesign();
  const vivid = design === 'vivid';
  const meta = VIVID_LOAN[loan.loan_type] ?? VIVID_LOAN.other;
  const paidClass = vivid ? 'bg-vivid-green' : 'bg-earn';
  const remainingClass = vivid ? 'bg-vivid-amber' : 'bg-warn';
  const schedule = hasSchedule ? buildSchedule(loan) : [];
  const years = [...new Set(schedule.map((m) => m.year))];

  const now = new Date();
  const currentIndex = now.getFullYear() * 12 + now.getMonth();

  const [yearIdx, setYearIdx] = useState(() => {
    if (years.length === 0) return 0;
    const idx = years.indexOf(now.getFullYear());
    if (idx !== -1) return idx;
    return now.getFullYear() < years[0] ? 0 : years.length - 1;
  });

  const year = years[yearIdx];
  const monthsInYear = new Map(schedule.filter((m) => m.year === year).map((m) => [m.month, m]));
  const paidCount = schedule.filter((m) => m.index < currentIndex).length;
  const remainingCount = Math.max(loan.term_months - paidCount, 0);

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-ink/40 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-lg border border-rule bg-raised p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="inline-flex size-7 items-center justify-center rounded-full bg-band text-spend">
              {vivid ? (
                <span className="text-base leading-none" style={meta.flip ? { transform: 'scaleX(-1)' } : undefined}>
                  {meta.emoji}
                </span>
              ) : (
                loanTypeIcon(loan.loan_type)
              )}
            </span>
            <h3 className="text-base font-medium text-ink">{loan.name}</h3>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-muted transition-colors hover:text-ink">
            ✕
          </button>
        </div>
        {loan.lender && <p className="mb-4 ml-9 text-sm text-muted">{loan.lender}</p>}

        {hasSchedule ? (
          <>
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <div className="text-xs text-muted">Balance</div>
                <div className="font-mono text-2xl font-semibold text-spend tnum">
                  {formatMoney(loan.effective_balance_cents)}
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm text-muted">
                  <span className="font-mono text-ink tnum">{paidCount}</span> of{' '}
                  <span className="font-mono text-ink tnum">{loan.term_months}</span> months paid
                </div>
                <div className="text-sm text-muted">
                  <span className="font-mono text-ink tnum">{remainingCount}</span> remaining
                </div>
                <div className="mt-2 flex items-center justify-end gap-3 text-xs text-muted">
                  <span className="flex items-center gap-1"><span className={`size-2 rounded-full ${paidClass}`} /> Paid</span>
                  <span className="flex items-center gap-1"><span className={`size-2 rounded-full ${remainingClass}`} /> Remaining</span>
                </div>
              </div>
            </div>

            <div className="mb-5">
              <LoanProgress type={loan.loan_type} percent={percentClearedFor(loan)} size="lg" />
              <div className="mt-3">
                <LoanInsights loan={loan} percent={percentClearedFor(loan)} />
              </div>
            </div>

            <div className="mb-3 flex items-center justify-center gap-3">
              <YearArrow direction="left" onClick={() => setYearIdx((i) => Math.max(i - 1, 0))} disabled={yearIdx === 0} />
              <div className="w-12 text-center text-sm font-medium text-ink tnum">{year}</div>
              <YearArrow direction="right" onClick={() => setYearIdx((i) => Math.min(i + 1, years.length - 1))} disabled={yearIdx === years.length - 1} />
            </div>

            <div className="mx-auto grid max-w-sm grid-cols-4 gap-3">
              {MONTHS.map((label, i) => {
                const month = i + 1;
                const entry = monthsInYear.get(month);
                if (!entry) {
                  return (
                    <div key={month} className="rounded-md py-2.5 text-center text-sm text-faint">
                      {label}
                    </div>
                  );
                }
                const paid = entry.index < currentIndex;
                return (
                  <div
                    key={month}
                    title={`${label} ${year} — ${paid ? 'Paid' : 'Remaining'}`}
                    className={`rounded-md py-2.5 text-center text-sm font-medium tnum ${
                      paid ? `${paidClass} text-white` : `${remainingClass} text-white`
                    }`}
                  >
                    {label}
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs text-muted">Balance</div>
                <div className="font-mono text-2xl font-semibold text-spend tnum">
                  {formatMoney(loan.effective_balance_cents)}
                </div>
              </div>
              <div className="rounded-lg border border-rule p-3 text-right">
                <div className="text-xs text-muted">{loan.deadline_date ? 'Promo ends' : 'Deadline'}</div>
                <div className="mt-1 font-mono text-lg text-ink tnum">
                  {loan.deadline_date ? fullMonthLabel(loan.deadline_date) : 'Not set'}
                </div>
              </div>
            </div>
            <div className="mt-5">
              <LoanProgress type={loan.loan_type} percent={percentClearedFor(loan)} size="lg" />
              <div className="mt-3">
                <LoanInsights loan={loan} percent={percentClearedFor(loan)} />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
