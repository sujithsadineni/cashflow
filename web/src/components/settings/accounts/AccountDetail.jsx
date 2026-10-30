import { cardProductFor } from '../../../lib/cards/card-products';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { api, formatMoney, formatShortDate, typeLabel, maskName, dollarsToCents, ACCOUNT_TYPES } from '../../../api';
import { accountArt } from '../../../lib/cards/account-art';
import { dayWords, dueLine, suggestionWords } from '../../../lib/cards/card-days';
import { earlierCards, earlierProducts } from '../../../lib/cards/card-history';
import { lookAlikes, formOf, problemsOf, changesOf, issuerChoices } from '../../../lib/accounts/accounts';
import { PersonAvatar } from '../../ui/PersonAvatar';
import { Dropdown } from '../../ui/Dropdown';
import { GroupBlock, GroupRow, GroupButton, RowChevron, CardArt } from '../apple/grouped';
import { SuggestField } from '../apple/SuggestField';
import { MembersGroup } from './MembersGroup';
import { StatementFactsGroup } from './StatementFactsGroup';

/**
 * One account (D297), read and edited in the same place, as Contacts does:
 * Edit turns each value into its field where it already sits (the name into
 * a field in the title), so nothing on screen jumps; the groups that can't
 * be edited fade away below. Cancel and Done replace Edit (sheets.md: "If you
 * provide a Done button, always pair it with a Cancel button"). Add is the
 * same screen, empty.
 *
 * Choices are the app's own Dropdown in its row style and the issuer
 * suggests banks on file: no browser <select> or <datalist>. Problems show
 * as they're typed, once a field is touched (entering-data.md: "Dynamically
 * validate field values"); Done waits until there are none, and sends only
 * what changed, so the audit log records just those fields. Escape cancels.
 * Focus is the pane's own (index.css, .apple-pane): a row tints, nothing
 * rings it in green.
 */

const TONE = { spend: 'text-spend', warn: 'text-warn', earn: 'text-earn', muted: 'text-muted' };
// The local date, not UTC's: in the evening UTC is already tomorrow.
const today = () => new Date().toLocaleDateString('en-CA');
const NETWORKS = { VISA: 'Visa', MASTERCARD: 'Mastercard', AMEX: 'American Express', DISCOVER: 'Discover' };
const NETWORK_CHOICES = [{ value: '', label: 'Automatic' }, ...Object.entries(NETWORKS).map(([value, label]) => ({ value, label }))];
/** "Mastercard", or "Automatic · Mastercard" from its product, or "Automatic". */
function networkLabel(account) {
  if (account.network) return NETWORKS[account.network];
  const auto = cardProductFor(account)?.network?.toUpperCase();
  return NETWORKS[auto] ? `Automatic · ${NETWORKS[auto]}` : 'Automatic';
}
const holdsBalance = (a) => a.account_type === 'SAVINGS' || a.account_type === 'INVESTMENT';
// A new account starts as the list's filters describe it: their person and type, if chosen.
const blank = (people, start = {}) => ({
  person_id: String(start.person_id ?? people[0]?.id ?? ''), name: '', issuer: '', account_type: start.account_type ?? 'CREDIT_CARD', mask: '',
  holder_name: '', nickname: '', closing_day: '', due_day: '', credit_limit_manual: '', status: 'active',
});
// A field reads as the value it replaces: same size, same colour, same edge.
const FIELD = 'w-full min-w-0 bg-transparent text-right text-ink outline-none placeholder:text-faint';
const FOCUS_ROW = 'focus-within:bg-band';
const fade = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.16 } };

/** "17th of the month"; if not set, what the statements suggest. */
function dayValue(day, suggestion) {
  if (day != null) return Number(day) === 31 ? 'Last day of the month' : `${dayWords(day)} of the month`;
  if (suggestion) return <span className="text-faint">Not set · statements say the {dayWords(suggestion.day)}</span>;
  return <span className="text-faint">Not set</span>;
}
const notSet = (v, cls = '') => (v ? <span className={`truncate text-ink ${cls}`}>{v}</span> : <span className="text-faint">Not set</span>);

