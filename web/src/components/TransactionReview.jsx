import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, formatMoney, formatShortDate, TXN_TYPE_LABELS } from '../api';
import { useDesign } from '../use-design';
import { Button, PageTitle, Segmented } from './Form';
import { MerchantAvatar } from './MerchantAvatar';
import { MerchantReview } from './MerchantReview';
import { txnName } from '../txn-name';
import { groupFindings, statementHintText } from '../review-groups';
import { billGroupText, paymentExplanation } from '../payment-source';
import { PaymentMark } from './PaymentMark';
import { invalidate } from '../use-api';
import { TXN_TYPE_CHOICES, categoryChoices } from '../dropdown-choices';
import { Dropdown } from './ui/Dropdown';
import { GlassReview } from './review/GlassReview';
import { GlassStatementsPane, GlassPaymentsPane, GlassMerchantsPane } from './review/GlassReviewPanes';

/**
 * Transactions → Review (D175, redesigned D197). Three queues:
 *   - Rows to check: what the re-check (api/src/recheck.js) found, in
 *     three tiers — fix first (a statement is broken), changes your
 *     totals, labels only — each kind explaining what was seen, why it
 *     matters, when to keep it, and what approving all of it changes.
 *   - Statements: ones whose rows don't add up (D170), each with its
 *     likeliest cause (api/src/statement-hints.js) and, for a wrong
 *     sign, the fix one click away.
 *   - Merchant names: the older merchant-matching queue (D106).
 *
 * Approving writes the transaction, and since every suggestion comes
 * from history, that's also how future imports learn the choice.
 * The words live in review-groups.js; this only lays them out.
 */

const TONE = { spend: 'text-spend', earn: 'text-earn', muted: 'text-muted' };
const VIVID_TIER = { fix: '🛠️ ', totals: '⚖️ ', tidy: '🏷️ ' };
// Kinds whose per-row reason says more than the group's explanation.
const SHOW_REASON = new Set(['type_history', 'category_history', 'type_missing', 'category_missing', 'type_sign', 'type_zelle', 'type_category']);
const PAGE = 8;

const renderParts = (parts) =>
  parts.map((p, i) => (typeof p === 'string' ? p : <span key={i} className="font-mono tnum">{formatMoney(p.cents)}</span>));

const valueLabel = (field, value) =>
  value == null ? '—'
    : field === 'txn_type' ? TXN_TYPE_LABELS[value] ?? value
    : field === 'amount' ? formatMoney(Number(value), { showSign: true })
    : value;
const FIELD_NAME = { txn_type: 'Type', category: 'Category', amount: 'Amount' };

function Finding({ item, categories, busy, fixes, onApprove, onDismiss }) {
  const [choice, setChoice] = useState(item.suggested_value ?? '');
  const options = item.field === 'txn_type' ? TXN_TYPE_CHOICES : categoryChoices(categories, { by: 'name' });

  return (
    <li className="grid gap-3 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
      <div className="flex min-w-0 items-start gap-2.5">
        <MerchantAvatar
          merchant={item.merchant}
          description={item.description}
          txnType={item.txn_type}
          amountCents={item.amount_cents}
          categoryName={item.category_name}
          categoryIconKey={item.category_icon_key}
          size={28}
          clickable={false}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate text-sm text-ink" title={item.description}>{txnName(item) ?? item.description}</span>
            <span className={`shrink-0 font-mono text-sm tnum ${item.amount_cents < 0 ? 'text-spend' : 'text-earn'}`}>
              {formatMoney(item.amount_cents, { showSign: true })}
            </span>
          </div>
          <div className="mt-0.5 truncate text-xs text-muted">
            <span className="font-mono tnum">{formatShortDate(item.posted_date)}</span> · {item.account_name}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted">{FIELD_NAME[item.field]}</span>
            <span className="rounded border border-rule px-1.5 py-0.5 text-muted line-through decoration-faint">
              {valueLabel(item.field, item.current_value)}
            </span>
            <span className="text-faint" aria-hidden>→</span>
            {item.field === 'amount' ? (
              <span className="rounded border border-ink/30 px-1.5 py-0.5 font-mono tnum text-ink">{valueLabel('amount', item.suggested_value)}</span>
            ) : (
              <Dropdown
                value={choice}
                onChange={setChoice}
                options={options}
                recentKey={item.field === 'txn_type' ? undefined : 'category'}
                aria-label={item.field === 'txn_type' ? 'New type' : 'New category'}
                className="min-w-36 !py-1 text-xs"
              />
            )}
          </div>
          {SHOW_REASON.has(item.check_kind) && <div className="mt-1 text-xs text-faint">{item.reason}</div>}
          {fixes && (
            <div className="mt-1 text-xs text-muted">
              Fixes the {fixes.account_name} statement ending <span className="font-mono tnum">{formatShortDate(fixes.period_end)}</span>.
            </div>
          )}
        </div>
      </div>
      <div className="flex shrink-0 gap-2 sm:justify-end">
        <Button variant="quiet" size="sm" disabled={busy} onClick={onDismiss}>
          Keep as is
        </Button>
        <Button size="sm" disabled={busy || !choice} onClick={() => onApprove(choice)}>
          {choice && choice !== item.suggested_value ? 'Save' : 'Approve'}
        </Button>
      </div>
    </li>
  );
}

