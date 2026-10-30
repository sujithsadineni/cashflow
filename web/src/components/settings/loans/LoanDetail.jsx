import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { api, formatMoney, dollarsToCents, maskName } from '../../../api';
import { accountArt } from '../../../lib/cards/account-art';
import { aprText, longDate, monthWords, paceOf, planMonths, warningSentences } from '../../../lib/loans/balance-transfer';
import { countdownFor } from '../../../lib/loans/loan-countdown';
import { LOAN_TYPE_LABEL } from '../../../lib/loans/loan-types';
import { loanForm, blankLoan, loanProblems, scheduleGap, loanChanges, createPayload, balanceSourceWords, lenderChoices, owedIsKnown } from '../../../lib/loans/loan-edit';
import { Dropdown } from '../../ui/Dropdown';
import { DatePicker } from '../../ui/DatePicker';
import { dayWords } from '../../../lib/cards/card-days';
import { LoanCard } from './LoanCard';
import { GroupBlock, GroupRow, GroupButton, RowChevron, CardArt } from '../apple/grouped';
import { SuggestField } from '../apple/SuggestField';

/**
 * One loan (D298), read and edited in the same place, as Accounts is (D297):
 * Edit turns each fact into its field where it sits, the name into a field
 * in the title, and the groups that can't be edited fade away below. Add is
 * the same screen, empty, or filled in from a suggested balance transfer.
 *
 * What's owed follows the app's three sources (routes/loans.js): read off a
 * linked card's statement, so shown and never edited here; estimated from a
 * payment, term and start; or typed by hand, the only case it's a field.
 * The detail says which, in words. A balance transfer's 0% period is read
 * off the card's statements (D192, D193) and only laid out here.
 *
 * Choices are the app's Dropdown and calendar in their row style, the lender
 * suggests names on file: no browser controls, no green focus (.apple-pane).
 */

const TONE = { spend: 'text-spend', warn: 'text-warn', earn: 'text-earn', muted: 'text-muted' };
const FIELD = 'w-full min-w-0 bg-transparent text-right text-ink outline-none placeholder:text-faint';
const FOCUS_ROW = 'focus-within:bg-band';
const fade = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.16 } };
const TYPE_OPTIONS = Object.entries(LOAN_TYPE_LABEL).map(([value, label]) => ({ value, label }));
const notSet = <span className="text-faint">Not set</span>;
const money = (cents) => (cents == null ? notSet : <span className="text-ink tnum">{formatMoney(Number(cents))}</span>);
const date = (iso) => (iso ? <span className="text-ink tnum">{longDate(String(iso).slice(0, 10))}</span> : notSet);
const parts = (ps) => ps.map((p, i) => (typeof p === 'string' ? p : <span key={i} className="tnum">{formatMoney(p.cents)}</span>));

/** The big mark at the top: the card it's on, Wallet-style, or its own matte card (LoanCard, D299). */
function Mark({ loan, account }) {
  if (account) return <CardArt art={accountArt(account)} className="w-28 sm:w-36" />;
  return <LoanCard loan={loan} />;
}

/** Edit / Cancel · Done, the same pill size either way so the header holds still. */
function Actions({ editing, adding, saving, canSave, onEdit, onCancel, still }) {
  const pill = 'rounded-full px-3.5 py-1 text-[15px] transition-[background-color,filter,opacity] duration-150';
  const body = editing ? (
    <>
      <button type="button" onClick={onCancel} disabled={saving} className={`${pill} text-info hover:bg-info/10 active:bg-info/15`}>Cancel</button>
      <button type="submit" disabled={saving || !canSave} className={`${pill} bg-info font-semibold text-white hover:brightness-110 active:brightness-95 disabled:opacity-40`}>
        {saving ? (adding ? 'Adding…' : 'Saving…') : adding ? 'Add' : 'Done'}
      </button>
    </>
  ) : (
    <button type="button" onClick={onEdit} className={`${pill} text-info hover:bg-info/10 active:bg-info/15`}>Edit</button>
  );
  if (still) return <div className="flex items-center gap-1.5">{body}</div>;
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.div key={editing ? 'editing' : 'reading'} className="flex items-center gap-1.5" {...fade}>{body}</motion.div>
    </AnimatePresence>
  );
}

/** Groups only the reading view has; they fade as Edit begins, below everything that stays. */
function ReadOnly({ show, still, children }) {
  if (still) return show ? <div className="space-y-7">{children}</div> : null;
  return <AnimatePresence initial={false}>{show && <motion.div key="read" className="space-y-7" {...fade}>{children}</motion.div>}</AnimatePresence>;
}