function BalanceGroup({ account, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const has = account.balance_cents != null;
  const fromStatement = has && account.balance_as_of !== account.manual_balance_as_of;

  const save = async () => {
    const cents = dollarsToCents(amount);
    if (Number.isNaN(cents)) return setError('Enter the balance, like 21,340.50');
    setBusy(true);
    try {
      await api.recordBalance(account.id, { as_of: today(), balance_cents: cents });
      setEditing(false);
      setAmount('');
      setError(null);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const footer = error
    ? <span className="text-spend">{error}</span>
    : has ? (fromStatement ? `From the statement ending ${formatShortDate(account.balance_as_of)}.` : `Entered by hand on ${formatShortDate(account.balance_as_of)}.`)
      : 'No statement or hand-entered balance yet.';

  return (
    <GroupBlock header="Balance" footer={footer}>
      <GroupRow label="Balance">
        <span className={`tnum ${has ? 'text-ink' : 'text-faint'}`}>{has ? formatMoney(Number(account.balance_cents)) : 'Not recorded'}</span>
      </GroupRow>
      {holdsBalance(account) && (editing ? (
        <GroupRow label="Today" as="label" htmlFor="balance-today" className={FOCUS_ROW}>
          <input
            id="balance-today"
            autoFocus
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); save(); }
              if (e.key === 'Escape') { e.stopPropagation(); setEditing(false); }
            }}
            inputMode="decimal"
            placeholder="0.00"
            className={`${FIELD} tnum`}
          />
          <button type="button" onClick={() => setEditing(false)} className="rounded-md px-1 text-[15px] text-muted hover:text-ink">Cancel</button>
          <button type="button" onClick={save} disabled={busy || !amount.trim()} className="rounded-md px-1 text-[15px] font-semibold text-info disabled:opacity-40">Save</button>
        </GroupRow>
      ) : (
        <GroupButton onClick={() => setEditing(true)}>{has ? 'Update Balance' : 'Add Balance'}</GroupButton>
      ))}
    </GroupBlock>
  );
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
  if (still) return show ? children : null;
  return <AnimatePresence initial={false}>{show && <motion.div key="read" className="space-y-7" {...fade}>{children}</motion.div>}</AnimatePresence>;
}

