import { useMemo, useState } from 'react';
import { txnName } from '../../lib/transactions/txn-name';
import { Link, useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { api, dollarsToCents, formatMoney, formatShortDate, maskName, TXN_TYPE_LABELS } from '../../api';
import { Button, Select, Field, TextInput, EditableText, Segmented } from '../ui/Form';
import { MerchantAvatar } from '../ui/MerchantAvatar';
import { lookupMerchantDomain } from '../../lib/transactions/merchant-logos';
import { useNotify } from '../../hooks/use-notify';
import { useConfirm } from '../../hooks/use-confirm';
import { approvalToasts } from '../../lib/app/toast-words';
import { invalidate, useApi } from '../../hooks/use-api';
import { ACCOUNT_TYPE_CHOICES, TXN_TYPE_CHOICES, accountChoices, blankChoice, categoryChoices, personChoices } from '../../lib/categories/dropdown-choices';
import { Dropdown } from '../ui/Dropdown';
import { LineButton, LineReview } from './LineReview';
import { StatementReveal, SectionLine } from './StatementReveal';
import { StatementNotes, NOTES_BOX } from './StatementNotes';
import { statementNotes } from '../../lib/imports/statement-notes';
import { holderName, personForHolder } from '../../lib/imports/holder-name';
import { namesOnStatement, startingRole, ROLE_CHOICES } from '../../lib/imports/statement-names';
import { aprText } from '../../lib/cards/utilisation';
import { useHeight } from '../../hooks/use-height';
import { printedOrder, printedSections, sectionFigures } from '../../lib/imports/printed-order';
import { useReadingStyle } from '../../hooks/use-reading-style';
import { useColumns } from '../../hooks/use-columns';
import { foldsAway, statementFigures, statementCreditLine } from '../../lib/imports/statement-view';
import { cardUtilisation } from '../../lib/cards/utilisation';
import { UtilisationBar } from '../ui/UtilisationBar';
import { FLAG_WORDS, flaggedPending, lineFlags, readsCleanly } from '../../lib/review/line-review';
import { TxnName } from '../transactions/TxnName';

/**
 * After an approval (D201): what the upload changed, then the day's alerts
 * again, so anything it newly raised (or cleared) shows now, not on the
 * next page load.
 */
function announceApproval(notify, result) {
  // The save, then what was found in it (D317): bills charged, new bills, payments matched…
  approvalToasts(result).forEach(({ message, options }, i) => setTimeout(() => notify(message, options), i * 350));
  // Every open view of transactions, loans and statements reloads (D211).
  invalidate('transactions', 'loans', 'imports');
}

const NEW_PERSON = 'new';
// An inline text action, as Import's own links are drawn: ink, a rule-coloured underline that darkens on hover.
const LINK = 'text-ink underline decoration-rule-str underline-offset-2 hover:decoration-ink';
const TYPE_WORD = { CHECKING: 'Checking', SAVINGS: 'Savings', CREDIT_CARD: 'Card', INVESTMENT: 'Investment' };

/**
 * The account confirmation card — step one of review. The parser
 * read the account identity off the statement; a human says yes,
 * picks a different one, or creates the account it found. Nothing
 * can be approved until this is settled: a statement attached to the
 * wrong account is the worst failure an importer can have.
 */
function AccountCard({ batch, rows = [], accounts, people, onConfirmed, pickOther = false }) {
  const suggested = accounts.find((a) => a.id === batch.suggested_account_id) ?? null;
  const detectedLabel = [
    batch.detected_account_name,
    batch.detected_mask ? `···${batch.detected_mask}` : null,
  ].filter(Boolean).join(' ');

  // Turned down in Import's Find the card popup (D325): straight to picking, no second "Yes, that's it".
  const [mode, setMode] = useState(suggested && !pickOther ? 'suggested' : 'resolve');
  // Nothing pre-picked: an unrelated account one click from "Use this account" is how a bank
  // statement landed on a credit card.
  const [pickedId, setPickedId] = useState('');
  const [mismatch, setMismatch] = useState(null); // the API's "doesn't look like this account"
  // The statement's printed holder picks the owner up front, at first render rather than
  // corrected by an effect after (D211), however the bank prints them (personForHolder).
  const holderMatch = personForHolder(batch.detected_holder, people);
  // Nobody in People yet (a new install), or a holder nobody matches: the owner
  // can be added right here, named as the statement prints them.
  const [form, setForm] = useState({
    // A holder it can't place is someone new, never quietly the first person in People.
    person_id: String(holderMatch?.id ?? (batch.detected_holder ? NEW_PERSON : people[0]?.id ?? NEW_PERSON)),
    new_person: holderName(batch.detected_holder),
    // A bank statement often prints no product name: the bank and the kind of account will do.
    name: batch.detected_account_name ?? ([batch.detected_issuer, TYPE_WORD[batch.detected_account_type]].filter(Boolean).join(' ') || ''),
    issuer: batch.detected_issuer ?? '',
    // A CSV says nothing about what it came from: the person picks, rather than a
    // silent "Credit card" that reads a bank file's money the wrong way round.
    account_type: batch.detected_account_type ?? (batch.file_type === 'CSV' ? '' : 'CREDIT_CARD'),
    mask: batch.detected_mask ?? '',
  });
  const addingPerson = form.person_id === NEW_PERSON;

  // Several people's sections on one statement (D400): ask whether it's shared before
  // anything is created, then who each name is and their part in it.
  const names = useMemo(() => namesOnStatement(batch, rows), [batch, rows]);
  const [shared, setShared] = useState(names.length > 1 ? null : false);
  const [members, setMembers] = useState(() => names.map((n, i) => {
    const known = personForHolder(n.printed, people);
    return { ...n, role: startingRole(n, i), person: String(known?.id ?? NEW_PERSON), new_person: holderName(n.printed) };
  }));
  const setMember = (i, key) => (e) => setMembers((ms) => ms.map((m, j) => {
    if (j !== i) return key === 'role' && e.target.value === 'owner' && m.role === 'owner' ? { ...m, role: 'co_owner' } : m;
    return { ...m, [key]: e.target.value };
  }));
  const picked = members.map((m) => m.person).filter((p) => p !== NEW_PERSON);
  const membersReady = members.filter((m) => m.role === 'owner').length === 1
    && members.every((m) => m.person !== NEW_PERSON || m.new_person.trim())
    && new Set(picked).size === picked.length;

  // A card whose statement prints no limit: asked once, here, or skipped for Settings later.
  const needsLimit = form.account_type === 'CREDIT_CARD' && batch.detected_summary?.credit_limit_cents == null;
  const [limit, setLimit] = useState({ text: '', skipped: false });
  const limitCents = needsLimit && !limit.skipped ? dollarsToCents(limit.text) : NaN;
  const limitReady = !needsLimit || limit.skipped || limitCents > 0;
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const navigate = useNavigate();
  const confirm = async (body) => {
    setBusy(true);
    setError(null);
    setMismatch(null);
    try {
      const res = await api.imports.confirmAccount(batch.id, body);
      onConfirmed(accounts.find((a) => a.id === body.account_id)?.name ?? body.create?.name ?? null);
      return res ?? {};
    } catch (err) {
      if (err.field === 'account_mismatch') setMismatch({ message: err.message, body });
      else setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  // Why Create & attach can't go yet, said beside it rather than a button that just won't press.
  const createBlocked = shared === null ? 'Say whether it\'s shared first'
    : shared && !membersReady ? 'One primary, and a different person for each name'
    : !shared && addingPerson && !form.new_person.trim() ? 'Give the new person a name'
    : !form.account_type ? 'Pick its type'
    : !form.name.trim() ? 'Give the account a name'
    : !limitReady ? 'Enter the limit, or skip it'
    : null;

  const create = async () => {
    const { new_person, ...fields } = form;
    const credit_limit_cents = limitCents > 0 ? limitCents : undefined;
    if (shared) {
      const res = await confirm({ create: { ...fields, person_id: undefined, credit_limit_cents, members: members.map((m) => ({
        printed_name: m.printed, role: m.role, card_ending: m.card_ending,
        ...(m.person === NEW_PERSON ? { new_person: m.new_person.trim().replace(/\s+/g, ' ') } : { person_id: Number(m.person) }),
      })) } });
      if (res?.new_people?.length) {
        invalidate('reference');
        checkInPeople(res.new_people[0]);
      }
      return;
    }
    let personId = Number(form.person_id);
    if (addingPerson) {
      setBusy(true);
      setError(null);
      try {
        personId = (await api.personCreate(new_person.trim().replace(/\s+/g, ' '))).id;
        invalidate('reference');
      } catch (err) {
        setBusy(false);
        return setError(err.message);
      }
    }
    // Someone new came off this statement: check them in People first (D399), then back here for the rows.
    if ((await confirm({ create: { ...fields, person_id: personId, credit_limit_cents } })) && addingPerson) checkInPeople(personId);
  };
  const checkInPeople = (personId) =>
    navigate(`/settings?${new URLSearchParams({ tab: 'people', person: String(personId), check: '1', back: `/import?open=${batch.id}` })}`);

  return (
    <div className="mt-4 rounded-lg border border-warn/40 bg-raised p-5">
      {mode === 'suggested' && suggested && (
        <>
          <p className="text-ink">
            This looks like <span className="font-medium">{suggested.name}</span>
            {suggested.mask && <span className="font-mono text-sm tnum"> ···{suggested.mask}</span>}
            {' '}({maskName(suggested.person_name)}) — right?
          </p>
          {batch.detected_holder && (
            <p className="mt-1 text-sm text-muted">
              Statement holder: {maskName(batch.detected_holder)}
            </p>
          )}
          <div className="mt-4 flex items-center gap-2">
            <Button onClick={() => confirm({ account_id: suggested.id })} disabled={busy}>
              {busy ? 'Attaching…' : "Yes, that's it"}
            </Button>
            <Button variant="quiet" onClick={() => setMode('resolve')} disabled={busy}>
              No, something else
            </Button>
          </div>
        </>
      )}

      {mode === 'resolve' && (
        <>
          <p className="text-ink">
            {batch.detected_account_name
              ? <>Found a new account on this statement: <span className="font-medium">{detectedLabel}</span>{batch.detected_issuer ? ` (${batch.detected_issuer})` : ''}</>
              : 'Which account does this statement belong to?'}
          </p>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            {accounts.length > 0 && (
              <>
                <div className="w-64">
                  <Field label="An existing account">
                    <Select
                      value={pickedId}
                      onChange={(e) => setPickedId(e.target.value)}
                      options={[blankChoice('Pick one…'), ...accountChoices(accounts)]}
                    />
                  </Field>
                </div>
                <div className="pb-0.5">
                  <Button variant="quiet" onClick={() => confirm({ account_id: Number(pickedId) })} disabled={busy || !pickedId}>
                    Use this account
                  </Button>
                </div>
                <span className="pb-2.5 text-sm text-faint">or create it —</span>
              </>
            )}
            <div className="pb-0.5">
              <Button onClick={() => setMode('create')} disabled={busy}>
                {batch.detected_account_name ? `Create “${batch.detected_account_name}”` : 'Create a new account'}
              </Button>
            </div>
          </div>
        </>
      )}

      {mode === 'create' && (
        <>
          <p className="mb-4 text-ink">New account — everything is editable before it's created.</p>
          {shared === null && (
            <div className="mb-4 rounded-lg border border-rule bg-paper p-4">
              <p className="text-ink">
                I found {names.length} names on this statement: {names.map((n) => maskName(n.printed)).join(', ')}. Is it shared?
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button onClick={() => setShared(true)}>Yes, it&apos;s shared</Button>
                <Button variant="quiet" onClick={() => setShared(false)}>No, one owner</Button>
              </div>
            </div>
          )}
          {shared && (
            <div className="mb-4">
              <p className="mb-3 text-sm text-muted">Who each name is, and their part. The primary owns it; payments stay with them.</p>
              <div className="space-y-3">
                {members.map((m, i) => (
                  <div key={m.printed} className="rounded-lg border border-rule p-3">
                    <p className="mb-2 flex flex-wrap items-baseline gap-x-2 px-1 text-sm">
                      <span className="font-medium text-ink">{maskName(m.printed)}</span>
                      {m.card_ending && <span className="tnum text-muted">··{m.card_ending}</span>}
                      <span className="text-faint">as the statement prints them</span>
                    </p>
                    <div className="grid items-start gap-3 sm:grid-cols-2">
                      <Field label="Who is this?">
                        <Select
                          value={m.person}
                          onChange={setMember(i, 'person')}
                          options={[...personChoices(people), { ...blankChoice('Someone new…'), value: NEW_PERSON }]}
                        />
                      </Field>
                      <Field label="Part">
                        <Select value={m.role} onChange={setMember(i, 'role')} options={ROLE_CHOICES} />
                      </Field>
                      {m.person === NEW_PERSON && (
                        <Field label="Their name in People" className="sm:col-span-2">
                          <TextInput value={m.new_person} onChange={setMember(i, 'new_person')} placeholder="Alex Morgan" />
                        </Field>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="grid items-start gap-4 sm:grid-cols-2">
            {!shared && (
              <Field label="Whose account is it?">
                <Select
                  value={form.person_id}
                  onChange={set('person_id')}
                  options={[...personChoices(people), { ...blankChoice('Someone new…'), value: NEW_PERSON }]}
                />
              </Field>
            )}
            <Field label="Type">
              <Select
                value={form.account_type}
                onChange={set('account_type')}
                options={form.account_type ? ACCOUNT_TYPE_CHOICES : [blankChoice('Pick one…'), ...ACCOUNT_TYPE_CHOICES]}
              />
            </Field>
            {!shared && addingPerson && (
              <Field label="Their name" hint="Added to People with this account">
                <TextInput value={form.new_person} onChange={set('new_person')} placeholder="Alex Morgan" />
              </Field>
            )}
            <Field label="Name">
              <TextInput value={form.name} onChange={set('name')} placeholder="Customized Cash Rewards" />
            </Field>
            <Field label="Issuer" hint="Optional">
              <TextInput value={form.issuer} onChange={set('issuer')} placeholder="Bank of America" />
            </Field>
            <Field label="Last 4 digits" hint="Optional">
              <TextInput value={form.mask} onChange={set('mask')} inputMode="numeric" maxLength={4} className="tnum" />
            </Field>
            {needsLimit && !limit.skipped && (
              <div>
                <Field label="Credit limit">
                  <TextInput value={limit.text} onChange={(e) => setLimit({ text: e.target.value, skipped: false })} inputMode="decimal" placeholder="5,000" className="tnum" />
                </Field>
                <p className="mt-1 px-3 text-xs text-faint">
                  Not printed on this statement ·{' '}
                  <button type="button" className={LINK} onClick={() => setLimit({ text: '', skipped: true })}>Skip, add it later</button>
                </p>
              </div>
            )}
          </div>
          {needsLimit && limit.skipped && (
            <p className="mt-2 text-sm text-faint">
              No limit for now; add it any time in Settings → Accounts.{' '}
              <button type="button" className={LINK} onClick={() => setLimit({ text: '', skipped: false })}>Add it now</button>
            </p>
          )}
          <div className="mt-4 flex items-center gap-2">
            <Button
              onClick={create}
              disabled={busy || Boolean(createBlocked)}
            >
              {busy ? 'Creating…' : 'Create & attach'}
            </Button>
            <Button variant="quiet" onClick={() => setMode('resolve')} disabled={busy}>
              Back
            </Button>
            {!busy && createBlocked && <span className="text-sm text-faint">{createBlocked}</span>}
          </div>
        </>
      )}

      {mismatch && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <p className="text-sm text-spend">{mismatch.message}</p>
          <Button variant="quiet" onClick={() => confirm({ ...mismatch.body, force: true })} disabled={busy}>
            Attach anyway
          </Button>
        </div>
      )}
      {error && <p className="mt-3 text-sm text-spend">{error}</p>}
    </div>
  );
}

/**
 * The review table — the human step between parsing and the permanent
 * record. Nothing reaches `transaction` without passing through here.
 *
 * Row selection defaults: clean rows are pre-checked, suspected
 * duplicates and LOW-confidence rows are not. The 30 seconds this
 * screen costs is the price of never wondering whether a number in
 * your history is real.
 */

function Amount({ cents }) {
  if (cents == null) return <span className="text-faint">—</span>;
  const color = cents < 0 ? 'text-spend' : 'text-earn';
  return <span className={`font-mono text-sm tnum ${color}`}>{formatMoney(cents, { showSign: true })}</span>;
}

/**
 * Do the rows add up to the statement's own printed balances? Computed
 * by the API (api/src/statements/tally.js). A mismatch is the most useful signal
 * on this screen: it means a row is missing or misread somewhere.
 */
function TallyBanner({ tally, batchId, canRecover, onQueued, onBalances }) {
  if (!tally) return null;
  const money = (c) => <span className="font-mono tnum whitespace-nowrap">{formatMoney(c, { showSign: true })}</span>;
  if (tally.status === 'unknown') {
    return (
      <p className="mb-4 rounded-lg border border-rule bg-band/40 px-3 py-2 text-sm text-muted">
        This statement didn't print an opening and closing balance, so its total can't be checked.
      </p>
    );
  }
  if (tally.status === 'match') {
    return (
      <p className="mb-4 rounded-lg border border-earn/30 bg-earn/5 px-3 py-2 text-sm text-ink">
        <span className="text-earn">✓ Adds up.</span> The rows total {money(tally.rows_cents)}, exactly what the
        statement's balances changed by.
      </p>
    );
  }
  return (
    <div className="mb-4 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-ink">
      <p>
        <span className="font-medium text-warn">Needs review.</span> The rows total {money(tally.rows_cents)}, but the
        statement's balances changed by {money(tally.expected_cents)}, so{' '}
        <span className="font-mono tnum whitespace-nowrap">{formatMoney(Math.abs(tally.diff_cents))}</span> is unaccounted for. A row may be
        missing or misread.
      </p>
      {canRecover && <RecoverRows batchId={batchId} onQueued={onQueued} onBalances={onBalances} />}
    </div>
  );
}

/**
 * "Look for missing rows" (D214): re-reads the stored PDF with today's
 * reader and lists what the saved rows lack. Adding them queues them
 * below as pending rows, approved like any other. Re-running the
 * reading can't do this for a statement already approved: it only ever
 * reads into a fresh import.
 */
function RecoverRows({ batchId, onQueued, onBalances }) {
  const [found, setFound] = useState(null); // { rows, balances } after a look
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const call = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const look = () => call(async () => setFound(await api.imports.recover(batchId, { dry: true })));
  const addRows = () => call(async () => { const r = await api.imports.recover(batchId); setFound(null); onQueued(r.rows.length); });
  const useBalances = () => call(async () => { await api.imports.recover(batchId, { balances: true }); setFound(null); onBalances(); });
  const bal = found?.balances;
  const balanceLine = (label, saved, read) => saved !== read && (
    <li>{label}: saved as <span className="font-mono tnum">{formatMoney(saved)}</span>, the statement prints <span className="font-mono tnum text-ink">{formatMoney(read)}</span></li>
  );

  return (
    <div className="mt-2 space-y-2">
      {found === null && (
        <button onClick={look} disabled={busy} className="rounded-md border border-warn/50 bg-raised px-2.5 py-1 text-sm text-ink hover:bg-band disabled:opacity-60">
          {busy ? 'Reading the statement again…' : 'Look for missing rows'}
        </button>
      )}
      {found && found.rows.length === 0 && !bal && (
        <p className="text-muted">Read it again: every row and both balances match the statement. The gap is a row that was misread, so compare the amounts with the PDF.</p>
      )}
      {bal && (
        <div className="space-y-1.5">
          <p>The rows are right; a balance was misread:</p>
          <ul className="list-disc pl-5 text-muted">
            {balanceLine('Opening balance', bal.saved.opening_cents, bal.read.opening_cents)}
            {balanceLine('Closing balance', bal.saved.closing_cents, bal.read.closing_cents)}
          </ul>
          <button onClick={useBalances} disabled={busy} className="rounded-md bg-ink px-2.5 py-1 text-sm text-paper hover:bg-ink/90 disabled:opacity-60">
            Use the printed balances
          </button>
        </div>
      )}
      {found && found.rows.length > 0 && (
        <div className="space-y-1.5">
          <p>Found {found.rows.length} row{found.rows.length === 1 ? '' : 's'} the statement prints that aren't saved:</p>
          <ul className="space-y-0.5">
            {found.rows.map((r, i) => (
              <li key={i} className="flex items-baseline justify-between gap-3 rounded bg-raised px-2 py-1">
                <span className="min-w-0 truncate"><span className="font-mono tnum text-muted">{formatShortDate(r.posted_date)}</span> {r.description}</span>
                <span className={`shrink-0 font-mono tnum ${r.amount_cents < 0 ? 'text-spend' : 'text-earn'}`}>{formatMoney(r.amount_cents, { showSign: true })}</span>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button onClick={addRows} disabled={busy} className="rounded-md bg-ink px-2.5 py-1 text-sm text-paper hover:bg-ink/90 disabled:opacity-60">
              Add {found.rows.length === 1 ? 'it' : 'them'} for review
            </button>
            <button onClick={() => setFound(null)} className="rounded-md border border-rule px-2.5 py-1 text-sm text-ink hover:bg-band">Not now</button>
          </div>
        </div>
      )}
      {error && <p className="text-spend">{error}</p>}
    </div>
  );
}

/**
 * The statement's own printed numbers, in one strip above the rows (D335):
 * the balances, money out and in, cashback earned and when it's due. They
 * were saved (the statement table) but never shown here.
 */
const TONE = { spend: 'text-spend', earn: 'text-earn' };

function StatementFigures({ summary, accountType, shown = Infinity, onFocusFigure, lit = null }) {
  const figures = statementFigures(summary, accountType);
  if (figures.length === 0) return null;
  return (
    // One row of them however many printed (up to six), two to a row on a phone. While the
    // statement is read in (D360), each figure fills in its own box in turn, page 1 first.
    // Hovering one lights where the statement prints it, as hovering a row does (D360).
    <dl style={{ '--figures': figures.length }} className="mb-3 grid grid-cols-2 overflow-hidden rounded-xl border border-rule sm:grid-cols-[repeat(var(--figures),minmax(0,1fr))]">
      {figures.map((f, i) => (
        <div key={f.key}
          onMouseEnter={onFocusFigure ? () => onFocusFigure(f.key) : undefined}
          onMouseLeave={onFocusFigure ? () => onFocusFigure(null) : undefined}
          className={`-mt-px -ml-px min-w-0 border-t border-l border-rule px-3.5 py-2.5 transition-colors duration-200 ${onFocusFigure ? 'hover:bg-band/60' : ''} ${lit === f.key ? 'bg-info/8' : ''} ${f.key === 'due' && figures.length % 2 === 1 ? 'col-span-2 sm:col-span-1' : ''}`}>
          <dt className="truncate text-xs text-muted">{f.label}{f.key === 'due' && f.minimum != null ? ` · min ${formatMoney(f.minimum)}` : ''}</dt>
          <dd className={`mt-0.5 truncate font-mono text-[15px] tnum ${TONE[f.tone] ?? 'text-ink'} ${i < shown ? '' : 'invisible'}`}>
            <span className={i < shown && Number.isFinite(shown) ? 'reveal-arrive' : ''}>{f.key === 'due' ? formatShortDate(f.date) : f.text ?? formatMoney(f.cents)}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The statement's head (D360): its figures, then the line of the limit used,
 * with "Date | Printed" at that line's right end to pick the rows' order (the
 * owner's pick of place). A statement with no limit keeps the switch alone there.
 */
function StatementHead({ summary, accountType, onFocusFigure, onFocusRow, lit, order, onOrder, notes = [], showNotes = notes.length > 0 }) {
  // The printed limit, else the household's own (Apple), said as theirs (D360).
  const u = accountType === 'CREDIT_CARD' ? cardUtilisation({ credit_line: statementCreditLine(summary) }) : null;
  // A bank or savings account has no limit: its balance on the statement takes that place, with a savings APY.
  const balance = accountType !== 'CREDIT_CARD' && summary?.closing_cents != null && (
    <span className="min-w-0 truncate text-[13px] text-muted">
      Balance <span className="font-mono text-ink tnum">{formatMoney(summary.closing_cents)}</span>
      {summary.savings?.apy_bps != null && <> · <span className="font-mono tnum">{aprText(summary.savings.apy_bps)}</span> APY</>}
    </span>
  );
  const switcher = onOrder && <Segmented size="sm" value={order} onChange={onOrder} options={[{ value: 'date', label: 'Date' }, { value: 'printed', label: 'Printed' }]} />;
  const limitLine = (u || onOrder) && (
    <div className="flex items-end gap-4">
      {/* The credit line this statement printed, as used of its limit (D346). */}
      <UtilisationBar className="min-w-0 flex-1" u={u} />
      {switcher && <span className={`shrink-0 ${u ? '' : 'ml-auto'}`}>{switcher}</span>}
    </div>
  );
  return (
    <>
      <StatementFigures summary={summary} accountType={accountType} onFocusFigure={onFocusFigure} lit={lit} />
      {/* Half and half (D360): the limit line and the order switch, and what the statement shows that's worth
          knowing. With nothing to note, the limit line has the width. */}
      {/* Always half and half once there are rows (D360): the notes box says so when there's nothing new. */}
      {showNotes ? (
        <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className={`${NOTES_BOX} flex flex-col justify-center`}>
            {u ? <UtilisationBar compact u={u} trailing={switcher} />
              : <div className="grid grid-cols-[minmax(0,4fr)_minmax(7rem,1fr)] items-center gap-3"><div className="min-w-0">{balance}</div><div className="flex justify-end">{switcher}</div></div>}
          </div>
          <StatementNotes notes={notes} onFocusRow={onFocusRow} onFocusFigure={onFocusFigure} />
        </div>
      ) : limitLine && <div className="mb-3 px-0.5">{limitLine}</div>}
    </>
  );
}

/** Read-only badge, for already-approved rows. */
function TypeBadge({ type }) {
  if (!type) return null;
  return (
    <span className="rounded border border-rule px-1.5 py-0.5 text-xs text-muted">
      {TXN_TYPE_LABELS[type] ?? type}
    </span>
  );
}

/**
 * The rows' side of a statement still being read, right after its upload
 * (D335): a reading line sweeping a few blank rows, and what's happening in
 * words. The page is already beside it.
 */
function ReadingNow() {
  return (
    <div className="py-6" role="status" aria-live="polite">
      <p className="text-[15px] font-medium text-ink">Reading the statement…</p>
      <p className="mt-0.5 text-[13px] text-muted">On this computer, free. Its rows appear here in a moment.</p>
      <div className="mt-5 space-y-2" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="reading-now-row relative h-11 overflow-hidden rounded-lg bg-band/70" style={{ animationDelay: `${i * 140}ms` }} />
        ))}
      </div>
    </div>
  );
}

/** "Dec 6, 2024 – Jan 5, 2025". */
const statementDates = (s) => `${formatShortDate(s.period_start)}, ${s.period_start.slice(0, 4)} – ${formatShortDate(s.period_end)}, ${s.period_end.slice(0, 4)}`;

/**
 * Quiet inline select for a pending row's type — same "reads as text
 * until you interact" treatment as the category select. Extraction
 * gets this right almost always, but statement quirks (a rent-payment
 * card showing an internal adjustment that isn't really a refund) mean
 * it needs a manual override sometimes, not a schema change.
 */
function QuietSelect({ value, onChange, options, className = 'text-muted' }) {
  return <Dropdown quiet value={value ?? ''} onChange={onChange} options={options} recentKey={options.length > 12 ? 'category' : undefined} className={className} aria-label="Change" />;
}

const TYPE_OPTIONS = [blankChoice('—'), ...TXN_TYPE_CHOICES];
function TypeSelect({ value, onChange }) {
  return <QuietSelect value={value} onChange={onChange} options={TYPE_OPTIONS} className="text-xs text-muted" />;
}

export function Review({ batchId, categories, accounts, people, onApproved, onAccountConfirmed, pickOther = false, reveal = false, onFocusRow, onReadProgress, pageBeside = false, reading = false, onFinished, hideReplay = false, printed = null, onFocusFigure, litFigure = null }) {
  const notify = useNotify();
  const confirm = useConfirm();
  const staged = useApi(`staged:${batchId}`, () => api.imports.staged(batchId), { tags: ['imports'] });
  const data = staged.data ?? null;
  const setData = staged.setData;
  const [openDetail, setOpenDetail] = useState(null); // staged row id whose Review panel is open
  // null until the household ticks something: then the pre-checked rows below apply.
  const [picked, setSelected] = useState(null);
  const [actionError, setError] = useState(null);
  const [conflictId, setConflictId] = useState(null); // staged row id a duplicate-conflict error named
  const [busy, setBusy] = useState(false);
  const [iconGap, setIconGap] = useState([]); // merchant names just approved that have no icon at all
  const [showZeros, setShowZeros] = useState(false); // the $0.00 lines folded under the rows (D335)
  // By date (organized, D360), or as the statement printed them, each person's line on a shared card.
  const [order, setOrder] = useState('date');
  // The columns that fit the table's own width (a phone, or beside the real pages); a panel's colSpan
  // has to match the columns shown, or they collapse.
  const [tableRef, cols] = useColumns();
  // The statement's head is fixed while its rows scroll (D360): the table's header sticks right under it.
  const [headRef, headHeight] = useHeight();

  // Pre-check only the rows a human wouldn't need to squint at.
  const selected = useMemo(
    () => picked ?? new Set((data?.rows ?? [])
      .filter(readsCleanly)
      .map((r) => r.id)),
    [picked, data],
  );
  const error = actionError ?? staged.error;
  // After an approval: fresh rows, and the pre-checks worked out again from them.
  const load = async () => {
    setSelected(null);
    staged.reload();
  };

  const pending = useMemo(
    () => (data ? data.rows.filter((r) => r.review_status === 'PENDING') : []),
    [data]
  );

  // A pending row's category is still a plain name (suggested_category,
  // not yet a real foreign key), so its icon has to be looked up by
  // name here rather than coming back joined from the database like an
  // approved row's category_icon_key already does. Declared here, above
  // the loading-state early return below, so this hook always runs on
  // every render — a hook after an early return only fires on SOME
  // renders, which is exactly what "Rendered more hooks than during the
  // previous render" means (caught live, not just in review).
  const categoryIconByName = useMemo(
    () => new Map(categories.map((c) => [c.name, c.icon_key])),
    [categories]
  );

  /**
   * The reading, right after a statement is parsed (`reveal`, D171): the
   * statement plays into its rows in the style picked in Settings →
   * Animation (StatementReveal, D335), then this table takes over. About 7
   * seconds whatever the length, with a Skip. Reopening a statement later
   * doesn't replay it unless asked, and Reduce Motion skips it entirely.
   */
  const reduceMotion = useReducedMotion();
  const [readingStyle] = useReadingStyle();
  const [revealing, setRevealing] = useState(reveal && !reduceMotion);
  const [replays, setReplays] = useState(0);
  const rowCount = data?.rows.length ?? 0;
  const showReveal = data != null && revealing && rowCount > 0;
  // A statement for an unknown account waits under the account card; the reading starts once it's confirmed.
  const waitingForAccount = data?.batch.status === 'NEEDS_ACCOUNT';

  // Just uploaded and still being read (D335): the card is already open, so it says so here
  // until the rows come back. The batch's own status covers the moment the fresh rows are
  // still on their way.
  // The reading follows the pages (D360): it starts once they've said where each line sits, a moment later.
  if (reading || ['UPLOADED', 'PARSING'].includes(data?.batch.status) || (showReveal && printed?.pending)) {
    return <ReadingNow />;
  }
  if (!data) {
    return <p className="py-4 text-sm text-muted">{error ?? 'Loading rows…'}</p>;
  }

  const toggle = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const patchRow = async (row, changes) => {
    try {
      await api.imports.updateStaged(batchId, row.id, changes);
      setData({
        ...data,
        rows: data.rows.map((r) => (r.id === row.id ? { ...r, ...changes } : r)),
      });
    } catch (err) {
      setError(err.message);
    }
  };

  const setCategory = (row, name) => patchRow(row, { suggested_category: name === '' ? null : name });
  const setMerchant = (row, name) => patchRow(row, { merchant: name });
  const setType = (row, type) => type !== '' && patchRow(row, { txn_type: type });

  /**
   * Editing an already-approved row. This PATCHes the real
   * `transaction` (via the same endpoint the main ledger uses, keyed
   * by row.transaction_id — migration 009), not the frozen staged
   * snapshot, so the change shows up everywhere else in the app too,
   * not just on this screen.
   */
  const patchTransaction = async (row, changes) => {
    try {
      await api.transactions.update(row.transaction_id, changes);
      setData({
        ...data,
        rows: data.rows.map((r) => {
          if (r.id !== row.id) return r;
          const next = { ...r, ...changes };
          if (changes.category_id !== undefined) {
            next.category_name = categories.find((c) => c.id === changes.category_id)?.name ?? null;
          }
          return next;
        }),
      });
    } catch (err) {
      setError(err.message);
    }
  };

  const setApprovedCategory = (row, value) =>
    patchTransaction(row, { category_id: value === '' ? null : Number(value) });
  const setApprovedMerchant = (row, name) => patchTransaction(row, { merchant: name });
  const setApprovedType = (row, type) => type !== '' && patchTransaction(row, { txn_type: type });

  /**
   * "Auto-run after every import" (as opposed to only surfacing gaps
   * when someone happens to visit Settings) — right after a batch is
   * approved, check its merchants against the same real-logo/custom-
   * icon coverage Settings already computes (`classify()` in
   * MerchantIcons.jsx), and flag any with neither. Best-effort: a
   * failure here shouldn't block or blemish the approve that already
   * succeeded, so it's swallowed rather than surfaced as an error.
   */
  const checkNewMerchantIcons = async (rows) => {
    const merchants = [...new Set(rows.map((r) => r.merchant).filter(Boolean))];
    const uncovered = merchants.filter((m) => !lookupMerchantDomain(m));
    if (uncovered.length === 0) return;
    try {
      const customized = await api.merchantIcons.list();
      const customizedNames = new Set(customized.map((c) => c.merchant));
      const gap = uncovered.filter((m) => !customizedNames.has(m));
      if (gap.length > 0) setIconGap(gap);
    } catch {
      // best-effort only
    }
  };

  const approve = async (body) => {
    setBusy(true);
    setError(null);
    setConflictId(null);
    try {
      const approvedRows = body.all ? pending : pending.filter((r) => body.staged_ids.includes(r.id));
      const result = await api.imports.approve(batchId, body);
      announceApproval(notify, result);
      await load();
      checkNewMerchantIcons(approvedRows);
      onApproved();
      // Nothing left to look at: the statement closes, the way it opened (D335).
      if (approvedRows.length >= pending.length) onFinished?.();
    } catch (err) {
      setError(err.message);
      // The server names the exact row that conflicted (see D-notes on
      // the approve endpoint) — deselect it so a retry of "Approve
      // selected" doesn't just hit the same wall again, and highlight
      // it so it's obvious which one to look at.
      const stagedId = err.body?.staged_id;
      if (stagedId != null) {
        setConflictId(stagedId);
        setSelected((prev) => {
          const next = new Set(prev ?? selected);
          next.delete(stagedId);
          return next;
        });
      }
    } finally {
      setBusy(false);
    }
  };

  /**
   * The human override for a row the exact-duplicate check rejects.
   * A light confirm, not the PDF-parse-cost dialog's weight — this is
   * free, but it does add a permanent ledger row, so a one-line gut
   * check before it fires is worth the click.
   */
  const approveAnyway = async (row) => {
    if (!(await confirm({ title: 'Approve it on its own?', message: 'Only if it isn\'t the same purchase imported again.', confirm: 'Approve' }))) {
      return;
    }
    setError(null);
    try {
      await api.imports.approveAnyway(batchId, row.id);
      if (conflictId === row.id) setConflictId(null);
      await load();
      checkNewMerchantIcons([row]);
      notify(row.description, { name: 'review.approved' });
      onApproved();
      if (pending.length <= 1) onFinished?.();
    } catch (err) {
      setError(err.message);
    }
  };

  /**
   * Skip a line (D335): it's the same purchase as one already saved, or not a
   * transaction at all. It stays on the statement, faded, with Undo there and
   * in the toast; it never becomes a transaction.
   */
  const setRow = (id, changes) => setData((d) => ({ ...d, rows: d.rows.map((r) => (r.id === id ? { ...r, ...changes } : r)) }));
  const untick = (id) => setSelected((prev) => { const next = new Set(prev ?? selected); next.delete(id); return next; });
  const restore = async (row) => {
    try {
      await api.imports.restoreStaged(batchId, row.id);
      setRow(row.id, { review_status: 'PENDING' });
      invalidate('imports');
    } catch (err) {
      setError(err.message);
    }
  };
  const skipLine = async (row) => {
    setBusy(true);
    setError(null);
    try {
      await api.imports.skipStaged(batchId, row.id);
      setRow(row.id, { review_status: 'REJECTED' });
      untick(row.id);
      setOpenDetail(null);
      if (conflictId === row.id) setConflictId(null);
      notify(txnName(row) ?? row.description, { name: 'review.skipped', action: { label: 'Undo', onClick: () => restore(row) } });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  // A dateless line takes its date here, then is ticked like any other.
  const setDate = async (row, iso) => {
    await patchRow(row, { posted_date: iso });
    setSelected((prev) => new Set(prev ?? selected).add(row.id));
  };
  // "Approve all" lets every pending line through, so a flagged one is asked about first.
  const approveAll = async () => {
    const flagged = flaggedPending(data.rows);
    if (flagged.length > 0 && !(await confirm({
      title: `Approve all ${pending.length}?`,
      message: `${flagged.length} of them ${flagged.length === 1 ? 'is' : 'are'} flagged (a possible duplicate, a line read unsure, or no date). Open ${flagged.length === 1 ? 'it' : 'them'} to check, or approve them as they are.`,
      confirm: 'Approve all',
    }))) return;
    approve({ all: true });
  };

  const categoryOptions = [blankChoice('—'), ...categoryChoices(categories, { by: 'name' })];
  // Editing an approved row goes through the real transaction's
  // category_id (a foreign key), not the staged row's name-based
  // suggestion — same shape Transactions.jsx already uses.
  const categoryOptionsById = [blankChoice('—'), ...categoryChoices(categories)];

  const needsAccount = data.batch.status === 'NEEDS_ACCOUNT';
  const accountType = accounts.find((a) => a.id === data.batch.account_id)?.account_type ?? data.batch.detected_account_type;
  // With nothing above it, the head starts at the column's top edge, where it sticks, so it never rides up (D360).
  const headAtTop = !needsAccount && iconGap.length === 0 && !data.same_statement && (showReveal || hideReplay || reduceMotion || rowCount === 0);
  // What the statement shows that's worth knowing (D360), worded here: formatMoney stays the only divider.
  const notes = statementNotes(data, { money: (c) => formatMoney(c), date: formatShortDate, mask: maskName, apr: aprText });
  // The rows in the order picked (D360): by date, or as printed with each person's line on a shared card.
  const runs = printedSections(printedOrder(data.rows, printed?.located));
  const asPrinted = order === 'printed';
  const shownRows = asPrinted ? runs.flatMap((r) => r.rows) : data.rows;
  const runStart = new Map(asPrinted ? runs.filter((r) => r.key).map((r) => [r.rows[0].id, r]) : []);

  return (
    <div className="mt-4">
      {needsAccount && (
        <AccountCard
          batch={data.batch}
          rows={data.rows}
          accounts={accounts}
          people={people}
          pickOther={pickOther}
          onConfirmed={(name) => { load(); onAccountConfirmed?.(batchId); notify(name ? `On ${name}` : 'On this statement', { name: 'statement.account' }); }}
        />
      )}

      <div className={needsAccount ? 'mt-6 opacity-40' : ''}>
        {needsAccount && (
          <p className="mb-3 text-sm text-warn">
            Confirm the account above before reviewing these rows.
          </p>
        )}
        {iconGap.length > 0 && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-rule bg-band px-3 py-2 text-sm">
            <span className="text-muted">
              {iconGap.length} new merchant{iconGap.length === 1 ? '' : 's'} {iconGap.length === 1 ? 'has' : 'have'} no icon: {iconGap.join(', ')}
            </span>
            <Link to="/settings" className="shrink-0 text-ink underline-offset-2 hover:underline">
              Set icons
            </Link>
          </div>
        )}
        {!showReveal && rowCount > 0 && !reduceMotion && !hideReplay && (
          <div className="mb-2 flex justify-end">
            <button
              onClick={() => { setOpenDetail(null); setReplays((n) => n + 1); setRevealing(true); }}
              className="flex items-center gap-1.5 text-xs text-muted underline-offset-4 hover:text-ink hover:underline"
            >
              <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.5v9l7.5-4.5z" fill="currentColor" /></svg>
              Replay the reading
            </button>
          </div>
        )}
        {showReveal ? (
          <StatementReveal
            key={replays}
            rows={data.rows}
            tally={data.tally}
            printed={printed}
            figureKeys={statementFigures(data.summary, accountType).map((f) => f.key)}
            figures={(shown, lit) => <StatementFigures summary={data.summary} accountType={accountType} shown={shown} lit={lit} />}
            headAtTop={headAtTop}
            notes={notes}
            onFocusRow={onFocusRow}
            onFocusFigure={onFocusFigure}
            style={readingStyle}
            paused={waitingForAccount}
            iconFor={(name) => categoryIconByName.get(name)}
            pageBeside={pageBeside}
            onProgress={onReadProgress}
            onDone={() => { setRevealing(false); onReadProgress?.(null); }}
          />
        ) : (
          <motion.div initial={reveal && !reduceMotion ? { opacity: 0, y: -6 } : false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            {/* The whole statement is already saved (D307): said once, not as a duplicate on every row. */}
            {data.same_statement && (
              <div role="status" className="mb-3 rounded-xl border border-rule bg-band px-4 py-3 text-[14px]">
                <p className="font-medium text-ink">
                  This statement is already in the app: {statementDates(data.same_statement)}.
                </p>
                <p className="mt-0.5 text-[13px] text-muted">
                  Its rows match the ones saved from it, so there's nothing to add. Banks name a statement by the month it closes:
                  this one closes {formatShortDate(data.same_statement.period_end)}, {data.same_statement.period_end.slice(0, 4)}. Delete this upload and pick the next one.
                </p>
              </div>
            )}
          </motion.div>
        )}
        {!showReveal && (
          <div ref={headRef} className={`sticky top-0 z-20 flow-root bg-raised ${headAtTop ? '-mt-4 pt-4' : 'pt-1'}`}>
            <StatementHead summary={data.summary} accountType={accountType} onFocusFigure={onFocusFigure} onFocusRow={onFocusRow} lit={litFigure}
              order={order} onOrder={rowCount > 1 ? setOrder : null} notes={notes} showNotes={rowCount > 0} />
          </div>
        )}
        {!showReveal && <>
        <fieldset disabled={needsAccount} className="contents">
        {/* A phone keeps four columns, the date and category under the name: nothing scrolls sideways (D335). */}
        <div ref={tableRef}>
        <table className="w-full table-fixed border-collapse text-sm">
          <thead className="sticky z-10" style={{ top: headHeight }}>
            <tr className="table-head border-y border-rule bg-band text-left text-xs text-muted">
              <th className="w-9 bg-band py-2 pl-3 font-normal sm:w-10"><span className="sr-only">Selected</span></th>
              {cols.date && <th className={`${cols.type ? 'w-20' : 'w-16'} bg-band py-2 pr-3 font-normal`}>Date</th>}
              <th className="bg-band py-2 pr-4 font-normal">Merchant</th>
              {cols.type && <th className="w-32 bg-band py-2 pr-3 font-normal">Type</th>}
              {cols.category && <th className={`${cols.type ? 'w-40' : 'w-32'} bg-band py-2 pr-3 font-normal`}>Category</th>}
              <th className="w-[5.75rem] bg-band py-2 pr-2 text-right font-normal sm:w-28 sm:pr-4">Amount</th>
              <th className={`w-12 bg-band py-2 pr-2 text-right font-normal sm:pr-3 ${cols.type ? 'sm:w-28' : 'sm:w-24'}`}><span className="sr-only">Edit or review</span></th>
            </tr>
          </thead>
          <tbody>
            {shownRows.map((row) => {
              const isPending = row.review_status === 'PENDING';
              const isSkipped = row.review_status === 'REJECTED';
              const isConflict = row.id === conflictId;
              const flags = lineFlags(row, { conflict: isConflict });
              const detailOpen = openDetail === row.id;
              if (!showZeros && foldsAway(row, flags.length > 0)) return null;
              // The category control, in its column on a wide screen and under the name on a phone.
              const category = isSkipped ? (
                <span>{row.suggested_category ?? '—'}</span>
              ) : isPending ? (
                <QuietSelect value={row.suggested_category ?? ''} onChange={(name) => setCategory(row, name)} options={categoryOptions} className="text-sm text-ink" />
              ) : row.transaction_id ? (
                <QuietSelect value={row.category_id != null ? String(row.category_id) : ''} onChange={(value) => setApprovedCategory(row, value)} options={categoryOptionsById} className="text-sm text-ink" />
              ) : (
                <span>{row.category_name ?? row.suggested_category ?? '—'}</span>
              );
              const run = runStart.get(row.id);
              return [
                run && <SectionLine key={`line-${row.id}`} run={run} figures={sectionFigures(run, runs, printed?.totals ?? [])} complete span={cols.count} />,
                <tr
                  key={row.id}
                  // Beside the real pages: the row looked at lights its line there (D335).
                  onMouseEnter={onFocusRow ? () => onFocusRow(row.id) : undefined}
                  className={`border-b border-rule transition-colors hover:bg-band/50
                    ${flags.length > 0 ? 'border-l-2 border-l-warn' : ''}
                    ${isConflict ? 'bg-warn/10' : ''}
                    ${isSkipped ? 'text-muted [&_td]:opacity-55 [&_td:last-child]:opacity-100' : ''}
                    ${detailOpen ? 'bg-band/50' : ''}`}
                >
                  <td className="h-12 py-2 pl-3 align-middle">
                    {isSkipped ? (
                      <span className="text-faint" title="Skipped" aria-label="Skipped">–</span>
                    ) : isPending ? (
                      <input
                        type="checkbox"
                        checked={selected.has(row.id)}
                        onChange={() => toggle(row.id)}
                        aria-label={`Select ${row.description ?? 'row'}`}
                      />
                    ) : (
                      <span className="text-earn" title="Approved">✓</span>
                    )}
                  </td>
                  {cols.date && <td className="py-2 pr-3 align-middle font-mono text-muted tnum whitespace-nowrap" title={row.posted_date ?? undefined}>
                    {row.posted_date ? formatShortDate(row.posted_date) : <span className="text-warn">no date</span>}
                  </td>}
                  <td className="py-2 pr-4 align-middle">
                    <div className="flex items-center gap-2" title={row.description ?? undefined}>
                      <div className="shrink-0">
                        <MerchantAvatar
                          merchant={row.merchant}
                          description={row.description}
                          txnType={row.txn_type}
                          amountCents={row.amount_cents}
                          categoryName={row.category_name ?? row.suggested_category}
                          categoryIconKey={row.category_icon_key ?? categoryIconByName.get(row.suggested_category)}
                          size={26}
                        />
                      </div>
                      <div className="min-w-0 flex-1 text-ink">
                        {isSkipped ? (
                          <span className="block truncate line-through decoration-faint">{txnName(row) ?? row.description ?? '—'}</span>
                        ) : isPending ? (
                          <EditableText
                            value={txnName(row)}
                            placeholder={row.description ?? '—'}
                            onSave={(name) => setMerchant(row, name)}
                            className="block w-full truncate"
                          />
                        ) : row.transaction_id ? (
                          <EditableText
                            value={txnName(row)}
                            placeholder={row.description ?? '—'}
                            onSave={(name) => setApprovedMerchant(row, name)}
                            className="block w-full truncate"
                          />
                        ) : (
                          <span className="block truncate"><TxnName t={row} fallback={row.description ?? '—'} /></span>
                        )}
                        {!cols.date && <div className="flex min-w-0 items-center gap-1 text-xs text-muted">
                          {row.posted_date && <><span className="shrink-0 tnum">{formatShortDate(row.posted_date)}</span><span aria-hidden="true">·</span></>}
                          {flags.length > 0
                            ? <span className="min-w-0 truncate font-medium text-warn">{FLAG_WORDS[flags[0]]}</span>
                            : <span className="min-w-0 truncate [&_button]:text-xs">{category}</span>}
                        </div>}
                      </div>
                    </div>
                  </td>
                  {cols.type && <td className="py-2 pr-3 align-middle">
                    <div>
                      {isSkipped ? (
                        <TypeBadge type={row.txn_type} />
                      ) : isPending ? (
                        <TypeSelect value={row.txn_type} onChange={(type) => setType(row, type)} />
                      ) : row.transaction_id ? (
                        <TypeSelect value={row.txn_type} onChange={(type) => setApprovedType(row, type)} />
                      ) : (
                        <TypeBadge type={row.txn_type} />
                      )}
                    </div>
                  </td>}
                  {cols.category && <td className="py-2 pr-3 align-middle">{category}</td>}
                  <td className="py-2 pr-2 text-right align-middle whitespace-nowrap sm:pr-4">
                    <div className={isSkipped ? 'line-through decoration-faint' : ''}>
                      <Amount cents={row.amount_cents} />
                    </div>
                  </td>
                  <td className="py-2 pr-2 text-right align-middle sm:pr-3">
                    {/* Reads cleanly: a quiet pencil. Flagged: the one thing to look at, in amber (D335). */}
                    <div className="inline-flex justify-end">
                      <LineButton
                        flags={flags}
                        skipped={isSkipped}
                        open={detailOpen}
                        label={txnName(row) ?? row.description ?? 'row'}
                        onClick={() => { setOpenDetail(detailOpen ? null : row.id); onFocusRow?.(row.id); }}
                        onRestore={() => restore(row)}
                      />
                    </div>
                  </td>
                </tr>,
                detailOpen && (
                  <tr key={`${row.id}-detail`} className="border-b border-rule">
                    {cols.date && <td />}
                    <td colSpan={cols.date ? cols.count - 1 : cols.count} className={`pt-1 pr-2 pb-3 ${cols.date ? '' : 'pl-2'}`}>
                      <LineReview
                        row={row}
                        batchId={batchId}
                        flags={flags}
                        pending={isPending}
                        busy={busy}
                        onClose={() => setOpenDetail(null)}
                        onSkip={() => skipLine(row)}
                        onKeep={() => approveAnyway(row)}
                        onSelect={() => { setSelected((prev) => new Set(prev ?? selected).add(row.id)); setOpenDetail(null); }}
                        onDate={(iso) => setDate(row, iso)}
                        onRename={isPending || row.transaction_id ? (name) => (isPending ? setMerchant(row, name) : setApprovedMerchant(row, name)) : null}
                      />
                    </td>
                  </tr>
                ),
              ];
            })}
          </tbody>
        </table>
        </div>
        </fieldset>
        {(() => {
          const zeros = data.rows.filter((r) => foldsAway(r, lineFlags(r, { conflict: r.id === conflictId }).length > 0)).length;
          return zeros > 0 && (
            <div className="flex items-center justify-between gap-3 border-b border-rule px-3 py-2.5 text-[13px] text-muted">
              <span>{showZeros ? `${zeros} line${zeros === 1 ? '' : 's'} of $0.00 shown above` : `${zeros} line${zeros === 1 ? '' : 's'} of $0.00, not shown`}</span>
              <button type="button" onClick={() => setShowZeros((v) => !v)} className="text-ink underline decoration-rule-str underline-offset-2 hover:decoration-ink">
                {showZeros ? 'Hide' : 'Show'}
              </button>
            </div>
          );
        })()}

        {/* The check comes after the rows it checks (the owner's request, D335): the sum, under the lines. */}
        <div className="mt-4 [&>*]:mb-0">
          <TallyBanner
            tally={data.tally}
            batchId={batchId}
            canRecover={data.batch.file_type === 'PDF'}
            onQueued={(n) => { notify(`${n} missing row${n === 1 ? '' : 's'}`, { name: 'statement.rows_added' }); load(); }}
            onBalances={() => { notify('From the statement', { name: 'statement.balances' }); load(); invalidate('transactions'); }}
          />
        </div>
        {error && <p className="mt-3 text-sm text-spend">{error}</p>}

        {pending.length > 0 && (
          // Pinned to the bottom of the statement's column, actions on the right (D335, the owner's
          // request): in view however far the rows scroll.
          <div className="sticky bottom-0 z-10 -mx-4 mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-rule bg-raised/90 px-4 py-3 backdrop-blur-md sm:-mx-5 sm:px-5">
            <span className="mr-auto text-sm text-faint tnum">
              {pending.length} row{pending.length === 1 ? '' : 's'} awaiting review
            </span>
            <Button variant="quiet" onClick={approveAll} disabled={busy || needsAccount}>
              Approve all
            </Button>
            <Button
              onClick={() => approve({ staged_ids: [...selected] })}
              disabled={busy || needsAccount || selected.size === 0}
            >
              {busy ? 'Approving…' : `Approve selected (${selected.size})`}
            </Button>
          </div>
        )}
        {/* A statement with no activity has no rows to approve (D314): it used to sit in
            Review for good. Approving it marks it done (approve.js, D273) and runs the follow-ups. */}
        {/* Every line skipped (D335) is done the same way. */}
        {pending.length === 0 && !needsAccount && data.batch.status === 'REVIEW' && (Number(data.batch.rows_parsed) === 0 || data.rows.some((r) => r.review_status === 'REJECTED')) ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <p className="text-sm text-muted">{Number(data.batch.rows_parsed) === 0 ? 'No activity this period: nothing to review.' : 'Every line was skipped: nothing to save.'}</p>
            <Button onClick={() => approve({ all: true })} disabled={busy}>{busy ? 'Saving…' : 'Mark as done'}</Button>
          </div>
        ) : pending.length === 0 && !needsAccount && (
          <p className="mt-4 text-sm text-muted">Every row in this import has been reviewed.</p>
        )}
        </>}
      </div>
    </div>
  );
}
