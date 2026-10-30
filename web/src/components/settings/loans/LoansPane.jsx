import { useCallback, useContext, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { api } from '../../../api';
import { invalidate, useApi } from '../../../hooks/use-api';
import { useNotify } from '../../../hooks/use-notify';
import { useConfirm } from '../../../hooks/use-confirm';
import { useDesign } from '../../../hooks/use-design';
import { useWide } from '../../../hooks/use-wide';
import { centsToInput } from '../../../lib/loans/loan-edit';
import { installmentName } from '../../../lib/loans/loan-form';
import { LoanScheduleDetail } from '../../loans/LoanScheduleDetail';
import { PaneActionSlot } from '../pane-action';
import { LoanList } from './LoanList';
import { LoanDetail } from './LoanDetail';
import { Loading } from '../../ui/Loading';

/**
 * Settings → Loans (D298), the same Apple split view as Accounts (D297): the
 * list beside the chosen loan, pushed to its own screen on a phone, the
 * choice in the URL (?tab=loans&loan=3). The detail reads until Edit, then
 * edits in place; Add opens it empty, and Track opens it filled in from a
 * card's statement, to check before adding. Leaving an edit with changes
 * asks first. Closing is reversible, so it has Undo, not an alert.
 *
 * Settings is where loans are edited; the Overview's Loans card keeps its
 * read-only countdown (D240). Motion is Vivid's and Glass's only.
 */

// The local date, not UTC's: in the evening UTC is already tomorrow.
const today = () => new Date().toLocaleDateString('en-CA');

export function LoansPane({ accounts, onChange }) {
  const [params, setParams] = useSearchParams();
  const { design } = useDesign();
  const reduceMotion = useReducedMotion();
  // Where list and detail sit side by side (lg); below it the list stands alone.
  const wide = useWide('(min-width: 1024px)');
  const notify = useNotify();
  const confirm = useConfirm();
  const [mode, setMode] = useState('view'); // view | edit | add
  const [addStart, setAddStart] = useState(null);
  const [busyKey, setBusyKey] = useState(null);
  const [history, setHistory] = useState(null);
  const dirty = useRef(false);
  const onDirty = useCallback((d) => { dirty.current = d; }, []);

  const loansReq = useApi('loans:settings', () => api.loans.list(true), { tags: ['loans'] });
  const suggestionsReq = useApi('loan-suggestions', () => api.loans.suggestions(), { tags: ['loans'] });
  // Closed cards too, so a loan on one still shows its card.
  const accountsReq = useApi('accounts:with-closed', () => api.accounts.list(true), { tags: ['loans'] });
  const all = loansReq.data ?? [];
  const open = all.filter((l) => l.is_active);
  const closed = all.filter((l) => !l.is_active);
  const allAccounts = accountsReq.data ?? accounts;
  const refresh = () => { invalidate('loans'); onChange?.(); };

  const chosenId = Number(params.get('loan')) || null;
  const chosen = all.find((l) => l.id === chosenId) ?? null;
  // Wide screens show something even before a choice; it isn't put in the URL.
  const selected = chosen ?? open[0] ?? null;

  /** Leaving an edit with changes asks first; nothing else does. */
  // Leaving an edit with changes asks first, in the app's own sheet (D312).
  const leave = async (then) => {
    if (dirty.current && !(await confirm({ title: 'Discard your changes to this loan?', confirm: 'Discard', destructive: true }))) return;
    dirty.current = false;
    setMode('view');
    setAddStart(null);
    then?.();
  };
  const select = (id) => leave(() => setParams({ tab: 'loans', loan: String(id) }));
  const back = () => leave(() => setParams({ tab: 'loans' }));
  const startAdd = (start = null) => leave(() => { setAddStart(start); setMode('add'); });

  const saved = (loan, changes) => {
    dirty.current = false;
    setMode('view');
    setAddStart(null);
    refresh();
    notify(loan.name, { name: changes ? 'loan.saved' : 'loan.added' });
    if (!changes) setParams({ tab: 'loans', loan: String(loan.id) });
  };

  const setOpen = async (loan, isOpen, undoing = false) => {
    try {
      if (isOpen) await api.loans.update(loan.id, { is_active: true });
      else await api.loans.deactivate(loan.id);
      refresh();
      notify(loan.name, {
        name: isOpen ? 'loan.reopened' : 'loan.closed',
        action: undoing ? null : { label: 'Undo', onClick: () => setOpen(loan, !isOpen, true) },
      });
    } catch (err) {
      notify(`${loan.name}: ${err.message}`, { name: isOpen ? 'error.reopen' : 'error.close' });
    }
  };

  // A suggested transfer opens as a new loan, filled in from its statement, to check before adding.
  // A loan paid from the bank every month (D419): its payments fill the form; the person adds the months.
  const track = (s) => startAdd(s.kind === 'installment' ? {
    name: installmentName(s),
    lender: s.lender,
    loan_type: s.loan_type,
    start_date: s.start_date,
    monthly_payment: centsToInput(s.monthly_payment_cents),
    payment_account_id: String(s.payment_account_id),
    current_balance: '',
  } : {
    name: `${s.account_name} balance transfer`,
    lender: s.issuer ?? '',
    loan_type: 'balance_transfer',
    linked_account_id: String(s.account_id),
    start_date: s.draw_date ?? '',
    deadline_date: s.end_date ?? '',
    current_balance: centsToInput(Math.max(s.balance_cents ?? s.draw_cents ?? 0, 0)),
  });
  const dismiss = async (s) => {
    setBusyKey(s.key);
    try {
      await api.loans.dismissSuggestion(s.key);
      suggestionsReq.setData((items) => (items ?? []).filter((x) => x.key !== s.key));
      notify(`${s.lender ?? s.account_name} won't be suggested again`, { name: 'loan.suggestion_hidden' });
    } catch (err) {
      notify(err.message, { name: 'error.hide' });
    } finally {
      setBusyKey(null);
    }
  };

  const detailOpen = Boolean(chosen) || mode === 'add';
  const still = design === 'classic' || reduceMotion;

  // Add Loan sits opposite the pane's title: in Glass's header (its slot),
  // elsewhere at the top of the pane, across from the counts.
  const slot = useContext(PaneActionSlot);
  const addButton = (
    // Its own focus scope: in Glass it's portalled into the header, outside the pane's.
    <span className="apple-pane">
      <button
        type="button"
        onClick={() => startAdd()}
        className="inline-flex items-center gap-1.5 rounded-full bg-info/10 px-3.5 py-1.5 text-[15px] font-medium text-info transition-colors duration-150 hover:bg-info/15 active:bg-info/20"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        Add Loan
      </button>
    </span>
  );

  if (loansReq.error) return <p className="text-[13px] text-spend">Couldn't load loans: {loansReq.error}</p>;

  const detail = mode === 'add' || selected ? (
    <LoanDetail
      loan={mode === 'add' ? null : selected}
      mode={mode}
      accounts={allAccounts}
      loans={all}
      start={addStart}
      still={still}
      today={today()}
      onEdit={() => setMode('edit')}
      onCancel={() => leave()}
      onSaved={saved}
      onDirty={onDirty}
      onSetOpen={setOpen}
      onOwedSaved={() => { refresh(); notify(selected.name, { name: 'loan.owed' }); }}
      onHistory={setHistory}
    />
  ) : (
    loansReq.data ? <p className="py-16 text-center text-[13px] text-muted">Add a loan to track what&apos;s owed and when it&apos;s due.</p> : <Loading className="py-16" />
  );

  return (
    <>
      {slot ? createPortal(addButton, slot) : (
        <div className="mb-6 flex items-center justify-between gap-3">
          <p className="text-[13px] text-muted tnum">
            {open.length} {open.length === 1 ? 'loan' : 'loans'}{closed.length > 0 ? ` · ${closed.length} closed` : ''}
          </p>
          {addButton}
        </div>
      )}
      <div className="apple-pane lg:grid lg:grid-cols-[22rem_minmax(0,1fr)] lg:items-start lg:gap-10">
        <nav aria-label="Loans" className={detailOpen ? 'hidden lg:block' : ''}>
          <LoanList
            loans={open}
            closed={closed}
            suggestions={suggestionsReq.data ?? []}
            accounts={allAccounts}
            // On a phone only a chosen row is selected; the wide fallback isn't open there.
          selectedId={mode === 'add' ? null : wide ? selected?.id : chosen?.id}
            onSelect={select}
            onTrack={track}
            onDismiss={dismiss}
            busyKey={busyKey}
            today={today()}
          />
        </nav>

        <section aria-label={mode === 'add' ? 'New loan' : selected?.name ?? 'Loan'} className={`split-detail ${detailOpen ? '' : 'hidden lg:block'}`}>
          <button
            type="button"
            onClick={() => (mode === 'add' ? leave() : back())}
            className="mb-4 flex items-center gap-1 rounded-md text-[15px] text-info lg:hidden"
          >
            <svg width="9" height="15" viewBox="0 0 8 13" aria-hidden="true"><path d="M6.5 1.5 1.5 6.5l5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            Loans
          </button>
          <motion.div
            // Edit happens in place; only another loan (or Add) fades in anew.
            key={mode === 'add' ? 'new' : selected?.id ?? 'none'}
            initial={still ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
          >
            {detail}
          </motion.div>
        </section>
      </div>
      {history && <LoanScheduleDetail loan={history} onClose={() => setHistory(null)} />}
    </>
  );
}
