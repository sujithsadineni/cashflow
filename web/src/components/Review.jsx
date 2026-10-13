import { useEffect, useMemo, useRef, useState } from 'react';
import { txnName } from '../txn-name';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { api, formatMoney, formatShortDate, maskName, TXN_TYPE_LABELS } from '../api';
import { Button, Select, Field, TextInput, EditableText } from './Form';
import { MerchantAvatar } from './MerchantAvatar';
import { lookupMerchantDomain } from '../merchant-logos';
import { useNotify } from '../use-notify';
import { invalidate, useApi } from '../use-api';
import { checkAlerts } from '../alerts';
import { ACCOUNT_TYPE_CHOICES, TXN_TYPE_CHOICES, accountChoices, blankChoice, categoryChoices, personChoices } from '../dropdown-choices';
import { Dropdown } from './ui/Dropdown';

/**
 * After an approval (D201): what the upload changed, then the day's alerts
 * again, so anything it newly raised (or cleared) shows now, not on the
 * next page load.
 */
function announceApproval(notify, result) {
  const f = result?.follow_up;
  const bits = [];
  if (f?.payments_verified) bits.push(`${f.payments_verified} card payment${f.payments_verified === 1 ? '' : 's'} now traced to their bank`);
  if (f?.payments_named) bits.push(`${f.payments_named} named by the card`);
  if (f?.review_added) bits.push(`${f.review_added} new thing${f.review_added === 1 ? '' : 's'} to review`);
  notify(
    `${result.rows_approved} row${result.rows_approved === 1 ? '' : 's'} saved.${bits.length ? ` ${bits.join(', ')}.` : ''}`,
    {
      type: 'success',
      title: 'Statement saved',
      duration: 7000,
      action: f?.review_added ? { label: 'Open Review', to: '/review?tab=findings' } : null,
    }
  );
  // Every open view of transactions, loans and statements reloads (D211).
  invalidate('transactions', 'loans', 'imports');
  setTimeout(() => checkAlerts(notify), 600);
}

/**
 * The account confirmation card — step one of review. The parser
 * read the account identity off the statement; a human says yes,
 * picks a different one, or creates the account it found. Nothing
 * can be approved until this is settled: a statement attached to the
 * wrong account is the worst failure an importer can have.
 */