/** A hand-entered balance, updated in its row without opening the whole edit. */
function UpdateOwed({ loan, onSaved }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const cents = dollarsToCents(amount);
    if (Number.isNaN(cents) || cents < 0) return setError('An amount, like 18,400.00');
    setBusy(true);
    try {
      await api.loans.update(loan.id, { current_balance_cents: cents });
      setOpen(false);
      setAmount('');
      setError(null);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  if (!open) return <GroupButton onClick={() => setOpen(true)}>Update What's Owed</GroupButton>;
  return (
    <>
      <GroupRow label="Owed today" as="label" htmlFor={`owed-${loan.id}`} invalid={Boolean(error)} className={FOCUS_ROW}>
        <input
          id={`owed-${loan.id}`}
          autoFocus
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); save(); }
            if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
          }}
          inputMode="decimal"
          placeholder="0.00"
          className={`${FIELD} tnum`}
        />
        <button type="button" onClick={() => setOpen(false)} className="rounded-md px-1 text-[15px] text-muted hover:text-ink">Cancel</button>
        <button type="button" onClick={save} disabled={busy || !amount.trim()} className="rounded-md px-1 text-[15px] font-semibold text-info disabled:opacity-40">Save</button>
      </GroupRow>
      {error && <p className="px-4 pb-2 text-[13px] text-spend">{error}</p>}
    </>
  );
}