export function AccountDetail({ account = null, mode, people, all, start, still, onEdit, onCancel, onSaved, onDirty, onSelect, onSetOpen, onBalanceSaved, onMembersChanged }) {
  const adding = mode === 'add';
  const editing = mode !== 'view';

  // A fresh form each time an edit (or an add) begins: set during render, so
  // the first edit frame already holds the account's values.
  const sessionKey = editing ? `${mode}:${account?.id ?? 'new'}` : null;
  const [s, setS] = useState({ key: null, form: null, before: null, touched: {}, serverError: null, saving: false });
  if (s.key !== sessionKey) {
    const base = !editing ? null : adding ? blank(people, start) : formOf(account);
    setS({ key: sessionKey, before: base, form: base, touched: {}, serverError: null, saving: false });
  }
  const form = s.form;
  const ready = !editing || Boolean(form);
  const dirty = editing && ready && JSON.stringify(form) !== JSON.stringify(s.before);
  // Tells the pane whether leaving would lose something.
  useEffect(() => { onDirty?.(dirty); }, [dirty, onDirty]);
  // The pass that starts an edit has no form yet; the next one does.
  if (!ready) return null;

  const owner = people.find((p) => p.id === Number(editing && form ? form.person_id : account?.person_id)) ?? { name: account?.person_name };
  const type = editing && form ? form.account_type : account.account_type;
  const card = type === 'CREDIT_CARD';
  const problems = editing && form ? problemsOf(adding ? { ...form, closing_day: null, due_day: null } : form) : {};
  if (s.serverError?.field) problems[s.serverError.field] = s.serverError.message;
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
      if (adding) {
        const { person_id, name, issuer, account_type, mask } = form;
        onSaved(await api.accounts.create({ person_id: Number(person_id), name: name.trim(), issuer: issuer.trim(), account_type, mask: mask.trim() }), null);
      } else {
        const changes = changesOf(s.before, form);
        onSaved(await api.accounts.update(account.id, changes), changes);
      }
    } catch (err) {
      // The backend names the field it rejected, so the row can say it.
      setS((x) => ({ ...x, saving: false, serverError: { message: err.message, field: err.field } }));
    }
  }

  const live = editing && form ? { ...account, name: form.name, issuer: form.issuer, account_type: form.account_type, mask: form.mask } : account;
  const title = editing && form ? form.name : account.name;
  const errs = (keys) => keys.map(shown).filter(Boolean);
  const footer = (keys, words) => (errs(keys).length ? <span className="text-spend">{errs(keys).join(' · ')}</span> : words);
  const ids = `acct-${account?.id ?? 'new'}`;
  const field = (key, props = {}) => (
    <input id={`${ids}-${key}`} value={form[key]} onChange={setEv(key)} aria-invalid={Boolean(shown(key)) || undefined} autoComplete="off" {...props} className={`${FIELD} ${props.className ?? ''}`} />
  );
  // `edit` is a function: its field only exists while editing, when there's a form to read.
  const row = (key, label, read, edit) => (
    <GroupRow label={label} as={editing ? 'label' : 'div'} htmlFor={editing ? `${ids}-${key}` : undefined} invalid={Boolean(shown(key))} className={editing ? FOCUS_ROW : ''}>
      {editing ? edit() : read}
    </GroupRow>
  );
  const dayField = (key, hint) => (
    <>
      {hint && String(hint.day) !== form[key].trim() && (
        <button type="button" onClick={() => set(key)(String(hint.day))} title={suggestionWords(hint)}
          className="shrink-0 rounded-full bg-info/10 px-2 py-0.5 text-[13px] text-info transition-colors hover:bg-info/15">
          Use {dayWords(hint.day)}
        </button>
      )}
      {field(key, { inputMode: 'numeric', maxLength: 2, placeholder: 'Not set', className: 'w-16 flex-none tnum' })}
    </>
  );

  const due = !editing && card && account.is_active ? dueLine(account.payment_due) : null;
  const suggestion = account?.date_suggestion ?? {};
  const earlier = account && earlierCards(account)?.replace(/^Earlier cards\s*/, '');
  const product = account && earlierProducts(account);
  const alikes = account ? lookAlikes(account, all) : [];
  const typeChanged = editing && !adding && form.account_type !== s.before.account_type;

  return (
    <form onSubmit={submit} onKeyDown={(e) => editing && e.key === 'Escape' && onCancel()} noValidate>
      {/* Narrow screens put the actions in their own bar on top, as iOS's
          navigation bar does, so the title keeps the full width beneath. */}
      <header className="mb-7 flex flex-wrap items-center gap-x-5 gap-y-4">
        <div className="order-first flex w-full justify-end sm:order-2 sm:w-auto sm:self-start">
          <Actions editing={editing} adding={adding} saving={s.saving} canSave={!adding || Boolean(form.name.trim())}
            onEdit={onEdit} onCancel={() => onCancel()} still={still} />
        </div>
        <CardArt art={accountArt(live ?? {})} className="w-28 sm:w-36" />
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
              placeholder={adding ? 'Name' : account.name}
              aria-label="Name"
              aria-invalid={Boolean(shown('name')) || undefined}
              autoComplete="off"
              className="-mx-2 block w-[calc(100%+1rem)] resize-none overflow-hidden rounded-lg bg-band px-2 py-0.5 text-[22px] leading-tight font-semibold tracking-[-0.01em] break-words text-ink outline-none placeholder:text-faint"
            />
          ) : (
            <h3 className="-mx-2 line-clamp-2 rounded-lg px-2 py-0.5 text-[22px] leading-tight font-semibold tracking-[-0.01em] break-words text-ink" title={title}>{title}</h3>
          )}
          <p className="mt-1 truncate text-[13px] text-muted tnum">
            {[typeLabel(type), (editing ? form.mask : account.mask)?.trim() && `··${(editing ? form.mask : account.mask).trim()}`, (editing ? form.issuer : account.issuer)?.trim()].filter(Boolean).join(' · ')}
          </p>
          <p className="mt-2 flex items-center gap-1.5 text-[13px] text-muted">
            <PersonAvatar person={owner} size={18} />
            {maskName(owner.name)}
          </p>
        </div>
        {shown('name') && <p className="order-last w-full text-[13px] text-spend">{shown('name')}</p>}
        {account && !account.is_active && !editing && (
          <p className="order-last w-full rounded-lg bg-band px-3 py-2 text-[13px] text-muted">Closed. Its history stays in the ledger; reopen it to use it again.</p>
        )}
      </header>

      <div className="space-y-7">
        <GroupBlock
          header="Account"
          footer={editing ? footer(['nickname', 'mask', 'issuer', 'holder_name', 'person_id'],
            typeChanged ? 'Changing the type changes how its rows are read and matched: a card\'s payments, a bank\'s transfers.' : null) : null}
        >
          <GroupRow label="Owner">
            {editing
              ? <Dropdown inRow value={form.person_id} onChange={set('person_id')} aria-label="Owner"
                  options={people.map((p) => ({ value: String(p.id), label: maskName(p.name) }))} />
              : <span className="truncate text-ink">{maskName(owner.name)}</span>}
          </GroupRow>
          <GroupRow label="Type">
            {editing
              ? <Dropdown inRow value={form.account_type} onChange={set('account_type')} aria-label="Type" options={ACCOUNT_TYPES} />
              : <span className="text-ink">{typeLabel(account.account_type)}</span>}
          </GroupRow>
          {/* A short name for tight places, like the Transactions table (D353). */}
          {!adding && row('nickname', 'Nickname', notSet(account?.nickname),
            () => field('nickname', { placeholder: 'Not set', maxLength: 24 }))}
          {row('issuer', 'Issuer', notSet(account?.issuer),
            () => <SuggestField id={`${ids}-issuer`} value={form.issuer} onChange={set('issuer')} choices={issuerChoices(all)} label="Banks on file" placeholder="Bank" invalid={Boolean(shown('issuer'))} className={FIELD} />)}
          {/* The card's network (D416): automatic is its product's, else picked here. */}
          {!adding && card && (
            <GroupRow label="Network">
              {editing
                ? <Dropdown inRow value={form.network} onChange={set('network')} aria-label="Network" options={NETWORK_CHOICES} />
                : <span className="text-ink">{networkLabel(account)}</span>}
            </GroupRow>
          )}
          {row('mask', 'Last 4 digits', notSet(account?.mask, 'tnum'), () => field('mask', { inputMode: 'numeric', maxLength: 4, placeholder: 'Not set', className: 'tnum' }))}
          {!adding && row('holder_name', card ? 'Name on card' : 'Name on statements', notSet(account.holder_name), () => field('holder_name', { placeholder: 'Not set' }))}
        </GroupBlock>

        {!adding && card && (
          <GroupBlock
            header="Billing"
            footer={editing
              ? footer(['closing_day', 'due_day', 'credit_limit_manual'], 'A day from 1 to 31; 31 means the month\'s last day. Leave one empty and the next statement sets it. Your limit is used only where its statements print none.')
              : due ? <span className={TONE[due.tone] ?? 'text-muted'}>{due.text}</span> : 'No bill read from a statement yet.'}
          >
            {row('closing_day', 'Statement closes', dayValue(account.closing_day, suggestion.closing), () => dayField('closing_day', suggestion.closing))}
            {row('due_day', 'Payment due', dayValue(account.due_day, suggestion.due), () => dayField('due_day', suggestion.due))}
            {/* A limit set by hand (D354), used only where its statements print none. */}
            {row('credit_limit_manual', 'Your limit',
              account.credit_limit_manual_cents != null
                ? <span className="text-ink tnum">{formatMoney(Number(account.credit_limit_manual_cents))}</span>
                // None typed: the limit its statements print, said so, rather than "Not set" beside a known limit (D416).
                : account.credit_line?.credit_limit_cents != null
                  ? <span className="truncate tnum"><span className="text-ink">{formatMoney(Number(account.credit_line.credit_limit_cents))}</span> <span className="text-faint">· from its statements</span></span>
                  : <span className="text-faint">Not set</span>,
              () => field('credit_limit_manual', { inputMode: 'decimal', placeholder: 'Not set', className: 'tnum' }))}
          </GroupBlock>
        )}

        {s.serverError && !s.serverError.field && <p role="alert" className="px-4 text-[13px] text-spend">{s.serverError.message}</p>}
        {adding && <p className="px-4 text-[13px] text-muted">After adding it, upload a statement to fill it with history. Billing days and the name on the card come from its statements.</p>}

        <ReadOnly show={!editing && Boolean(account)} still={still}>
          {account && !card && <BalanceGroup account={account} onSaved={onBalanceSaved} />}
          {/* Every account (D393): a bank's statements print its Member since; the group hides when nothing is printed. */}
          {account && <StatementFactsGroup account={account} />}
          {account && card && account.is_active && <MembersGroup account={account} people={people} onChanged={onMembersChanged} />}
          {account && (
            <GroupBlock header="Activity" footer={product ? `${product}.` : null}>
              <Link to={`/transactions?account=${account.id}`} className="block transition-colors hover:bg-band active:bg-band">
                <GroupRow label="Transactions"><span className="text-ink tnum">{Number(account.transaction_count ?? 0).toLocaleString()}</span><RowChevron /></GroupRow>
              </Link>
              <GroupRow label="Last activity">
                {account.last_posted ? <span className="text-ink tnum">{formatShortDate(account.last_posted)}</span> : <span className="text-faint">None yet</span>}
              </GroupRow>
              {earlier && <GroupRow label="Earlier cards"><span className="truncate text-ink tnum">{earlier}</span></GroupRow>}
              <Link to="/cards" className="block transition-colors hover:bg-band active:bg-band">
                <GroupRow label="Card art"><span>Change on Cards</span><RowChevron /></GroupRow>
              </Link>
            </GroupBlock>
          )}
          {alikes.length > 0 && (
            <GroupBlock header="Looks like" footer="Same last four and the same name or bank. If it's one card that was reopened, keep one account and close the other.">
              {alikes.map((b) => (
                <button key={b.id} type="button" onClick={() => onSelect(b.id)} className="block w-full text-left transition-colors hover:bg-band active:bg-band">
                  <GroupRow label={<>{b.name} <span className="text-[13px] text-faint tnum">··{b.mask}</span></>}>
                    <span className={b.is_active ? 'text-muted' : 'text-faint'}>{b.is_active ? maskName(b.person_name) : 'Closed'}</span>
                    <RowChevron />
                  </GroupRow>
                </button>
              ))}
            </GroupBlock>
          )}
          {account && (
            <GroupBlock footer={account.is_active
              ? 'Closing takes it out of every list and total. Its history stays, and you can reopen it.'
              : 'Reopening puts it back in every list and total.'}
            >
              {account.is_active
                ? <GroupButton tone="spend" onClick={() => onSetOpen(account, false)}>Close Account</GroupButton>
                : <GroupButton onClick={() => onSetOpen(account, true)}>Reopen Account</GroupButton>}
            </GroupBlock>
          )}
        </ReadOnly>
      </div>
    </form>
  );
}