function AccountCard({ batch, accounts, people, onConfirmed }) {
  const suggested = accounts.find((a) => a.id === batch.suggested_account_id) ?? null;
  const detectedLabel = [
    batch.detected_account_name,
    batch.detected_mask ? `···${batch.detected_mask}` : null,
  ].filter(Boolean).join(' ');

  const [mode, setMode] = useState(suggested ? 'suggested' : 'resolve');
  const [pickedId, setPickedId] = useState(String(accounts[0]?.id ?? ''));
  // The statement's printed holder picks the owner up front, at first
  // render rather than corrected by an effect after (D211).
  const holderMatch = (() => {
    const holder = batch.detected_holder?.toLowerCase();
    return holder ? people.find((p) => holder.includes(p.name.split(' ')[0].toLowerCase())) : null;
  })();
  const [form, setForm] = useState({
    person_id: String(holderMatch?.id ?? people[0]?.id ?? ''),
    name: batch.detected_account_name ?? '',
    issuer: batch.detected_issuer ?? '',
    account_type: batch.detected_account_type ?? 'CREDIT_CARD',
    mask: batch.detected_mask ?? '',
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // If the printed holder name matches one of the two people,
  // pre-select them as the owner. Matches on the first word of
  // person.name, not the whole string — a real statement prints a
  // middle name ("ALEX JAMES MORGAN") that a full "Alex
  // Morgan" wouldn't appear inside of as a contiguous substring,
  // so matching the full name would silently stop working the moment
  // a person's name has more than one word in it. (Applied in the
  // form's initial state below.)
  const confirm = async (body) => {
    setBusy(true);
    setError(null);
    try {
      await api.imports.confirmAccount(batch.id, body);
      onConfirmed();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

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
                      options={accountChoices(accounts)}
                    />
                  </Field>
                </div>
                <div className="pb-0.5">
                  <Button onClick={() => confirm({ account_id: Number(pickedId) })} disabled={busy}>
                    Use this account
                  </Button>
                </div>
                <span className="pb-2.5 text-sm text-faint">or create it —</span>
              </>
            )}
            <div className="pb-0.5">
              <Button variant={accounts.length > 0 ? 'quiet' : 'primary'} onClick={() => setMode('create')} disabled={busy}>
                {batch.detected_account_name ? `Create “${batch.detected_account_name}”` : 'Create a new account'}
              </Button>
            </div>
          </div>
        </>
      )}

      {mode === 'create' && (
        <>
          <p className="mb-4 text-ink">New account — everything is editable before it's created.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Whose account is it?">
              <Select
                value={form.person_id}
                onChange={set('person_id')}
                options={personChoices(people)}
              />
            </Field>
            <Field label="Type">
              <Select value={form.account_type} onChange={set('account_type')} options={ACCOUNT_TYPE_CHOICES} />
            </Field>
            <Field label="Name">
              <TextInput value={form.name} onChange={set('name')} placeholder="Customized Cash Rewards" />
            </Field>
            <Field label="Issuer" hint="Optional">
              <TextInput value={form.issuer} onChange={set('issuer')} placeholder="Bank of America" />
            </Field>
            <Field label="Last 4 digits" hint="Optional">
              <TextInput value={form.mask} onChange={set('mask')} inputMode="numeric" maxLength={4} className="tnum" />
            </Field>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <Button
              onClick={() => confirm({ create: { ...form, person_id: Number(form.person_id) } })}
              disabled={busy || !form.name.trim()}
            >
              {busy ? 'Creating…' : 'Create & attach'}
            </Button>
            <Button variant="quiet" onClick={() => setMode('resolve')} disabled={busy}>
              Back
            </Button>
          </div>
        </>
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
 * Why a pending row needs a person's eyes, if it does. These rows
 * start unchecked; the Review button at the end of the row opens the
 * reasons and the original statement line.
 */
function reviewReasons(row, isConflict) {
  const reasons = [];
  if (isConflict) reasons.push("Already exists as a transaction, so it won't be approved twice.");
  else if (row.duplicate_of_id != null) reasons.push(`May be the same as a transaction from ${row.duplicate_posted_date}.`);
  if (row.confidence === 'LOW') reasons.push('The parser was unsure how to read this line.');
  if (!row.posted_date) reasons.push('No date was found for this row.');
  return reasons;
}

/** Text that resolves from noise into `text`, left to right — the decode in the reveal below. */
const NOISE = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#*/';
function Decode({ text, duration = 800 }) {
  const [out, setOut] = useState(() => text.replace(/\S/g, '·'));
  useEffect(() => {
    let raf;
    const t0 = performance.now();
    const tick = (now) => {
      const p = Math.min((now - t0) / duration, 1);
      const fixed = Math.floor(p * text.length);
      setOut(text.split('').map((c, i) => (i < fixed || c === ' ' ? c : NOISE[Math.floor(Math.random() * NOISE.length)])).join(''));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, duration]);
  return <>{out}</>;
}

/**
 * Do the rows add up to the statement's own printed balances? Computed
 * by the API (api/src/tally.js). A mismatch is the most useful signal
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

export function Review({ batchId, categories, accounts, people, onApproved, reveal = false }) {
  const notify = useNotify();
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

  // Pre-check only the rows a human wouldn't need to squint at.
  const selected = useMemo(
    () => picked ?? new Set((data?.rows ?? [])
      .filter((r) => r.review_status === 'PENDING' && r.confidence !== 'LOW' && r.duplicate_of_id == null && r.posted_date != null)
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
   * The reveal, right after a statement is parsed (`reveal`): each row
   * first shows the line as the statement printed it, and a reading
   * line moves down decoding them one by one into date, merchant,
   * type, category and amount. Paced to finish in about 7 seconds
   * whatever the length (slower for a short statement, never under
   * 120 ms a row), with a Skip. Reopening a statement later doesn't
   * replay it, and "reduce motion" skips it entirely. `revealed` runs
   * one past the last row so the last merchant's decode can finish.
   */
  const reduceMotion = useReducedMotion();
  const [revealed, setRevealed] = useState(reveal && !reduceMotion ? 0 : Infinity);
  const rowCount = data?.rows.length ?? 0;
  const revealing = data != null && revealed <= rowCount;
  // A statement for an unknown account waits under the account card; the reading starts once it's confirmed.
  const waitingForAccount = data?.batch.status === 'NEEDS_ACCOUNT';
  const readingRef = useRef(null);
  useEffect(() => {
    if (!revealing || waitingForAccount) return undefined;
    const step = Math.max(120, Math.min(700, 7000 / Math.max(rowCount, 1)));
    const delay = revealed === 0 ? 900 : revealed === rowCount ? 1000 : step;
    const t = setTimeout(() => setRevealed((n) => n + 1), delay);
    return () => clearTimeout(t);
  }, [revealing, waitingForAccount, revealed, rowCount]);
  useEffect(() => {
    readingRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [revealed]);

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
          const next = new Set(prev);
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
    if (!window.confirm('Approve this as its own transaction, separate from the one it matches? Only do this if you\'re sure it\'s not a re-import of the same purchase.')) {
      return;
    }
    setError(null);
    try {
      await api.imports.approveAnyway(batchId, row.id);
      if (conflictId === row.id) setConflictId(null);
      await load();
      checkNewMerchantIcons([row]);
      onApproved();
    } catch (err) {
      setError(err.message);
    }
  };

  const categoryOptions = [blankChoice('—'), ...categoryChoices(categories, { by: 'name' })];
  // Editing an approved row goes through the real transaction's
  // category_id (a foreign key), not the staged row's name-based
  // suggestion — same shape Transactions.jsx already uses.
  const categoryOptionsById = [blankChoice('—'), ...categoryChoices(categories)];

  const needsAccount = data.batch.status === 'NEEDS_ACCOUNT';

  return (
    <div className="mt-4">
      {needsAccount && (
        <AccountCard
          batch={data.batch}
          accounts={accounts}
          people={people}
          onConfirmed={load}
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
        {!revealing && rowCount > 0 && (
          <div className="mb-2 flex justify-end">
            <button
              onClick={() => { setOpenDetail(null); setRevealed(0); }}
              className="flex items-center gap-1.5 text-xs text-muted underline-offset-4 hover:text-ink hover:underline"
            >
              <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.5v9l7.5-4.5z" fill="currentColor" /></svg>
              Replay the reading
            </button>
          </div>
        )}
        {revealing && waitingForAccount ? null : revealing ? (
          <p className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-rule bg-band/40 px-3 py-2 text-sm text-muted">
            <span>
              {revealed < rowCount ? (
                <>Reading line <span className="tnum text-ink">{revealed + 1}</span> of <span className="tnum">{rowCount}</span>…</>
              ) : (
                'Checking the total…'
              )}
            </span>
            <button onClick={() => setRevealed(Infinity)} className="text-muted underline-offset-4 hover:text-ink hover:underline">
              Skip
            </button>
          </p>
        ) : (
          <motion.div initial={reveal && !reduceMotion ? { opacity: 0, y: -6 } : false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <TallyBanner
              tally={data.tally}
              batchId={batchId}
              canRecover={data.batch.file_type === 'PDF'}
              onQueued={(n) => { notify(`${n} missing row${n === 1 ? '' : 's'} added below for review`, { type: 'success' }); load(); }}
              onBalances={() => { notify('Balances updated to what the statement prints', { type: 'success' }); load(); invalidate('transactions'); }}
            />
          </motion.div>
        )}
        <fieldset disabled={needsAccount} className="contents">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[46rem] table-fixed border-collapse text-sm">
          <thead>
            <tr className="table-head border-y border-rule bg-band text-left text-xs text-muted">
              <th className="sticky top-0 w-10 bg-band py-2 pl-3 font-normal"><span className="sr-only">Selected</span></th>
              <th className="sticky top-0 w-20 bg-band py-2 pr-3 font-normal">Date</th>
              <th className="sticky top-0 bg-band py-2 pr-4 font-normal">Merchant</th>
              <th className="sticky top-0 w-32 bg-band py-2 pr-3 font-normal">Type</th>
              <th className="sticky top-0 w-40 bg-band py-2 pr-3 font-normal">Category</th>
              <th className="sticky top-0 w-28 bg-band py-2 pr-4 text-right font-normal">Amount</th>
              <th className="sticky top-0 w-28 bg-band py-2 pr-3 text-right font-normal"><span className="sr-only">Edit or review</span></th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, i) => {
              // Not reached by the reading line yet: the line as the statement printed it.
              if (revealing && i >= revealed) {
                const reading = i === revealed;
                return (
                  <tr key={row.id} ref={reading ? readingRef : null} className={`border-b border-rule transition-colors duration-300 ${reading ? 'bg-earn/10' : ''}`}>
                    <td colSpan={7} className={`h-12 truncate border-l-2 py-2 pl-3 font-mono text-xs whitespace-pre transition-colors duration-300 ${reading ? 'border-l-earn text-ink' : 'border-l-transparent text-faint'}`}>
                      {row.raw_text ?? row.description}
                    </td>
                  </tr>
                );
              }

              const isDuplicate = row.duplicate_of_id != null;
              const isPending = row.review_status === 'PENDING';
              const isConflict = row.id === conflictId;
              const reasons = isPending ? reviewReasons(row, isConflict) : [];
              const detailOpen = openDetail === row.id;
              // Cells of a row that just decoded settle in; afterwards nothing moves.
              const settle = (delay) => ({
                initial: revealing ? { opacity: 0, x: 8 } : false,
                animate: { opacity: 1, x: 0 },
                transition: { delay, duration: 0.5, ease: [0.16, 1, 0.3, 1] },
              });
              return [
                <tr
                  key={row.id}
                  className={`border-b border-rule transition-colors hover:bg-band/50
                    ${isDuplicate ? 'border-l-2 border-l-spend' : ''}
                    ${isConflict ? 'bg-spend/10' : ''}
                    ${detailOpen ? 'bg-band/50' : ''}`}
                >
                  <td className="h-12 py-2 pl-3 align-middle">
                    {isPending ? (
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
                  <td className="py-2 pr-3 align-middle font-mono text-muted tnum whitespace-nowrap" title={row.posted_date ?? undefined}>
                    {row.posted_date ? formatShortDate(row.posted_date) : <span className="text-warn">no date</span>}
                  </td>
                  <td className="py-2 pr-4 align-middle">
                    <div className="flex items-center gap-2" title={row.description ?? undefined}>
                      <motion.div
                        initial={revealing ? { scale: 0, rotate: -20 } : false}
                        animate={{ scale: 1, rotate: 0 }}
                        transition={{ type: 'spring', stiffness: 180, damping: 14 }}
                      >
                        <MerchantAvatar
                          merchant={row.merchant}
                          description={row.description}
                          txnType={row.txn_type}
                          amountCents={row.amount_cents}
                          categoryName={row.category_name ?? row.suggested_category}
                          categoryIconKey={row.category_icon_key ?? categoryIconByName.get(row.suggested_category)}
                          size={26}
                        />
                      </motion.div>
                      <div className="min-w-0 flex-1 text-ink">
                        {revealing ? (
                          <span className="block truncate"><Decode text={txnName(row) ?? row.description ?? '—'} /></span>
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
                          <span className="block truncate">{txnName(row) ?? row.description ?? '—'}</span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="py-2 pr-3 align-middle">
                    <motion.div {...settle(0.15)}>
                      {isPending ? (
                        <TypeSelect value={row.txn_type} onChange={(type) => setType(row, type)} />
                      ) : row.transaction_id ? (
                        <TypeSelect value={row.txn_type} onChange={(type) => setApprovedType(row, type)} />
                      ) : (
                        <TypeBadge type={row.txn_type} />
                      )}
                    </motion.div>
                  </td>
                  <td className="py-2 pr-3 align-middle">
                    <motion.div {...settle(0.3)}>
                      {isPending ? (
                        <QuietSelect
                          value={row.suggested_category ?? ''}
                          onChange={(name) => setCategory(row, name)}
                          options={categoryOptions}
                          className="text-sm text-ink"
                        />
                      ) : row.transaction_id ? (
                        <QuietSelect
                          value={row.category_id != null ? String(row.category_id) : ''}
                          onChange={(value) => setApprovedCategory(row, value)}
                          options={categoryOptionsById}
                          className="text-sm text-ink"
                        />
                      ) : (
                        <span>{row.category_name ?? row.suggested_category ?? '—'}</span>
                      )}
                    </motion.div>
                  </td>
                  <td className="py-2 pr-4 text-right align-middle whitespace-nowrap">
                    <motion.div {...settle(0.45)}>
                      <Amount cents={row.amount_cents} />
                    </motion.div>
                  </td>
                  <td className="py-2 pr-3 text-right align-middle">
                    {/* Read cleanly → Edit, lit in pine. Couldn't be → ! Review, in amber (red for a duplicate). */}
                    <motion.button
                      {...settle(0.6)}
                      onClick={() => setOpenDetail(detailOpen ? null : row.id)}
                      aria-expanded={detailOpen}
                      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                        reasons.length === 0
                          ? 'border-earn/30 bg-earn/10 text-earn hover:bg-earn/20'
                          : isDuplicate || isConflict
                            ? 'border-spend/40 bg-spend/10 text-spend hover:bg-spend/20'
                            : 'border-warn/40 bg-warn/10 text-warn hover:bg-warn/20'
                      }`}
                    >
                      {reasons.length === 0 ? 'Edit' : <><span aria-hidden="true">!</span> Review</>}
                    </motion.button>
                  </td>
                </tr>,
                detailOpen && (
                  <tr key={`${row.id}-detail`} className="border-b border-rule">
                    <td />
                    <td colSpan={6} className="pt-1 pr-2 pb-3">
                      <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.25 }}
                        className="rounded-lg border border-rule bg-band/40 px-3 py-2.5 text-sm"
                      >
                        {reasons.length > 0 && (
                          <ul className="mb-2 space-y-0.5 text-ink">
                            {reasons.map((r) => <li key={r}>{r}</li>)}
                          </ul>
                        )}
                        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                          <div className="min-w-0">
                            <div className="text-xs text-muted">On the statement</div>
                            <div className="mt-0.5 overflow-x-auto font-mono text-xs whitespace-pre text-ink">
                              {row.raw_text ?? row.description ?? '—'}
                            </div>
                          </div>
                          {(isPending || row.transaction_id) && (
                            <div className="min-w-48">
                              <div className="text-xs text-muted">Merchant name</div>
                              <EditableText
                                value={row.merchant}
                                placeholder={row.description ?? '—'}
                                onSave={(name) => (isPending ? setMerchant(row, name) : setApprovedMerchant(row, name))}
                                className="mt-0.5 block w-full truncate text-ink"
                              />
                            </div>
                          )}
                        </div>
                        {isPending && reasons.length > 0 && (
                          <div className="mt-2.5 flex flex-wrap gap-3">
                            {isDuplicate ? (
                              <button onClick={() => approveAnyway(row)} className="text-xs text-spend underline-offset-4 hover:underline">
                                Not a duplicate, approve anyway
                              </button>
                            ) : (
                              <button
                                onClick={() => {
                                  setSelected((prev) => new Set(prev).add(row.id));
                                  setOpenDetail(null);
                                }}
                                className="text-xs text-earn underline-offset-4 hover:underline"
                              >
                                Looks right, select it
                              </button>
                            )}
                          </div>
                        )}
                      </motion.div>
                    </td>
                  </tr>
                ),
              ];
            })}
          </tbody>
        </table>
        </div>
        </fieldset>

        {error && <p className="mt-3 text-sm text-spend">{error}</p>}

        {pending.length > 0 && (
          <div className="mt-4 flex items-center gap-2">
            <Button
              onClick={() => approve({ staged_ids: [...selected] })}
              disabled={busy || needsAccount || selected.size === 0}
            >
              {busy ? 'Approving…' : `Approve selected (${selected.size})`}
            </Button>
            <Button variant="quiet" onClick={() => approve({ all: true })} disabled={busy || needsAccount}>
              Approve all
            </Button>
            <span className="ml-2 text-sm text-faint tnum">
              {pending.length} row{pending.length === 1 ? '' : 's'} awaiting review
            </span>
          </div>
        )}
        {pending.length === 0 && !needsAccount && (
          <p className="mt-4 text-sm text-muted">Every row in this import has been reviewed.</p>
        )}
      </div>
    </div>
  );
}
