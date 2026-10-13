import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { api, formatMoney, formatShortDate, TXN_TYPE_LABELS } from '../../api';
import { invalidate } from '../../use-api';
import { useNotify } from '../../use-notify';
import { txnName } from '../../txn-name';
import { GROUPS, TIERS } from '../../review-groups';
import { entriesFrom, preselect, activeFinding, siblingsOf, approvalsFor, bulkApprovals } from '../../review-entries';
import { TXN_TYPE_CHOICES, categoryChoices } from '../../dropdown-choices';
import { ACTIVITY_GLYPHS } from '../../glass-activity-glyphs';
import { MerchantAvatar } from '../MerchantAvatar';
import { EditableText } from '../Form';
import { Dropdown } from '../ui/Dropdown';
import { GroupSection, Group, Tile, GlassToolbar } from '../settings/glass-ui';

/**
 * Glass Review (D249). A Mail-style split view: the rows to fix on the
 * left, one transaction on the right with everything needed to fix it.
 * One entry per transaction (its type and category together), likely
 * answers as chips with the reason under them, the merchant name editable
 * in place, the same fix offered for the same merchant's other rows, and
 * Undo on every save. Keyboard: ↑↓ move, 1–4 pick, ⏎ save and go on,
 * K keep as is, X select for a bulk fix.
 */

const TABS = [
  { value: 'findings', label: 'To fix', icon: 'checkmark-done', color: '#34C759' },
  { value: 'statements', label: 'Statements', icon: 'document-text', color: '#007AFF' },
  { value: 'payments', label: 'Payments', icon: 'card', color: '#FF9500' },
  { value: 'merchants', label: 'Merchants', icon: 'pricetag', color: '#FF2D55' },
];
const FIELD_LABEL = { txn_type: 'Type', category: 'Category', amount: 'Amount' };
const TIER_TITLE = Object.fromEntries(TIERS.map((t) => [t.key, t.title]));

function GlyphTile({ icon, color, size = 28, spin = 0 }) {
  return (
    <Tile color={color} size={size}>
      <motion.svg width={Math.round(size * 0.6)} height={Math.round(size * 0.6)} viewBox="0 0 512 512"
        animate={{ rotate: spin * 360 }} transition={{ type: 'spring', bounce: 0, duration: 0.7 }}>
        {ACTIVITY_GLYPHS[icon]}
      </motion.svg>
    </Tile>
  );
}

const valueText = (field, v) => (v == null ? 'None' : field === 'txn_type' ? TXN_TYPE_LABELS[v] ?? v : field === 'amount' ? formatMoney(Number(v), { showSign: true }) : v);
const enterSaves = (el) => !el || el.tagName !== 'BUTTON' || el.getAttribute('role') === 'radio' || Boolean(el.closest('[data-entry]'));
const isTyping = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable || el.getAttribute('role') === 'combobox' || el.closest('[role="listbox"]'));

/* ---------------------------- the list ---------------------------- */

