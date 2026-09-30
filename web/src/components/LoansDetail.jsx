import { useEffect, useState } from 'react';
import { api, formatMoney } from '../api';
import { Button } from './Form';
import { LoanForm, EMPTY_LOAN } from './Loans';
import { loanTypeIcon } from './LoanIcons';
import { motion } from 'motion/react';
import { LoanProgress, LoanInsights } from './LoanProgress';
import { percentClearedFor, VIVID_LOAN } from '../loan-progress';
import { useDesign } from '../design-context';
import { LoanScheduleDetail } from './LoanScheduleDetail';

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (iso) => {
  const [y, m] = iso.split('-').map(Number);
  return `${MONTH_ABBR[m - 1]} ${y}`;
};

/**
 * Vivid (D140): a summary strip up top — total owed, how many loans,
 * the next deadline — then one tinted card per loan in its type's own
 * color, with an emoji tile, the animated track (LoanProgress) and its
 * "thoughts" (LoanInsights). Cards arrive one after another.
 */
function VividLoansSummary({ loans }) {
  const total = loans.reduce((sum, l) => sum + (l.effective_balance_cents ?? 0), 0);
  const next = loans
    .filter((l) => l.deadline_date)
    .sort((a, b) => a.deadline_date.localeCompare(b.deadline_date))[0];
  return (
    <div className="mb-4 grid grid-cols-2 gap-3 rounded-2xl bg-vivid-amber/10 p-4">
      <div>
        <div className="text-xs text-muted">💰 Total owed</div>
        <div className="font-mono text-2xl font-semibold tnum text-vivid-loss">{formatMoney(total)}</div>
        <div className="text-xs text-muted">across {loans.length} loan{loans.length === 1 ? '' : 's'}</div>
      </div>
      {next && (
        <div className="text-right">
          <div className="text-xs text-muted">⏰ Next deadline</div>
          <div className="font-mono text-lg font-semibold tnum text-ink">{monthLabel(next.deadline_date)}</div>
          <div className="truncate text-xs text-muted">{next.name}</div>
        </div>
      )}
    </div>
  );
}

function VividLoanCard({ loan, index, onOpen }) {
  const meta = VIVID_LOAN[loan.loan_type] ?? VIVID_LOAN.other;
  const percent = percentClearedFor(loan);
  return (
    <motion.button
      onClick={onOpen}
      className={`block w-full rounded-2xl p-4 text-left ${meta.tint}`}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -3, boxShadow: '0 8px 20px -8px rgb(27 36 32 / 0.25)' }}
      transition={{ delay: index * 0.08, type: 'spring', stiffness: 260, damping: 22 }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <motion.span
            className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-raised text-2xl leading-none shadow-sm"
            whileHover={{ rotate: [0, -12, 10, -4, 0], scale: 1.15 }}
            transition={{ duration: 0.6 }}
            aria-hidden="true"
          >
            <span style={meta.flip ? { transform: 'scaleX(-1)' } : undefined}>{meta.emoji}</span>
          </motion.span>
          <div className="min-w-0">
            <div className="truncate font-medium text-ink">{loan.name}</div>
            {loan.lender && <div className="truncate text-xs text-muted">{loan.lender}</div>}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-mono font-semibold text-vivid-loss tnum">{formatMoney(loan.effective_balance_cents)}</div>
          {loan.deadline_date && <div className="text-xs text-muted">due {monthLabel(loan.deadline_date)}</div>}
        </div>
      </div>
      <div className="mt-3">
        <LoanProgress type={loan.loan_type} percent={percent} size="sm" />
      </div>
      <div className="mt-3">
        <LoanInsights loan={loan} percent={percent} />
      </div>
    </motion.button>
  );
}

/**
 * Level 2 of the Loans drill-down: one card per loan, plus an inline
 * "add a loan" card — reuses the exact `LoanForm` Settings already
 * has, so there's one form shape, not a second copy that could drift.
 * Clicking a loan opens Level 3 (`LoanScheduleDetail`) as a separate
 * stacked overlay, not nested inside this one.
 */
export function LoansDetail({ accounts, month, onClose, onChanged }) {
  const [loans, setLoans] = useState(null);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [selectedLoan, setSelectedLoan] = useState(null);
  const { design } = useDesign();
  const vivid = design === 'vivid';

  const load = async () => {
    try {
      // Same month the summary card behind this drill-down is already
      // showing (Overview.jsx) — a loan that hadn't started yet is
      // left out entirely by the backend, not just shown at $0.
      const rows = await api.loans.list(false, month);
      setLoans(rows);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => { load(); }, [month]);

  const handleCreated = () => {
    setAdding(false);
    load();
    onChanged?.();
  };

  return (
    <>
      <div className="fixed inset-0 z-20 flex items-center justify-center bg-ink/30 p-4" onClick={onClose}>
        <div
          className={`max-h-[85vh] w-full overflow-y-auto rounded-lg border border-rule bg-raised p-5 shadow-lg ${vivid ? 'max-w-xl' : 'max-w-lg'}`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-base font-medium text-ink">{vivid ? '🏦 Loans' : 'Loans'}</h3>
              {month && <p className="text-xs text-faint">As of {monthLabel(month)}</p>}
            </div>
            <button onClick={onClose} aria-label="Close" className="text-muted transition-colors hover:text-ink">
              ✕
            </button>
          </div>

          {error && <p className="mb-3 text-sm text-spend">{error}</p>}
          {!loans && !error && <p className="py-8 text-center text-sm text-muted">Loading…</p>}

          {loans && loans.length === 0 && (
            <p className="mb-3 text-sm text-muted">
              No loans yet{month ? ` as of ${monthLabel(month)}` : ''}.
            </p>
          )}

          {vivid && loans && loans.length > 0 && <VividLoansSummary loans={loans} />}

          {loans && (
            <div className="space-y-3">
              {vivid && loans.map((loan, index) => (
                <VividLoanCard key={loan.id} loan={loan} index={index} onOpen={() => setSelectedLoan(loan)} />
              ))}
              {!vivid && loans.map((loan) => (
                <button
                  key={loan.id}
                  onClick={() => setSelectedLoan(loan)}
                  className="block w-full rounded-lg border border-rule p-4 text-left transition-colors hover:bg-band"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-band text-spend">
                        {loanTypeIcon(loan.loan_type)}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-ink">{loan.name}</div>
                        {loan.lender && <div className="truncate text-xs text-muted">{loan.lender}</div>}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="font-mono text-spend tnum">{formatMoney(loan.effective_balance_cents)}</div>
                      {loan.deadline_date && (
                        <div className="text-xs text-faint">due {monthLabel(loan.deadline_date)}</div>
                      )}
                    </div>
                  </div>
                  <div className="mt-3">
                    <LoanProgress type={loan.loan_type} percent={percentClearedFor(loan)} size="sm" />
                  </div>
                </button>
              ))}

              {adding ? (
                <LoanForm
                  mode="create"
                  initial={EMPTY_LOAN}
                  accounts={accounts}
                  submitLabel="Add loan"
                  savingLabel="Adding…"
                  onSubmit={async (payload) => handleCreated(await api.loans.create(payload))}
                  onCancel={() => setAdding(false)}
                />
              ) : (
                <button
                  onClick={() => setAdding(true)}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-rule-str
                             p-4 text-sm text-muted transition-colors hover:border-ink hover:text-ink"
                >
                  <span aria-hidden>{vivid ? '➕' : '+'}</span> Add a loan
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {selectedLoan && (
        <LoanScheduleDetail loan={selectedLoan} onClose={() => setSelectedLoan(null)} />
      )}
    </>
  );
}