/** One kind of finding: what it is, why it matters, what approving changes, then its rows. */
function Group({ group, open, onToggle, busyId, onApproveAll, renderItem }) {
  const [shown, setShown] = useState(PAGE);
  const { meta, items, impact } = group;
  const canApproveAll = items.length > 1 && items.every((i) => i.suggested_value);

  return (
    <section className="border-b border-rule last:border-b-0">
      <div className="flex items-start justify-between gap-3 py-3">
        <button onClick={onToggle} aria-expanded={open} className="flex min-w-0 flex-1 items-start gap-2 text-left">
          <span className={`mt-0.5 inline-block w-3 shrink-0 text-xs text-faint transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden>▸</span>
          <span className="min-w-0">
            <span className="block text-sm text-ink">
              {meta.title} <span className="tnum text-faint">· {items.length}</span>
            </span>
            <span className="mt-0.5 block text-xs text-muted">{renderParts(impact)}</span>
          </span>
        </button>
        {canApproveAll && (
          <Button size="sm" variant="quiet" disabled={busyId !== null} onClick={() => onApproveAll(items)}>
            Approve all {items.length}
          </Button>
        )}
      </div>

      {open && (
        <div className="pb-3 pl-5">
          <dl className="grid gap-x-4 gap-y-1 rounded-md bg-band px-3 py-2.5 text-xs sm:grid-cols-[auto_1fr]">
            <dt className="text-muted">What we saw</dt>
            <dd className="text-ink">{meta.found}</dd>
            <dt className="text-muted">Why it matters</dt>
            <dd className="text-ink">{meta.why}</dd>
            {meta.keep && (
              <>
                <dt className="text-muted">Keep as is when</dt>
                <dd className="text-ink">{meta.keep}</dd>
              </>
            )}
          </dl>
          <ul className="divide-y divide-rule">{items.slice(0, shown).map(renderItem)}</ul>
          {items.length > shown && (
            <button onClick={() => setShown(items.length)} className="mt-1 text-xs text-ink underline-offset-4 hover:underline">
              Show all {items.length}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function StatementRow({ s, busy, onFlip }) {
  const hint = statementHintText(s.hint);
  return (
    <li className="grid gap-2 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-3">
          <span className="truncate text-sm text-ink">{s.account_name}</span>
          <span className="shrink-0 text-xs text-muted">
            <span className="font-mono text-sm tnum text-ink">{formatMoney(Math.abs(s.tally.diff_cents))}</span> off
          </span>
        </div>
        <div className="mt-0.5 text-xs text-muted">
          Statement ending <span className="font-mono tnum">{formatShortDate(s.period_end)}</span> · <span className="tnum">{s.row_count}</span> rows
        </div>
        <div className={`mt-1.5 text-xs ${TONE[hint.tone]}`}>{hint.title}</div>
        <div className="mt-0.5 text-xs text-muted">{renderParts(hint.parts)}</div>
      </div>
      {hint.action === 'approve' && (
        <div className="flex sm:justify-end">
          <Button size="sm" disabled={busy} onClick={onFlip}>Flip the sign</Button>
        </div>
      )}
    </li>
  );
}

/**
 * Review → Payments (D199 step 3): card payments not traced to the bank
 * that paid them, and bank card bills no card payment matched. Nothing to
 * approve here: each says which statement to upload, and a re-check runs
 * after every import.
 */
function PaymentRow({ p }) {
  const e = paymentExplanation(p.payment_source, p.posted_date);
  return (
    <li className="py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex min-w-0 items-center gap-1.5 text-sm text-ink">
          <PaymentMark source={p.payment_source} />
          <span className="truncate">{p.account_name}{p.account_mask && <span className="font-mono text-xs tnum text-muted"> ···{p.account_mask}</span>}</span>
        </span>
        <span className="shrink-0 font-mono text-sm tnum text-earn">{formatMoney(p.amount_cents, { showSign: true })}</span>
      </div>
      <div className="mt-0.5 text-xs text-muted"><span className="font-mono tnum">{formatShortDate(p.posted_date)}</span> · {e.title.replace(/^Not verified( yet)?: /, '')}</div>
      {e.lines.map((line) => <p key={line} className="mt-0.5 text-xs text-faint">{line}</p>)}
    </li>
  );
}

function PaymentsTab({ payments: all, cardBills }) {
  const [showAll, setShowAll] = useState(false);
  const [showNamed, setShowNamed] = useState(false);
  const bills = showAll ? cardBills : cardBills.slice(0, 12);
  const payments = all.filter((p) => p.payment_source.status === 'unverified');
  const named = all.filter((p) => p.payment_source.status === 'named');
  if (all.length === 0 && cardBills.length === 0) {
    return <p className="py-8 text-center text-sm text-muted">Every card payment is traced to the bank that paid it.</p>;
  }
  return (
    <div className="space-y-6">
      {payments.length > 0 && (
        <section>
          <div className="mb-1 border-b border-rule-str pb-1.5">
            <h4 className="text-sm font-medium text-ink">Card payments with no known source <span className="tnum font-normal text-faint">· {payments.length}</span></h4>
            <p className="text-xs text-muted">The card got paid, but no bank in the app shows the money leaving. Usually a bank statement that isn’t uploaded yet.</p>
          </div>
          <ul className="divide-y divide-rule">
            {payments.map((p) => <PaymentRow key={p.transaction_id} p={p} />)}
          </ul>
        </section>
      )}
      {named.length > 0 && (
        <section>
          <button onClick={() => setShowNamed((v) => !v)} aria-expanded={showNamed} className="flex w-full items-center gap-2 border-b border-rule pb-1.5 text-left text-sm text-ink">
            <span className={`inline-block w-3 text-xs text-faint transition-transform ${showNamed ? 'rotate-90' : ''}`} aria-hidden>▸</span>
            Named by the card, waiting to be confirmed <span className="tnum text-faint">· {named.length}</span>
          </button>
          {showNamed && (
            <>
              <p className="mt-1 text-xs text-muted">The card statement says which bank paid these. They confirm on their own once that bank’s statement is uploaded.</p>
              <ul className="divide-y divide-rule">{named.map((p) => <PaymentRow key={p.transaction_id} p={p} />)}</ul>
            </>
          )}
        </section>
      )}
      {cardBills.length > 0 && (
        <section>
          <div className="mb-1 border-b border-rule-str pb-1.5">
            <h4 className="text-sm font-medium text-ink">
              Card bills with no card payment <span className="tnum font-normal text-faint">· {cardBills.reduce((n, g) => n + g.count, 0)}</span>
            </h4>
            <p className="text-xs text-muted">Money left a bank to pay a card, but no card in the app shows it arriving. Grouped by card and month.</p>
          </div>
          <ul className="divide-y divide-rule">
            {bills.map((g) => {
              const t = billGroupText(g);
              return (
                <li key={g.key} className="py-2.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className={`min-w-0 truncate text-sm ${t.tone === 'spend' ? 'text-spend' : 'text-ink'}`}>{t.title}</span>
                    <span className="shrink-0 font-mono text-sm tnum text-spend">{formatMoney(-g.total_cents, { showSign: true })}</span>
                  </div>
                  {t.lines.map((line) => <p key={line} className="mt-0.5 text-xs text-muted">{line}</p>)}
                </li>
              );
            })}
          </ul>
          {cardBills.length > bills.length && (
            <button onClick={() => setShowAll(true)} className="mt-1 text-xs text-ink underline-offset-4 hover:underline">Show all {cardBills.length}</button>
          )}
        </section>
      )}
    </div>
  );
}

function Tile({ label, n, tone, onClick }) {
  return (
    <button onClick={onClick} className="min-w-0 px-3 py-2 text-left transition-colors hover:bg-band">
      <div className={`font-mono text-lg tnum ${n > 0 ? TONE[tone] : 'text-faint'}`}>{n}</div>
      <div className="truncate text-xs text-muted">{label}</div>
    </button>
  );
}

const TABS = ['findings', 'statements', 'payments', 'merchants'];

/**
 * The Review page (D212, /review). It was a pop-up on Transactions until
 * it grew five tabs, count tiles and deep links; now it has its own place
 * in the sidebar with a count badge, and the tab lives in the address bar
 * (?tab=payments) so a toast, a bookmark or Back lands on the right one.
 */
export function TransactionReview(props) {
  const glass = useDesign().design === 'glass';
  const [params, setParams] = useSearchParams();
  if (!glass) return <ClassicReview {...props} />;
  const tab = TABS.includes(params.get('tab')) ? params.get('tab') : 'findings';
  return (
    <GlassReview
      {...props}
      tab={tab}
      setTab={(value) => setParams({ tab: value }, { replace: true })}
      StatementsPane={GlassStatementsPane}
      PaymentsPane={GlassPaymentsPane}
      MerchantsPane={() => <GlassMerchantsPane onResolved={props.onResolved} />}
    />
  );
}

function ClassicReview({ categories, onResolved }) {
  const vivid = useDesign().design === 'vivid';
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [params, setParams] = useSearchParams();
  const tab = TABS.includes(params.get('tab')) ? params.get('tab') : 'findings';
  const setTab = (value) => setParams({ tab: value }, { replace: true });
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState(null);
  const [openKinds, setOpenKinds] = useState(null);
  const [showSmall, setShowSmall] = useState(false);
  const [showHow, setShowHow] = useState(false);

  const load = () => api.transactionReview.list().then(setData).catch((err) => setError(err.message));
  useEffect(() => { load(); }, []);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      setLastRun(await api.transactionReview.run());
      await load();
      onResolved?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  };

  const resolve = async (id, action, value) => {
    setBusyId(id);
    setError(null);
    try {
      await (action === 'approve' ? api.transactionReview.approve(id, value) : api.transactionReview.dismiss(id));
      setData((d) => ({ ...d, items: d.items.filter((i) => i.id !== id) }));
      // An approved fix changes a row: every open view of transactions reloads (D211).
      if (action === 'approve') invalidate('transactions');
      onResolved?.();
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusyId(null);
    }
  };

  // Every finding in a group, each as suggested. One request at a time so
  // each gets its own audit entry and a failure stops where it happened.
  const approveAll = async (items) => {
    if (!window.confirm(`Approve all ${items.length} as suggested?`)) return;
    for (const item of items) {
      if (!item.suggested_value) continue;
      if (!(await resolve(item.id, 'approve', item.suggested_value))) break;
    }
  };

  // A wrong sign fixed from its statement: approve the finding, then reload
  // so the statement drops off the list once it adds up.
  const flip = async (s) => {
    const item = data.items.find((i) => i.id === s.hint.review_id);
    if (item && (await resolve(item.id, 'approve', item.suggested_value))) await load();
  };

  const tiers = groupFindings(data?.items ?? []);
  const counts = Object.fromEntries(tiers.map((t) => [t.tier.key, t.groups.reduce((n, g) => n + g.items.length, 0)]));
  // Open by default: everything in Fix first, else the first group.
  const isOpen = (kind) =>
    openKinds ? openKinds.has(kind) : tiers[0]?.tier.key === 'fix' ? tiers[0].groups.some((g) => g.kind === kind) : tiers[0]?.groups[0]?.kind === kind;
  const toggle = (kind) => {
    const next = new Set(tiers.flatMap((t) => t.groups.map((g) => g.kind)).filter(isOpen));
    next.has(kind) ? next.delete(kind) : next.add(kind);
    setOpenKinds(next);
  };

  // Statements: one-click fixes first, then real gaps by size; small ones folded away.
  const fixesByReview = new Map((data?.statements ?? []).filter((s) => s.hint?.kind === 'sign_fix').map((s) => [s.hint.review_id, s]));
  const rank = (s) => (s.hint?.kind === 'sign_fix' ? 0 : 1);
  const bigStatements = (data?.statements ?? [])
    .filter((s) => s.hint?.kind !== 'small')
    .sort((a, b) => rank(a) - rank(b) || Math.abs(b.tally.diff_cents) - Math.abs(a.tally.diff_cents));
  const smallStatements = (data?.statements ?? []).filter((s) => s.hint?.kind === 'small');
  const total = data ? data.items.length : 0;

  return (
    <div className="max-w-4xl">
        <header className="mb-5">
          <div>
            <PageTitle className="text-2xl font-medium tracking-tight text-ink" emoji="✅" tint="bg-vivid-green/15">Review</PageTitle>
            <p className="mt-1 max-w-prose text-sm text-muted">
              Saved rows that look wrong, and statements that don't add up. Nothing changes until you approve it.{' '}
              <button onClick={() => setShowHow((v) => !v)} className="text-ink underline-offset-4 hover:underline">
                {showHow ? 'Hide how this works' : 'How this works'}
              </button>
            </p>
            {showHow && (
              <ol className="mt-2 max-w-prose list-decimal space-y-0.5 pl-4 text-xs text-muted">
                <li><span className="text-ink">Re-check all</span> reads every saved row against today's rules and the way you've labelled similar rows before.</li>
                <li>Each finding shows what it is now (crossed out) and what it would become. You can pick something else from the list.</li>
                <li><span className="text-ink">Approve</span> saves the change and becomes the example future imports follow. <span className="text-ink">Keep as is</span> hides it for good; it's never asked again.</li>
                <li>Statements are checked separately: their rows must add up to the balances the bank printed.</li>
              </ol>
            )}
          </div>
        </header>

        {data && (
          <div className="mb-4 grid grid-cols-2 divide-rule rounded-md border border-rule sm:grid-cols-5 sm:divide-x">
            <Tile label="Fix first" n={counts.fix ?? 0} tone="spend" onClick={() => setTab('findings')} />
            <Tile label="Change your totals" n={counts.totals ?? 0} tone="spend" onClick={() => setTab('findings')} />
            <Tile label="Labels only" n={counts.tidy ?? 0} tone="muted" onClick={() => setTab('findings')} />
            <Tile label="Statements off" n={bigStatements.length} tone="spend" onClick={() => setTab('statements')} />
            <Tile label="Payments to trace" n={(data.payments?.filter((p) => p.payment_source.status === 'unverified').length ?? 0) + (data.card_bills?.length ?? 0)} tone="muted" onClick={() => setTab('payments')} />
          </div>
        )}

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'findings', label: `Rows to check${data ? ` (${total})` : ''}` },
              { value: 'statements', label: `Statements${data ? ` (${data.statements.length})` : ''}` },
              { value: 'payments', label: `Payments${data ? ` (${(data.payments?.filter((p) => p.payment_source.status === 'unverified').length ?? 0) + (data.card_bills?.length ?? 0)})` : ''}` },
              { value: 'merchants', label: 'Merchant names' },
            ]}
          />
          <div className="flex items-center gap-3">
            {lastRun && (
              <span className="text-xs text-muted">
                Checked <span className="tnum">{lastRun.checked}</span> rows · <span className="tnum">{lastRun.added}</span> new
                {lastRun.payments && <> · <span className="tnum">{lastRun.payments.verified}</span>/<span className="tnum">{lastRun.payments.payments}</span> payments traced</>}
              </span>
            )}
            <Button size="sm" variant="quiet" onClick={run} disabled={running}>
              {running ? 'Checking…' : 'Re-check all'}
            </Button>
          </div>
        </div>

        {error && <p className="mb-3 text-sm text-spend">{error}</p>}
        {!data && !error && <p className="text-sm text-muted">Loading…</p>}

        {data && tab === 'findings' && (
          tiers.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">{vivid ? '✨ ' : ''}Nothing to review. Every saved row agrees with today's rules.</p>
          ) : (
            tiers.map(({ tier, groups }) => (
              <div key={tier.key} className="mb-5">
                <div className="mb-1 border-b border-rule-str pb-1.5">
                  <h4 className={`text-sm font-medium ${tier.key === 'fix' ? 'text-spend' : 'text-ink'}`}>
                    {vivid ? VIVID_TIER[tier.key] : ''}{tier.title} <span className="tnum font-normal text-faint">· {counts[tier.key]}</span>
                  </h4>
                  <p className="text-xs text-muted">{tier.blurb}</p>
                </div>
                {groups.map((g) => (
                  <Group
                    key={g.kind}
                    group={g}
                    open={isOpen(g.kind)}
                    onToggle={() => toggle(g.kind)}
                    busyId={busyId}
                    onApproveAll={approveAll}
                    renderItem={(item) => (
                      <Finding
                        key={item.id}
                        item={item}
                        categories={categories}
                        busy={busyId === item.id}
                        fixes={fixesByReview.get(item.id)}
                        onApprove={async (value) => { if ((await resolve(item.id, 'approve', value)) && fixesByReview.has(item.id)) load(); }}
                        onDismiss={() => resolve(item.id, 'dismiss')}
                      />
                    )}
                  />
                ))}
              </div>
            ))
          )
        )}

        {data && tab === 'statements' && (
          data.statements.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">Every statement adds up to its printed balances.</p>
          ) : (
            <>
              <p className="mb-2 text-xs text-muted">
                Each statement's rows should add up to the change between its opening and closing balance. These don't. The
                likeliest cause is under each one.
              </p>
              {bigStatements.length > 0 && (
                <ul className="divide-y divide-rule">
                  {bigStatements.map((s) => (
                    <StatementRow key={s.batch_id} s={s} busy={busyId !== null} onFlip={() => flip(s)} />
                  ))}
                </ul>
              )}
              {smallStatements.length > 0 && (
                <div className="mt-2 border-t border-rule pt-2">
                  <button onClick={() => setShowSmall((v) => !v)} aria-expanded={showSmall} className="flex items-center gap-2 text-xs text-muted hover:text-ink">
                    <span className={`inline-block w-3 transition-transform ${showSmall ? 'rotate-90' : ''}`} aria-hidden>▸</span>
                    <span className="tnum">{smallStatements.length}</span> small gaps under $10 · low priority
                  </button>
                  {showSmall && (
                    <ul className="divide-y divide-rule pl-5">
                      {smallStatements.map((s) => <StatementRow key={s.batch_id} s={s} busy={busyId !== null} />)}
                    </ul>
                  )}
                </div>
              )}
              <Link to="/import" className="mt-3 inline-block text-sm text-ink underline-offset-4 hover:underline">
                Go to Statements
              </Link>
            </>
          )
        )}

        {data && tab === 'payments' && <PaymentsTab payments={data.payments ?? []} cardBills={data.card_bills ?? []} />}

        {tab === 'merchants' && <MerchantReview embedded onResolved={onResolved} />}
    </div>
  );
}