function EntryRow({ entry, active, checked, anyChecked, onOpen, onCheck }) {
  const name = txnName(entry) ?? entry.description;
  return (
    <li className="gs-row" data-entry={entry.id}>
      <div className={`group relative flex items-center gap-3 px-3 py-2.5 transition-colors ${active ? 'bg-[var(--g-selected)]' : 'gs-row-action'}`}>
        <button
          type="button"
          role="checkbox"
          aria-checked={checked}
          aria-label={`Select ${name}`}
          onClick={onCheck}
          className={`flex size-5 shrink-0 items-center justify-center rounded-full border transition-opacity ${
            checked ? 'border-info bg-info text-white' : 'border-rule-str'
          } ${anyChecked || checked ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'}`}
        >
          {checked && <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.5 5 9l4.5-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
        </button>
        <button type="button" onClick={onOpen} aria-current={active ? 'true' : undefined} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <MerchantAvatar
            merchant={entry.merchant} description={entry.description} txnType={entry.txn_type} amountCents={entry.amount_cents}
            categoryName={entry.category_name} categoryIconKey={entry.category_icon_key} size={32} clickable={false}
          />
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[15px] text-ink">{name}</span>
              <span className={`shrink-0 text-[14px] tnum ${entry.amount_cents < 0 ? 'text-ink' : 'text-earn'}`}>{formatMoney(entry.amount_cents, { showSign: true })}</span>
            </span>
            <span className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted">
              <span className="shrink-0 tnum">{formatShortDate(entry.posted_date)}</span>
              <span className="truncate">· {entry.account_name}</span>
            </span>
            <span className="mt-1 flex flex-wrap gap-1">
              {entry.findings.map((f) => (
                <span key={f.id} className={`rounded-full px-1.5 py-px text-[11px] font-medium ${
                  entry.tier === 'tidy' ? 'bg-band text-muted' : 'bg-spend/10 text-spend'
                }`}>
                  {f.current_value == null ? `No ${FIELD_LABEL[f.field].toLowerCase()}` : FIELD_LABEL[f.field]}
                </span>
              ))}
            </span>
          </span>
        </button>
      </div>
    </li>
  );
}

/* --------------------------- the inspector --------------------------- */

/** One field's choices: the likely answers as chips, the reason under the picked one, and every other value. */
function FieldPicker({ finding, value, onPick, keysActive, categories }) {
  const options = finding.options ?? [];
  const all = finding.field === 'txn_type' ? TXN_TYPE_CHOICES : categoryChoices(categories, { by: 'name' });
  const picked = options.find((o) => o.value === value);
  const label = (v) => valueText(finding.field, v);
  const meta = GROUPS[finding.check_kind];

  if (finding.field === 'amount') {
    return (
      <div className="flex flex-wrap items-center gap-2 text-[15px]">
        <span className="rounded-full bg-spend/10 px-2.5 py-1 text-spend line-through decoration-spend/40 tnum">{label(finding.current_value)}</span>
        <svg width="14" height="10" viewBox="0 0 14 10" aria-label="becomes" className="text-faint"><path d="M1 5h11M8 1.5 12 5 8 8.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        <span className="rounded-full bg-earn/10 px-2.5 py-1 font-semibold text-earn tnum">{label(finding.suggested_value)}</span>
      </div>
    );
  }

  return (
    <div>
      <div role="radiogroup" aria-label={FIELD_LABEL[finding.field]} className="flex flex-wrap gap-2">
        {options.map((o, i) => {
          const on = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              title={o.why}
              onClick={() => onPick(o.value)}
              className={`flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[14px] transition-colors ${
                on ? 'border-info bg-info text-white shadow-sm' : 'border-[var(--g-hairline)] bg-[var(--g-solid)] text-ink hover:bg-[var(--g-solid-hover)]'
              }`}
            >
              {keysActive && <kbd className={`text-[11px] tnum ${on ? 'text-white/75' : 'text-faint'}`}>{i + 1}</kbd>}
              {label(o.value)}
            </button>
          );
        })}
        <Dropdown
          value={options.some((o) => o.value === value) ? '' : value ?? ''}
          onChange={(v) => v && onPick(v)}
          options={all}
          placeholder={options.length ? 'Other…' : 'Pick one…'}
          recentKey={finding.field === 'category' ? 'category' : undefined}
          aria-label={`Other ${FIELD_LABEL[finding.field].toLowerCase()}`}
          className={`!inline-flex !w-auto !min-w-0 !rounded-full !px-3.5 !py-1.5 text-[14px] ${
            value && !options.some((o) => o.value === value) ? '!border-info !bg-info !text-white' : '!border-[var(--g-hairline)] !bg-[var(--g-solid)]'
          }`}
        />
      </div>
      <p className="mt-2 min-h-[1.25rem] text-[13px] text-muted">
        {picked ? picked.why : value ? 'Your pick' : meta?.found ?? ''}
      </p>
    </div>
  );
}

