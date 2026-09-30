import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatMoney, maskName, ACCOUNT_TYPES, TXN_TYPE_LABELS, TXN_TYPE_OPTIONS } from '../api';
import { Button, Select, Field, TextInput, EditableText } from './Form';
import { MerchantAvatar } from './MerchantAvatar';
import { lookupMerchantDomain } from '../merchant-logos';

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
  const [form, setForm] = useState({
    person_id: String(people[0]?.id ?? ''),
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
  // a person's name has more than one word in it.
  useEffect(() => {
    if (!batch.detected_holder) return;
    const holder = batch.detected_holder.toLowerCase();
    const match = people.find((p) => holder.includes(p.name.split(' ')[0].toLowerCase()));
    if (match) setForm((f) => ({ ...f, person_id: String(match.id) }));
  }, [batch.detected_holder, people]);

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
                      options={accounts.map((a) => ({
                        value: String(a.id),
                        label: a.mask ? `${a.name} ···${a.mask}` : a.name,
                      }))}
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
                options={people.map((p) => ({ value: String(p.id), label: maskName(p.name) }))}
              />
            </Field>
            <Field label="Type">
              <Select value={form.account_type} onChange={set('account_type')} options={ACCOUNT_TYPES} />
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
 * A row can be flagged for up to three independent reasons at once
 * (duplicate, a live approve-time conflict, low parse confidence).
 * Previously each got its own text line under the merchant name, which
 * made a flagged row two or three lines taller than a clean one. One
 * small indicator with all applicable reasons in its tooltip keeps
 * every row the same height; the reasons aren't gone, just not always
 * on screen.
 */
function RowFlag({ isConflict, isDuplicate, duplicateDate, confidence, rawText }) {
  const reasons = [];
  if (isConflict) reasons.push("Already exists as a transaction — won't be re-approved");
  else if (isDuplicate) reasons.push(`May duplicate a transaction from ${duplicateDate}`);
  if (confidence === 'LOW') {
    reasons.push(rawText ? `Parsed with low confidence: "${rawText}"` : 'Parsed with low confidence — check this one');
  }
  if (reasons.length === 0) return null;

  const severe = isConflict || isDuplicate;
  return (
    <span
      title={reasons.join(' · ')}
      className={`ml-1.5 inline-flex size-4 shrink-0 cursor-help items-center justify-center rounded-full align-middle text-[10px] font-bold leading-none ${
        severe ? 'bg-spend/15 text-spend' : 'bg-warn/15 text-warn'
      }`}
    >
      !
    </span>
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
function TypeSelect({ value, onChange }) {
  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      className="cursor-pointer appearance-none rounded-md border border-transparent bg-transparent
                 py-0.5 pr-1 text-xs text-muted transition-colors hover:border-rule hover:bg-raised
                 hover:px-1.5 focus:border-earn focus:bg-raised focus:px-1.5 focus:outline-none"
    >
      <option value="">—</option>
      {TXN_TYPE_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export function Review({ batchId, categories, accounts, people, onApproved }) {
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [error, setError] = useState(null);
  const [conflictId, setConflictId] = useState(null); // staged row id a duplicate-conflict error named
  const [busy, setBusy] = useState(false);
  const [iconGap, setIconGap] = useState([]); // merchant names just approved that have no icon at all

  const load = useCallback(async () => {
    try {
      const result = await api.imports.staged(batchId);
      setData(result);
      // Pre-check only the rows a human wouldn't need to squint at.
      setSelected(
        new Set(
          result.rows
            .filter(
              (r) =>
                r.review_status === 'PENDING' &&
                r.confidence !== 'LOW' &&
                r.duplicate_of_id == null
            )
            .map((r) => r.id)
        )
      );
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, [batchId]);

  useEffect(() => { load(); }, [load]);

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
      await api.imports.approve(batchId, body);
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

  const categoryOptions = [
    { value: '', label: '—' },
    ...categories.map((c) => ({ value: c.name, label: c.name })),
  ];
  // Editing an approved row goes through the real transaction's
  // category_id (a foreign key), not the staged row's name-based
  // suggestion — same shape Transactions.jsx already uses.
  const categoryOptionsById = [
    { value: '', label: '—' },
    ...categories.map((c) => ({ value: String(c.id), label: c.name })),
  ];

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
        <fieldset disabled={needsAccount} className="contents">
        <div className="overflow-x-auto">
        <table className="w-full table-fixed border-collapse text-sm">
          <thead>
            <tr className="border-b border-rule-str bg-raised text-left text-muted">
              <th className="sticky top-0 w-8 bg-raised py-2.5 pr-2 pl-2 font-normal"></th>
              <th className="sticky top-0 w-24 bg-raised py-2.5 pr-4 font-normal">Date</th>
              <th className="sticky top-0 bg-raised py-2.5 pr-4 font-normal">Merchant</th>
              <th className="sticky top-0 w-32 bg-raised py-2.5 pr-4 font-normal">Type</th>
              <th className="sticky top-0 w-36 bg-raised py-2.5 pr-4 font-normal">Category</th>
              <th className="sticky top-0 w-28 bg-raised py-2.5 text-right font-normal">Amount</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => {
              const isDuplicate = row.duplicate_of_id != null;
              const isPending = row.review_status === 'PENDING';
              const isConflict = row.id === conflictId;
              return (
                <tr
                  key={row.id}
                  className={`border-b border-rule odd:bg-band/50
                    ${isDuplicate ? 'border-l-2 border-l-spend' : ''}
                    ${isConflict ? 'bg-spend/10' : ''}
                    ${!isPending ? 'text-faint' : ''}`}
                >
                  <td className="py-2.5 pr-2 pl-2 align-top">
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
                  <td className="py-2.5 pr-4 align-top font-mono tnum whitespace-nowrap">
                    {row.posted_date ?? <span className="text-warn">no date</span>}
                  </td>
                  <td className="py-2.5 pr-4 align-top">
                    <div className="flex items-start gap-2">
                      <MerchantAvatar
                        merchant={row.merchant}
                        description={row.description}
                        txnType={row.txn_type}
                        amountCents={row.amount_cents}
                        categoryName={row.category_name ?? row.suggested_category}
                        categoryIconKey={row.category_icon_key ?? categoryIconByName.get(row.suggested_category)}
                        size={26}
                      />
                      <div className="min-w-0 flex-1">
                        <div className={`flex items-center gap-1.5 ${isPending ? 'text-ink' : ''}`}>
                          <div className="min-w-0 flex-1">
                            {isPending ? (
                              <EditableText
                                value={row.merchant}
                                placeholder={row.description ?? '—'}
                                onSave={(name) => setMerchant(row, name)}
                                className="block w-full truncate"
                              />
                            ) : row.transaction_id ? (
                              <EditableText
                                value={row.merchant}
                                placeholder={row.description ?? '—'}
                                onSave={(name) => setApprovedMerchant(row, name)}
                                className="block w-full truncate"
                              />
                            ) : (
                              <span className="block truncate">{row.merchant ?? row.description ?? '—'}</span>
                            )}
                          </div>
                          <RowFlag
                            isConflict={isConflict}
                            isDuplicate={isDuplicate}
                            duplicateDate={row.duplicate_posted_date}
                            confidence={row.confidence}
                            rawText={row.raw_text}
                          />
                        </div>
                        {/* Only worth a second line when it says something the
                            main line doesn't — a real merchant name already
                            covers the raw description as EditableText's own
                            placeholder when there's no merchant yet. */}
                        {row.merchant && (
                          <div className="mt-0.5 truncate text-xs text-faint" title={row.description}>
                            {row.description}
                          </div>
                        )}
                        {isPending && isDuplicate && (
                          <button
                            onClick={() => approveAnyway(row)}
                            className="mt-0.5 text-xs text-spend underline-offset-4 hover:underline"
                          >
                            Not a duplicate — approve anyway
                          </button>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="py-2.5 pr-4 align-top">
                    {isPending ? (
                      <TypeSelect value={row.txn_type} onChange={(type) => setType(row, type)} />
                    ) : row.transaction_id ? (
                      <TypeSelect value={row.txn_type} onChange={(type) => setApprovedType(row, type)} />
                    ) : (
                      <TypeBadge type={row.txn_type} />
                    )}
                  </td>
                  <td className="py-2.5 pr-4 align-top">
                    {isPending ? (
                      <Select
                        value={row.suggested_category ?? ''}
                        onChange={(e) => setCategory(row, e.target.value)}
                        options={categoryOptions}
                      />
                    ) : row.transaction_id ? (
                      <Select
                        value={row.category_id != null ? String(row.category_id) : ''}
                        onChange={(e) => setApprovedCategory(row, e.target.value)}
                        options={categoryOptionsById}
                      />
                    ) : (
                      <span>{row.category_name ?? row.suggested_category ?? '—'}</span>
                    )}
                  </td>
                  <td className="py-2.5 text-right align-top whitespace-nowrap">
                    <Amount cents={row.amount_cents} />
                  </td>
                </tr>
              );
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