export function LoanDetail({ loan = null, mode, accounts, loans, start, still, today, onEdit, onCancel, onSaved, onDirty, onSetOpen, onOwedSaved, onHistory }) {
  const adding = mode === 'add';
  const editing = mode !== 'view';

  // A fresh form each time an edit (or an add) begins, set during render so
  // the first edit frame already holds the loan's values.
  const sessionKey = editing ? `${mode}:${loan?.id ?? 'new'}:${JSON.stringify(start ?? {})}` : null;
  const [s, setS] = useState({ key: null, form: null, before: null, touched: {}, serverError: null, saving: false });
  if (s.key !== sessionKey) {
    const base = !editing ? null : adding ? blankLoan(start) : loanForm(loan);
    setS({ key: sessionKey, before: base, form: base, touched: {}, serverError: null, saving: false });
  }
  const form = s.form;
  const ready = !editing || Boolean(form);
  const dirty = editing && ready && JSON.stringify(form) !== JSON.stringify(s.before);
  useEffect(() => { onDirty?.(dirty); }, [dirty, onDirty]);
  // The pass that starts an edit has no form yet; the next one does.
  if (!ready) return null;

  const type = editing ? form.loan_type : loan.loan_type;
  const linkedId = editing ? form.linked_account_id : String(loan.linked_account_id ?? '');
  const account = accounts.find((a) => String(a.id) === linkedId) ?? null;
  const isBT = type === 'balance_transfer';
  const problems = editing ? loanProblems(form) : {};
  if (s.serverError?.field) problems[s.serverError.field === 'current_balance_cents' ? 'current_balance' : s.serverError.field] = s.serverError.message;
  const shown = (key) => (s.touched[key] || s.touched.all ? problems[key] : null);
  const set = (key) => (value) => setS((x) => ({
    ...x, form: { ...x.form, [key]: value }, touched: { ...x.touched, [key]: true },
    serverError: x.serverError?.field === key ? null : x.serverError,
  }));
  const setEv = (key) => (e) => set(key)(e.target.value);

  async function submit(e) {
    e.preventDefault();
    if (!editing) return;
    setS((x) => ({ ...x, touched: { all: true } }));
    if (Object.keys(problems).length > 0) return;
    if (!adding && !dirty) return onCancel();
    setS((x) => ({ ...x, saving: true, serverError: null }));
    try {
      if (adding) onSaved(await api.loans.create(createPayload(form)), null);
      else {
        const changes = loanChanges(s.before, form);
        onSaved(await api.loans.update(loan.id, changes), changes);
      }
    } catch (err) {
      // The backend names the field it rejected, so the row can say it.
      setS((x) => ({ ...x, saving: false, serverError: { message: err.message, field: err.field } }));
    }
  }

  const ids = `loan-${loan?.id ?? 'new'}`;
  const errs = (keys) => keys.map(shown).filter(Boolean);
  const footer = (keys, words) => (errs(keys).length ? <span className="text-spend">{errs(keys).join(' · ')}</span> : words);
  const text = (key, props = {}) => (
    <input id={`${ids}-${key}`} value={form[key]} onChange={setEv(key)} aria-invalid={Boolean(shown(key)) || undefined} autoComplete="off" {...props} className={`${FIELD} ${props.className ?? ''}`} />
  );
  // Amounts read as written ("18,400.00"); dollarsToCents takes a $ or commas typed in.
  const moneyField = (key, placeholder = '0.00') => text(key, { inputMode: 'decimal', placeholder, className: 'tnum' });
  // `edit` is a function: its field only exists while editing, when there's a form to read.
  const row = (key, label, read, edit, plain = false) => (
    <GroupRow label={label} as={editing && !plain ? 'label' : 'div'} htmlFor={editing && !plain ? `${ids}-${key}` : undefined} invalid={Boolean(shown(key))} className={editing && !plain ? FOCUS_ROW : ''}>
      {editing ? edit() : read}
    </GroupRow>
  );
  const pick = (key, label, read, picker) => (
    <GroupRow label={label} invalid={Boolean(shown(key))}>{editing ? picker() : read}</GroupRow>
  );

  // Reading view facts.
  const owedCents = loan ? Number(loan.bt?.balance_cents ?? loan.effective_balance_cents ?? 0) : null;
  const bt = !editing && loan?.bt;
  const c = loan && !editing ? countdownFor(loan, today) : null;
  const pace = bt ? paceOf(bt) : null;
  const gap = scheduleGap(editing ? form : loanForm(loan));
  // While editing, what's owed is a field only when nothing else knows it (owedIsKnown).
  const owedKnown = editing && owedIsKnown(form);
  const cards = accounts.filter((a) => a.account_type === 'CREDIT_CARD' && (a.is_active !== false || String(a.id) === linkedId));
  const title = editing ? form.name : loan.name;
  // Payments (D299): the paying account, its choices (grouped by whose it is), and the words under them.
  const pay = !editing || !adding ? loan?.payments ?? null : null;
  const payerId = editing ? form.payment_account_id : String(loan?.payment_account_id ?? '');
  const payer = accounts.find((a) => String(a.id) === payerId) ?? (loan?.payment_account_id && !editing
    ? { id: loan.payment_account_id, name: loan.payment_account_name, mask: loan.payment_account_mask } : null);
  const payerOptions = [{ value: '', label: 'None' }, ...accounts
    .filter((a) => a.is_active !== false || String(a.id) === payerId)
    .map((a) => ({ value: String(a.id), label: a.name, sub: a.mask ? `··${a.mask}` : undefined, group: maskName(a.person_name) }))];
  const payWords = !pay
    ? (payer ? null : 'Set the account it\'s paid from to spot a missed payment.')
    : pay.covered_through
      ? `Payments to ${loan.lender} found in your transactions. ${payer?.name ?? 'The paying account'}'s records reach ${longDate(pay.covered_through)}; a due date counts as missed only after they pass it.`
      : `Payments to ${loan.lender} found in your transactions. Set the account it's paid from to spot a missed payment.`;
  const lender = editing ? form.lender.trim() : loan.lender;

  return (
    <form onSubmit={submit} onKeyDown={(e) => editing && e.key === 'Escape' && onCancel()} noValidate>
      {/* Narrow screens put the actions in their own bar on top, as iOS's
          navigation bar does, so the title keeps the full width beneath. */}
      <header className="mb-7 flex flex-wrap items-center gap-x-5 gap-y-4">
        <div className="order-first flex w-full justify-end sm:order-2 sm:w-auto sm:self-start">
          <Actions editing={editing} adding={adding} saving={s.saving} canSave={!adding || Boolean(form.name.trim())} onEdit={onEdit} onCancel={() => onCancel()} still={still} />
        </div>
        {/* While editing, the card follows the type and lender as they're changed. */}
        <Mark loan={{ loan_type: type, lender: editing ? form.lender : loan.lender }} account={account} />
        <div className="min-w-0 flex-1">
          {/* The name and its field share one box, so Edit doesn't move it. */}
          {editing ? (
            <textarea
              id={`${ids}-name`}
              rows={1}
              value={form.name}
              // One line in the data, wrapped like the title it replaces: it grows to fit, and Enter saves.
              onChange={(e) => set('name')(e.target.value.replace(/\n/g, ' '))}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.form.requestSubmit(); } }}
              ref={(el) => { if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; } }}
              autoFocus
              placeholder={adding ? 'Name' : loan.name}
              aria-label="Name"
              aria-invalid={Boolean(shown('name')) || undefined}
              autoComplete="off"
              className="-mx-2 block w-[calc(100%+1rem)] resize-none overflow-hidden rounded-lg bg-band px-2 py-0.5 text-[22px] leading-tight font-semibold tracking-[-0.01em] break-words text-ink outline-none placeholder:text-faint"
            />
          ) : (
            <h3 className="-mx-2 line-clamp-2 rounded-lg px-2 py-0.5 text-[22px] leading-tight font-semibold tracking-[-0.01em] break-words text-ink" title={title}>{title}</h3>
          )}
          <p className="mt-1 truncate text-[13px] text-muted">{[LOAN_TYPE_LABEL[type], lender].filter(Boolean).join(' · ')}</p>
          {account && <p className="mt-0.5 truncate text-[13px] text-muted tnum">On {account.name}{account.mask ? ` ··${account.mask}` : ''}</p>}
        </div>
        {shown('name') && <p className="order-last w-full text-[13px] text-spend">{shown('name')}</p>}
        {loan && !loan.is_active && !editing && (
          <p className="order-last w-full rounded-lg bg-band px-3 py-2 text-[13px] text-muted">Closed. It stays in the history; reopen it to track it again.</p>
        )}
      </header>

      <div className="space-y-7">
        {/* What's owed: a field only when it's typed by hand. */}
        <GroupBlock
          header="Owed"
          footer={editing
            ? footer(['current_balance'], account
              ? 'A loan on a card reads what\'s owed off the card\'s statements.'
              : owedKnown ? 'Estimated from the payment, term and start below. Clear one of them to type it instead.' : null)
            : balanceSourceWords(loan)}
        >
          {editing && !owedKnown
            ? row('current_balance', 'Owed', null, () => moneyField('current_balance', '18,400.00'))
            : (
              <GroupRow label="Owed">
                {editing
                  ? <span className="text-muted">{account ? 'From statements' : 'Estimated from the schedule'}</span>
                  : <span className={`tnum ${loan.is_active ? 'text-ink' : 'text-muted'}`}>{formatMoney(owedCents)}</span>}
              </GroupRow>
            )}
          {!editing && loan.balance_source === 'manual' && loan.is_active && <UpdateOwed loan={loan} onSaved={onOwedSaved} />}
        </GroupBlock>

        {bt && bt.end_date && (
          <GroupBlock
            header={`${aprText(bt.promos?.[0]?.apr_bps ?? 0)} period`}
            footer={(
              <span className="block space-y-1.5">
                {warningSentences(bt).map((w) => <span key={w.kind} className={`block ${TONE[w.tone] ?? 'text-muted'}`}>{parts(w.parts)}</span>)}
                {bt.promos?.[0]?.label && <span className="block">From the card's statement: {bt.promos[0].label}{bt.promos[0].offer_id ? ` · ${bt.promos[0].offer_id}` : ''}.</span>}
                {bt.end_source === 'manual' && <span className="block">The end date was typed in; the statement didn't print one.</span>}
                {bt.plan?.phase === 'minimum' && <span className="block">Each month&apos;s minimum is the statement&apos;s. The bulk payments are estimated from today&apos;s balance; the last one must post before {longDate(bt.end_date)}.</span>}
              </span>
            )}
          >
            <GroupRow label="Ends">
              <span className={`tnum ${c?.urgent ? 'text-warn' : 'text-ink'}`}>{longDate(bt.end_date)}{bt.days_left != null && bt.days_left >= 0 ? ` · ${bt.days_left.toLocaleString()} days` : ''}</span>
            </GroupRow>
            {bt.promos?.[0]?.standard_apr_bps != null && <GroupRow label="Then"><span className="text-ink tnum">{aprText(bt.promos[0].standard_apr_bps)} APR</span></GroupRow>}
            {/* A two-phase plan (D309): the minimum for now, the rest in even payments at the end. */}
            {bt.plan && (
              <GroupRow label="Plan">
                <span className="text-ink">Minimum through {monthWords(bt.plan.minimum_until)}, then {bt.plan.bulk_months} {bt.plan.bulk_months === 1 ? 'payment' : 'payments'}</span>
              </GroupRow>
            )}
            {bt.plan?.phase === 'minimum' && bt.plan.bulk_monthly_cents != null && (
              <GroupRow label={`From ${monthWords(bt.plan.bulk_from)}`}>
                <span className="text-ink tnum">about {formatMoney(bt.plan.bulk_monthly_cents)} a month</span>
              </GroupRow>
            )}
            {pace && (
              <GroupRow label={bt.plan?.phase === 'minimum' ? 'This month (minimum)' : 'Needed each month'}>
                {bt.plan?.phase === 'minimum'
                  ? <span className="text-ink tnum">{formatMoney(pace.needed_cents)} · {bt.plan.minimum_months_left} more at the minimum</span>
                  : <span className="text-ink tnum">{formatMoney(pace.needed_cents)}{pace.months > 0 ? ` · ${pace.months} ${pace.months === 1 ? 'payment' : 'payments'}` : ''}</span>}
              </GroupRow>
            )}
            {pace?.pace && (
              <GroupRow label="Last statement">
                <span className={`tnum ${pace.pace === 'on_track' ? 'text-earn' : 'text-spend'}`}>{pace.pace === 'on_track' ? 'On track' : 'Behind'} · {formatMoney(pace.paid_cents)} paid</span>
              </GroupRow>
            )}
            {bt.transferred_cents > 0 && <GroupRow label="Transferred"><span className="text-ink tnum">{formatMoney(bt.transferred_cents)}{bt.since ? ` · ${longDate(bt.since)}` : ''}</span></GroupRow>}
            <GroupRow label="Transfer fee">
              {money(bt.fees_cents)}
              {/* What the issuer charged, as a share of what was moved (D308): BofA's was 3% or 4%. */}
              {bt.fees_cents > 0 && bt.transferred_cents > 0 && <span className="text-muted tnum"> · {Math.round((bt.fees_cents * 1000) / bt.transferred_cents) / 10}%</span>}
            </GroupRow>
            <GroupRow label="Paid on the card since">{money(bt.paid_cents)}</GroupRow>
          </GroupBlock>
        )}

        {!isBT && (
          <GroupBlock
            header="Schedule"
            footer={editing
              ? footer(['monthly_payment', 'term_months', 'start_date', 'deadline_date'], gap)
              : gap ?? (c?.kind === 'deadline' && !c.ended ? `About ${formatMoney(c.perMonthCents)} a month clears it by ${longDate(c.end)}.` : null)}
          >
            {row('monthly_payment', 'Monthly payment', money(loan?.monthly_payment_cents), () => moneyField('monthly_payment'))}
            {row('term_months', 'Term', loan?.term_months ? <span className="text-ink tnum">{loan.term_months} months</span> : notSet,
              () => <>{text('term_months', { inputMode: 'numeric', maxLength: 3, placeholder: 'Not set', className: 'w-16 flex-none tnum' })}<span className="text-muted">months</span></>)}
            {pick('start_date', 'Started', date(loan?.start_date),
              () => <DatePicker inRow value={form.start_date} onChange={set('start_date')} placeholder="Not set" aria-label="Started" />)}
            {pick('deadline_date', 'Pay off by', date(loan?.deadline_date),
              () => <DatePicker inRow value={form.deadline_date} onChange={set('deadline_date')} placeholder="Not set" aria-label="Pay off by" />)}
            {!editing && loan.months_remaining != null && (
              <GroupRow label="Payments left"><span className="text-ink tnum">{loan.months_remaining} of {loan.term_months}</span></GroupRow>
            )}
          </GroupBlock>
        )}

        {/* Payments (D299): counted from what's found for the lender, read against the paying account's records. */}
        {!isBT && !account && (editing || loan.payments || loan.payment_account_id) && (
          <GroupBlock
            header="Payments"
            footer={editing
              ? footer(['payment_account_id'], 'Where the payments come from. They\'re found by lender on any account, so changing this keeps the old ones.')
              : payWords}
          >
            {pick('payment_account_id', 'Paid from',
              payer ? (
                <Link to={`/settings?tab=accounts&account=${payer.id}`} className="-mr-1 flex min-w-0 items-center gap-1 rounded-md px-1 text-ink hover:bg-band">
                  <span className="truncate">{payer.name}</span>{payer.mask && <span className="shrink-0 text-faint tnum">··{payer.mask}</span>}<RowChevron />
                </Link>
              ) : notSet,
              () => <Dropdown inRow value={form.payment_account_id} onChange={set('payment_account_id')} aria-label="Paid from" options={payerOptions} />)}
            {pay && (
              <>
                <GroupRow label="Due"><span className="text-ink">{dayWords(pay.due_day)} of each month</span></GroupRow>
                <GroupRow label="Made"><span className="text-ink tnum">{pay.made} of {loan.term_months}</span></GroupRow>
                {pay.missed > 0 && (
                  <GroupRow label="Missed" invalid>
                    <span className="text-spend tnum">{pay.missed}{pay.behind_since ? ` · behind since ${longDate(pay.behind_since)}` : ''}</span>
                  </GroupRow>
                )}
                {pay.last_payment && (
                  <GroupRow label="Last payment"><span className="text-ink tnum">{longDate(pay.last_payment.posted_date)} · {formatMoney(pay.last_payment.cents)}</span></GroupRow>
                )}
                {pay.next && (
                  <GroupRow label="Next">
                    <span className="tnum"><span className="text-ink">{longDate(pay.next.date)}</span>{pay.next.status === 'not_on_file' && <span className="text-muted"> · not on file yet</span>}</span>
                  </GroupRow>
                )}
              </>
            )}
          </GroupBlock>
        )}

        <GroupBlock
          header="Details"
          footer={editing ? footer(['linked_account_id', 'lender', 'loan_type'],
            isBT ? 'The 0% end date is read off the card\'s statements; a date here is used only when they don\'t print one.' : null) : null}
        >
          {pick('loan_type', 'Type', <span className="text-ink">{LOAN_TYPE_LABEL[type]}</span>,
            () => <Dropdown inRow value={form.loan_type} onChange={set('loan_type')} options={TYPE_OPTIONS} aria-label="Type" />)}
          {row('lender', 'Lender', lender ? <span className="truncate text-ink">{lender}</span> : notSet,
            () => <SuggestField id={`${ids}-lender`} value={form.lender} onChange={set('lender')} choices={lenderChoices(loans, accounts)} label="Lenders on file" placeholder="Not set" className={FIELD} />)}
          {pick('linked_account_id', 'On card',
            account
              ? <Link to={`/settings?tab=accounts&account=${account.id}`} className="-mr-1 flex items-center gap-1 rounded-md px-1 text-ink hover:bg-band">{account.name}<span className="text-faint tnum">··{account.mask}</span><RowChevron /></Link>
              : <span className="text-faint">None</span>,
            () => <Dropdown inRow value={form.linked_account_id} onChange={set('linked_account_id')} aria-label="On card"
              options={[{ value: '', label: 'None' }, ...cards.map((a) => ({ value: String(a.id), label: `${a.name}${a.mask ? ` ··${a.mask}` : ''}` }))]} />)}
          {isBT && editing && pick('deadline_date', '0% ends', null,
            () => <DatePicker inRow value={form.deadline_date} onChange={set('deadline_date')} placeholder="From statements" aria-label="0% ends" />)}
          {isBT && editing && (loan?.bt?.end_date || form.deadline_date) && pick('minimum_until', 'Minimum until', null,
            () => <Dropdown inRow value={form.minimum_until} onChange={set('minimum_until')} aria-label="Minimum until"
              options={[{ value: '', label: 'No plan: even payments' }, ...planMonths(today, loan?.bt?.end_date ?? form.deadline_date)]} />)}
        </GroupBlock>

        {s.serverError && !s.serverError.field && <p role="alert" className="px-4 text-[13px] text-spend">{s.serverError.message}</p>}
        {adding && <p className="px-4 text-[13px] text-muted">A loan on a card takes what's owed from the card's statements. Anything else: what's owed today, or a payment, term and start to estimate it.</p>}

        <ReadOnly show={!editing && Boolean(loan)} still={still}>
          {loan && (
            <GroupBlock header="History">
              <button type="button" onClick={() => onHistory(loan)} className="block w-full text-left transition-colors hover:bg-band active:bg-band">
                <GroupRow label="Month by month"><span>Paid and owed</span><RowChevron /></GroupRow>
              </button>
            </GroupBlock>
          )}
          {loan && (
            <GroupBlock footer={loan.is_active
              ? 'Closing takes it out of what\'s owed. Its history stays, and you can reopen it.'
              : 'Reopening counts it in what\'s owed again.'}
            >
              {loan.is_active
                ? <GroupButton tone="spend" onClick={() => onSetOpen(loan, false)}>Close Loan</GroupButton>
                : <GroupButton onClick={() => onSetOpen(loan, true)}>Reopen Loan</GroupButton>}
            </GroupBlock>
          )}
        </ReadOnly>
      </div>
    </form>
  );
}