function Inspector({ entry, entries, categories, onSaved, onRename, busy }) {
  const [choices, setChoices] = useState(() => Object.fromEntries(entry.findings.map((f) => [f.id, preselect(f)])));
  const [touched, setTouched] = useState(new Set());
  const siblings = useMemo(() => siblingsOf(entry, entries), [entry, entries]);
  const [withSiblings, setWithSiblings] = useState(true);
  const active = activeFinding(entry.findings, touched);
  const ready = entry.findings.every((f) => choices[f.id]);
  const name = txnName(entry) ?? entry.description;
  const meta = GROUPS[entry.findings[0]?.check_kind];

  const pick = (f, v) => {
    setChoices((c) => ({ ...c, [f.id]: v }));
    setTouched((t) => new Set(t).add(f.id));
  };

  const save = useCallback(() => {
    if (!ready || busy) return;
    onSaved({ approve: approvalsFor(entry, choices, withSiblings ? siblings : []) }, entry);
  }, [ready, busy, entry, choices, withSiblings, siblings, onSaved]);
  const keep = useCallback(() => !busy && onSaved({ dismiss: entry.findings.map((f) => f.id) }, entry), [busy, entry, onSaved]);

  // 1–4 pick for the active field, ⏎ saves, K keeps as is.
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(document.activeElement)) return;
      const n = Number(e.key);
      if (n >= 1 && n <= 4 && active?.options?.[n - 1]) { e.preventDefault(); pick(active, active.options[n - 1].value); }
      // ⏎ saves, except on Keep as is / Save themselves, whose own click is the action.
      // After clicking a list row or a chip, focus sits on that button; ⏎ still saves there.
      else if (e.key === 'Enter' && enterSaves(document.activeElement)) { e.preventDefault(); save(); }
      else if (e.key.toLowerCase() === 'k') { e.preventDefault(); keep(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, save, keep]);

  return (
    <div className="gs-group p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <MerchantAvatar
          merchant={entry.merchant} description={entry.description} txnType={entry.txn_type} amountCents={entry.amount_cents}
          categoryName={entry.category_name} categoryIconKey={entry.category_icon_key} size={52} clickable={false}
        />
        <div className="min-w-0 flex-1">
          <EditableText value={txnName(entry)} placeholder={entry.description} onSave={(v) => onRename(entry, v)}
            className="block max-w-full truncate text-[22px] leading-tight font-bold tracking-[-0.02em] text-ink" />
          <p className="mt-1 text-[13px] text-muted">
            <span className="tnum">{formatShortDate(entry.posted_date)}</span> · {entry.account_name}
            {entry.account_mask && <span className="tnum"> ··{entry.account_mask}</span>}
          </p>
        </div>
        <span className={`shrink-0 text-[24px] font-semibold tracking-[-0.02em] tnum ${entry.amount_cents < 0 ? 'text-ink' : 'text-earn'}`}>
          {formatMoney(entry.amount_cents, { showSign: true })}
        </span>
      </div>
      <p className="mt-3 overflow-x-auto rounded-[10px] bg-band px-3 py-2 font-mono text-[12px] whitespace-pre text-muted" title="As the statement printed it">
        {entry.description}
      </p>

      <div className="mt-6 space-y-6">
        {entry.findings.map((f) => (
          <section key={f.id}>
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h4 className="text-[13px] font-semibold text-ink">
                {FIELD_LABEL[f.field]}
                <span className="font-normal text-muted"> · {f.current_value == null ? 'not set' : `now ${valueText(f.field, f.current_value)}`}</span>
              </h4>
              {active?.id === f.id && entry.findings.length > 1 && <span className="text-[11px] text-faint">keys 1–4 pick here</span>}
            </div>
            <FieldPicker finding={f} value={choices[f.id]} onPick={(v) => pick(f, v)} keysActive={active?.id === f.id} categories={categories} />
          </section>
        ))}
      </div>

      {meta?.why && entry.tier !== 'tidy' && (
        <p className="mt-5 text-[13px] text-muted"><span className="font-medium text-ink">Why it matters: </span>{meta.why}</p>
      )}

      {siblings.length > 0 && (
        <label className="mt-5 flex cursor-pointer items-center gap-3 rounded-[12px] bg-band px-3.5 py-2.5 text-[14px] text-ink">
          <input type="checkbox" checked={withSiblings} onChange={(e) => setWithSiblings(e.target.checked)} className="size-4 accent-[var(--color-info)]" />
          <span>Also fix the other <span className="tnum">{siblings.length}</span> {siblings.length === 1 ? 'row' : 'rows'} from {name}</span>
        </label>
      )}

      <div className="mt-6 flex items-center justify-between gap-3">
        <button type="button" onClick={keep} disabled={busy} className="btn btn-quiet rounded-full border px-4 py-2 text-[14px] disabled:opacity-40">
          Keep as is <kbd className="ml-1 text-[11px] text-faint">K</kbd>
        </button>
        <button type="button" onClick={save} disabled={!ready || busy} className="btn btn-primary rounded-full px-5 py-2 text-[15px] disabled:cursor-not-allowed">
          {busy ? 'Saving…' : siblings.length && withSiblings ? `Save ${1 + siblings.length} & next` : 'Save & next'} <kbd className="ml-1 text-[12px] opacity-70">⏎</kbd>
        </button>
      </div>
    </div>
  );
}

/** Several rows at once: one type, one category, for every selected row that's missing it. */
function BulkInspector({ entries, categories, onSaved, onClear, busy }) {
  const byField = (field) => entries.flatMap((e) => e.findings.filter((f) => f.field === field));
  const fields = ['txn_type', 'category'].filter((f) => byField(f).length > 0);
  const [choice, setChoice] = useState({});
  const total = entries.reduce((n, e) => n + e.amount_cents, 0);

  // The chips: options the selected rows share most.
  const chipsFor = (field) => {
    const counts = new Map();
    for (const f of byField(field)) for (const o of f.options ?? []) counts.set(o.value, (counts.get(o.value) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([value, n]) => ({ value, why: `Offered for ${n} of these` }));
  };
  const plans = Object.fromEntries(fields.map((field) => [field, bulkApprovals(entries, field, choice[field])]));
  const approve = fields.flatMap((field) => plans[field].approve);

  return (
    <div className="gs-group p-5 sm:p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[22px] font-bold tracking-[-0.02em] text-ink"><span className="tnum">{entries.length}</span> rows selected</h3>
        <span className="text-[15px] text-muted tnum">{formatMoney(total, { showSign: true })}</span>
      </div>
      <p className="mt-1 text-[13px] text-muted">Pick a value and it goes on every selected row that's missing it. Rows that already have one are left alone.</p>
      <div className="mt-6 space-y-6">
        {fields.map((field) => (
          <section key={field}>
            <h4 className="mb-2 text-[13px] font-semibold text-ink">{FIELD_LABEL[field]} <span className="font-normal text-muted">· for {byField(field).length}</span></h4>
            <FieldPicker
              finding={{ id: field, field, options: chipsFor(field), check_kind: null }}
              value={choice[field]}
              onPick={(v) => setChoice((c) => ({ ...c, [field]: v }))}
              keysActive={false}
              categories={categories}
            />
            {plans[field].skipped > 0 && (
              <p className="-mt-1 text-[13px] text-warn">
                Left alone on <span className="tnum">{plans[field].skipped}</span> {plans[field].skipped === 1 ? 'row' : 'rows'} where it doesn't fit the money's direction.
              </p>
            )}
          </section>
        ))}
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <button type="button" onClick={onClear} className="btn btn-quiet rounded-full border px-4 py-2 text-[14px]">Clear selection</button>
          <button type="button" disabled={busy} onClick={() => onSaved({ dismiss: entries.flatMap((e) => e.findings.map((f) => f.id)) })} className="btn btn-quiet rounded-full border px-4 py-2 text-[14px] disabled:opacity-40">
            Keep all as is
          </button>
        </div>
        <button type="button" disabled={busy || approve.length === 0} onClick={() => onSaved({ approve })} className="btn btn-primary rounded-full px-5 py-2 text-[15px] disabled:cursor-not-allowed">
          {busy ? 'Saving…' : `Save ${approve.length} ${approve.length === 1 ? 'fix' : 'fixes'}`}
        </button>
      </div>
    </div>
  );
}

/* ----------------------------- the page ----------------------------- */

export function GlassReview({ categories, onResolved, tab, setTab, StatementsPane, PaymentsPane, MerchantsPane }) {
  const notify = useNotify();
  const reduceMotion = useReducedMotion();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [checked, setChecked] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(0);
  const listRef = useRef(null);
  const inspectorRef = useRef(null);
  // On a phone, picking a row scrolls up to its fixer.
  const open = (id) => {
    setActiveId(id);
    setChecked(new Set());
    if (window.matchMedia('(max-width: 1023px)').matches) inspectorRef.current?.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
  };

  const load = useCallback(() => api.transactionReview.list().then(setData).catch((err) => setError(err.message)), []);
  useEffect(() => { load(); }, [load]);

  const entries = useMemo(() => entriesFrom(data?.items ?? []), [data]);
  const active = entries.find((e) => e.id === activeId) ?? entries[0] ?? null;
  const selected = entries.filter((e) => checked.has(e.id));
  const paymentsCount = (data?.payments?.filter((p) => p.payment_source.status === 'unverified').length ?? 0) + (data?.card_bills?.length ?? 0);
  const statementsCount = data?.statements?.filter((s) => s.hint?.kind !== 'small').length ?? 0;

  const move = useCallback((step) => {
    if (entries.length === 0) return;
    const i = Math.max(0, entries.findIndex((e) => e.id === active?.id));
    const next = entries[Math.min(entries.length - 1, Math.max(0, i + step))];
    setActiveId(next.id);
    listRef.current?.querySelector(`[data-entry="${next.id}"]`)?.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
  }, [entries, active, reduceMotion]);

  // ↑↓ / J K move, X selects, Esc clears the selection.
  useEffect(() => {
    if (tab !== 'findings') return undefined;
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(document.activeElement)) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'x' && active) { e.preventDefault(); setChecked((c) => { const n = new Set(c); n.has(active.id) ? n.delete(active.id) : n.add(active.id); return n; }); }
      else if (e.key === 'Escape') setChecked(new Set());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tab, move, active]);

  /** Saves a batch, moves on, and offers Undo. */
  const commit = useCallback(async (body, entry) => {
    setBusy(true);
    try {
      const res = await api.transactionReview.batch(body);
      const gone = new Set([...res.approved.map((a) => a.id), ...res.dismissed]);
      // The next row is the one after this one, in the list as it was.
      const idx = entry ? entries.findIndex((e) => e.id === entry.id) : -1;
      const remaining = entries.filter((e) => e.findings.some((f) => !gone.has(f.id)));
      const after = entries.slice(idx + 1).find((e) => remaining.includes(e)) ?? remaining.at(-1) ?? null;
      setData((d) => ({ ...d, items: d.items.filter((i) => !gone.has(i.id)) }));
      setChecked(new Set());
      setActiveId(after?.id ?? null);
      if (res.approved.length) invalidate('transactions');
      onResolved?.();

      const undoItems = [...res.approved.map((a) => ({ id: a.id, value: a.value })), ...res.dismissed.map((id) => ({ id }))];
      const rows = new Set(entries.filter((e) => e.findings.some((f) => gone.has(f.id))).map((e) => e.id)).size;
      const what = entry ? txnName(entry) ?? entry.description : `${rows} rows`;
      notify(res.approved.length ? `${what}${rows > 1 && entry ? ` and ${rows - 1} more` : ''}: saved.` : `${what}: kept as is.`, {
        type: 'success',
        duration: 6000,
        action: {
          label: 'Undo',
          onClick: async () => {
            try {
              await api.transactionReview.undo(undoItems);
              await load();
              if (entry) setActiveId(entry.id);
              invalidate('transactions');
              onResolved?.();
            } catch (err) {
              notify(err.message, { type: 'error', title: "Couldn't undo" });
            }
          },
        },
      });
    } catch (err) {
      notify(err.message, { type: 'error', title: "Couldn't save" });
    } finally {
      setBusy(false);
    }
  }, [entries, notify, onResolved, load]);

  const rename = async (entry, merchant) => {
    try {
      await api.transactions.update(entry.id, { merchant });
      setData((d) => ({ ...d, items: d.items.map((i) => (i.transaction_id === entry.id ? { ...i, merchant } : i)) }));
      invalidate('transactions');
    } catch (err) {
      notify(err.message, { type: 'error', title: "Couldn't rename" });
    }
  };

  const recheck = async () => {
    setRunning((n) => n + 1);
    try {
      const r = await api.transactionReview.run();
      await load();
      onResolved?.();
      notify(`Checked ${r.checked.toLocaleString()} rows. ${r.added ? `${r.added} new to fix.` : 'Nothing new.'}`, { type: 'success' });
    } catch (err) {
      notify(err.message, { type: 'error', title: "Couldn't re-check" });
    }
  };

  const tiers = TIERS.map((t) => ({ ...t, entries: entries.filter((e) => e.tier === t.key) })).filter((t) => t.entries.length);

  return (
    <div className="mx-auto w-full lg:w-4/5">
      <header className="mb-4">
        <h2 className="page-title">Review</h2>
        <p className="mt-1 text-[13px] text-muted">
          Saved rows that look wrong, and statements that don't add up. Nothing changes until you save, and every save can be undone.
        </p>
      </header>

      <GlassToolbar
        className="mb-7"
        label="Review sections"
        groups={[TABS.map((t) => ({
          value: t.value,
          label: t.label,
          badge: t.value === 'findings' ? entries.length : t.value === 'statements' ? statementsCount : t.value === 'payments' ? paymentsCount : 0,
        }))]}
        value={tab}
        onChange={setTab}
        renderIcon={(v) => { const t = TABS.find((x) => x.value === v); return <GlyphTile icon={t.icon} color={t.color} />; }}
        layoutId="gr-tab-selection"
        actions={[{ key: 'recheck', label: 'Re-check', onClick: recheck, icon: <GlyphTile icon="sync" color="#30B0C7" spin={reduceMotion ? 0 : running} /> }]}
      />

      {error && <p className="mb-4 px-4 text-[13px] text-spend">{error}</p>}
      {!data && !error && <p className="px-4 text-[13px] text-muted">Loading…</p>}

      {data && tab === 'findings' && (entries.length === 0 ? (
        <Group as="div" className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <GlyphTile icon="checkmark-done" color="#34C759" size={56} />
          <p className="text-[20px] font-semibold text-ink">All caught up</p>
          <p className="max-w-sm text-[14px] text-muted">Every saved row agrees with today's rules. Re-check after an import, or any time.</p>
        </Group>
      ) : (
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(19rem,25rem)_minmax(0,1fr)]">
          {/* The list scrolls on its own, so the inspector stays in view. */}
          <div ref={listRef} className="space-y-6 lg:sticky lg:top-28 lg:max-h-[calc(100vh-9rem)] lg:overflow-y-auto lg:pr-1">
            {tiers.map((t) => (
              <GroupSection key={t.key} label={`${TIER_TITLE[t.key]} · ${t.entries.length}`}>
                <Group inset={84}>
                  {t.entries.map((e) => (
                      <EntryRow
                        key={e.id}
                        entry={e}
                        active={!selected.length && e.id === active?.id}
                        checked={checked.has(e.id)}
                        anyChecked={checked.size > 0}
                        onOpen={() => open(e.id)}
                        onCheck={() => setChecked((c) => { const n = new Set(c); n.has(e.id) ? n.delete(e.id) : n.add(e.id); return n; })}
                      />
                  ))}
                </Group>
              </GroupSection>
            ))}
          </div>

          {/* Below lg the fixer comes first: on a phone it would sit under the whole list. */}
          <div ref={inspectorRef} className="order-first scroll-mt-4 lg:sticky lg:top-28 lg:order-none">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={selected.length > 1 ? 'bulk' : active?.id}
                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -12 }}
                transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
              >
                {selected.length > 1 ? (
                  <BulkInspector entries={selected} categories={categories} busy={busy} onClear={() => setChecked(new Set())} onSaved={(body) => commit(body, null)} />
                ) : active ? (
                  <Inspector
                    key={active.id}
                    entry={active}
                    entries={entries}
                    categories={categories}
                    busy={busy}
                    onSaved={commit}
                    onRename={rename}
                  />
                ) : null}
              </motion.div>
            </AnimatePresence>
            <p className="mt-3 px-2 text-center text-[12px] text-faint">
              <kbd>↑</kbd> <kbd>↓</kbd> move · <kbd>1</kbd>–<kbd>4</kbd> pick · <kbd>⏎</kbd> save &amp; next · <kbd>K</kbd> keep as is · <kbd>X</kbd> select
            </p>
          </div>
        </div>
      ))}

      {data && tab === 'statements' && <StatementsPane data={data} reload={load} />}
      {data && tab === 'payments' && <PaymentsPane data={data} />}
      {tab === 'merchants' && <MerchantsPane />}
    </div>
  );
}
