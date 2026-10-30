import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { api, formatMoney, formatShortDate } from '../../api';
import { useApi, invalidate } from '../../hooks/use-api';
import { useDesign } from '../../hooks/use-design';
import { useWide } from '../../hooks/use-wide';
import { useNotify } from '../../hooks/use-notify';
import { useStatementGaps } from '../../hooks/use-statement-gaps';
import { statementHintText } from '../../lib/review/review-groups';
import { clueFor, paymentsToTrace } from '../../lib/review/upload-view';
import { statementAccounts, silentAccounts } from '../../lib/review/review-lists';
import { ListRow, ListSection, MiniCard } from '../settings/apple/SplitList';
import { GroupBlock, GroupRow } from '../settings/apple/grouped';

/**
 * Review's Statements, Silent months and Payments as split views (D319), the
 * way the rest of the app is laid out: the accounts on the left, one row each
 * with what's wrong in a line, and the chosen account on the right with
 * everything about it and what to do. The choice is in the URL (?item=a17).
 * Grouping and words: lib/review/review-lists.js and upload-view.js.
 */

const UPLOAD = 'rounded-full bg-info px-3.5 py-1.5 text-[13px] font-semibold text-white transition-[filter] hover:brightness-110';
const TONE = { spend: 'text-spend', earn: 'text-earn', muted: 'text-muted' };

function useAccounts() {
  const req = useApi('accounts:with-closed', () => api.accounts.list(true), { tags: ['transactions'] });
  const list = req.data ?? [];
  return {
    byId: (id) => list.find((a) => a.id === id) ?? null,
    idByName: (name) => list.find((a) => a.name === name)?.id ?? null,
    byName: (name) => list.find((a) => a.name === name) ?? null,
  };
}

const Art = ({ account }) => (account
  ? <MiniCard account={account} size="lg" />
  : <span className="h-[26px] w-10 shrink-0 rounded-[5px] border border-dashed border-rule-str" aria-hidden="true" />);

/** ↑↓ walk the rows, as moveSelection does, for ids that aren't numbers. */
function moveRows(e, onSelect) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const buttons = [...e.currentTarget.querySelectorAll('button[data-row-id]')];
  const at = buttons.indexOf(document.activeElement);
  if (at < 0) return;
  e.preventDefault();
  const next = buttons[Math.min(buttons.length - 1, Math.max(0, at + (e.key === 'ArrowDown' ? 1 : -1)))];
  next.focus();
  onSelect(next.dataset.rowId);
}

/** The split itself: sections of account rows, the chosen one's detail beside them. */
function Split({ label, sections, empty, footer, renderDetail }) {
  const [params, setParams] = useSearchParams();
  const wide = useWide('(min-width: 1024px)');
  const { design } = useDesign();
  const reduceMotion = useReducedMotion();
  const still = design === 'classic' || Boolean(reduceMotion);
  const rows = sections.flatMap((s) => s.rows);
  const picked = rows.find((r) => r.id === params.get('item')) ?? null;
  const selected = picked ?? (wide ? rows[0] ?? null : null);
  const select = (id) => setParams((p) => { const n = new URLSearchParams(p); n.set('item', id); return n; }, { replace: true });
  const back = () => setParams((p) => { const n = new URLSearchParams(p); n.delete('item'); return n; }, { replace: true });

  if (rows.length === 0) return <div className="rounded-[14px] border border-rule bg-raised px-6 py-12 text-center">{empty}</div>;

  return (
    <div className="apple-pane lg:grid lg:grid-cols-[24rem_minmax(0,1fr)] lg:items-start lg:gap-10">
      <nav aria-label={label} className={`space-y-5 ${picked ? 'hidden lg:block' : ''}`} onKeyDown={(e) => moveRows(e, select)}>
        {sections.filter((s) => s.rows.length).map((s) => (
          <ListSection key={s.key} label={<>{s.label} <span className="tnum">· {s.rows.length}</span></>}>
            <ul>
              {s.rows.map((r, i) => (
                <ListRow key={r.id} id={r.id} selected={selected?.id === r.id} afterSelected={selected?.id === s.rows[i - 1]?.id}
                  onSelect={select} leading={r.art} title={r.title} suffix={r.suffix} dimmed={r.dimmed}
                  subtitle={<span className={r.tone === 'spend' && selected?.id !== r.id ? 'text-spend' : ''}>{r.subtitle}</span>}
                  trailing={r.trailing ? (sel) => <span className={`shrink-0 text-[15px] tnum ${sel ? 'text-white' : 'text-ink'}`}>{r.trailing}</span> : undefined} />
              ))}
            </ul>
          </ListSection>
        ))}
        {footer && <p className="px-3 text-[13px] text-muted">{footer}</p>}
      </nav>
      <section aria-label={selected?.title ?? label} className={`split-detail ${picked ? '' : 'hidden lg:block'}`}>
        <button type="button" onClick={back} className="mb-4 flex items-center gap-1 text-[15px] text-info lg:hidden">
          <svg width="9" height="15" viewBox="0 0 8 13" aria-hidden="true"><path d="M6.5 1.5 1.5 6.5l5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          {label}
        </button>
        {selected && (
          <motion.div key={selected.id} initial={still ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', bounce: 0, duration: 0.3 }}>
            {renderDetail(selected)}
          </motion.div>
        )}
      </section>
    </div>
  );
}

/** A detail's header: the account's art large, its name, a line, and its actions. */
function Header({ account, name, mask, line, children }) {
  return (
    <header className="mb-7 flex flex-wrap items-center gap-4">
      {account ? <MiniCard account={account} size="lg" /> : null}
      <div className="min-w-0 flex-1">
        <h3 className="text-[22px] leading-tight font-semibold tracking-[-0.02em] text-ink">{name}{mask && <span className="text-muted tnum"> ··{mask}</span>}</h3>
        {line && <p className="mt-0.5 text-[13px] text-muted">{line}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </header>
  );
}

/* ------------------------------------------------------------------ Statements */

export function ReviewStatements({ data, reload }) {
  const { view } = useStatementGaps();
  const accounts = useAccounts();
  const notify = useNotify();
  const [busy, setBusy] = useState(false);
  const rows = statementAccounts({ view, statements: data.statements ?? [], accountIdByName: accounts.idByName });

  const flip = async (s) => {
    setBusy(true);
    try {
      await api.transactionReview.approve(s.hint.review_id);
      invalidate('transactions');
      await reload();
      notify(`${s.account_name} · sign flipped`, { name: 'statement.fixed' });
    } catch (err) {
      notify(err.message, { name: 'error.fix' });
    } finally {
      setBusy(false);
    }
  };

  const toRow = (r) => ({
    id: r.id, title: r.name, suffix: r.mask ? `··${r.mask}` : null, subtitle: r.summary, tone: r.worst === 'missing' || r.worst === 'off' ? 'spend' : null,
    art: <Art account={accounts.byId(r.account_id) ?? accounts.byName(r.name)} />, data: r,
  });
  const sections = [
    { key: 'missing', label: 'Missing statements', rows: rows.filter((r) => r.worst === 'missing').map(toRow) },
    { key: 'off', label: "Don't add up", rows: rows.filter((r) => r.worst === 'off').map(toRow) },
    { key: 'problem', label: 'Saved wrong', rows: rows.filter((r) => r.worst === 'problem').map(toRow) },
    { key: 'small', label: 'Small gaps', rows: rows.filter((r) => r.worst === 'small').map(toRow) },
  ];

  return (
    <Split label="Statements" sections={sections}
      empty={<><p className="text-[17px] font-semibold text-ink">Every statement is here and adds up</p><p className="mt-1 text-[13px] text-muted">Nothing missing, nothing off.</p></>}
      footer={rows.some((r) => r.off.length) ? null : 'Every saved statement adds up.'}
      renderDetail={({ data: r }) => (
        <>
          <Header account={accounts.byId(r.account_id) ?? accounts.byName(r.name)} name={r.name} mask={r.mask} line={r.summary}>
            {r.missing.length > 0 && <Link to="/import" className={UPLOAD}>Upload</Link>}
          </Header>
          <div className="space-y-7">
            {r.missing.length > 0 && (
              <GroupBlock header="Missing" footer="Your other statements show these exist. Banks name a statement by the month it closes.">
                {r.missing.map((s) => (
                  <GroupRow key={s.key} label={<span><span className="font-medium">{s.month}</span> <span className="text-[13px] text-muted tnum">· {s.dates}</span></span>}>
                    <span className="text-[13px] tnum">{s.clue}</span>
                  </GroupRow>
                ))}
              </GroupBlock>
            )}
            {r.off.length > 0 && (
              <GroupBlock header="Doesn't add up" footer="Its rows don't match the statement's own totals. The likeliest cause is beside each.">
                {r.off.map((s) => {
                  const hint = statementHintText(s.hint);
                  return (
                    <GroupRow key={s.batch_id} label={<span className="tnum">Ending {formatShortDate(s.period_end)}, {s.period_end.slice(0, 4)}</span>}>
                      <span className={`truncate text-[13px] ${TONE[hint.tone] ?? ''}`}>{hint.title}</span>
                      <span className="shrink-0 text-ink tnum">{formatMoney(s.cents)} off</span>
                      {hint.action === 'approve' && <button type="button" disabled={busy} onClick={() => flip(s)} className={UPLOAD}>Flip the sign</button>}
                    </GroupRow>
                  );
                })}
              </GroupBlock>
            )}
            {r.problems.length > 0 && (
              <GroupBlock header="Saved wrong" footer="Delete these on Import and upload them again.">
                {r.problems.map((p, i) => <GroupRow key={i} label={<span className="text-[15px]">{p.reason}</span>} />)}
              </GroupBlock>
            )}
          </div>
        </>
      )}
    />
  );
}

/* ------------------------------------------------------------------ Silent months */

export function ReviewSilent() {
  const { silent, busy, answer, unanswer } = useStatementGaps();
  const accounts = useAccounts();
  const rows = silentAccounts(silent);
  const toRow = (r) => ({
    id: r.id, title: r.name, suffix: r.mask ? `··${r.mask}` : null, subtitle: r.summary, data: r,
    art: <Art account={accounts.byId(r.account_id)} />, dimmed: r.ask.length === 0,
  });
  const sections = [
    { key: 'ask', label: 'Was there a statement?', rows: rows.filter((r) => r.ask.length).map(toRow) },
    { key: 'quiet', label: 'Quiet', rows: rows.filter((r) => !r.ask.length).map(toRow) },
  ];

  return (
    <Split label="Silent months" sections={sections}
      empty={<><p className="text-[17px] font-semibold text-ink">No silent months</p><p className="mt-1 text-[13px] text-muted">Every card has a statement, or one to upload, for every month.</p></>}
      renderDetail={({ data: r }) => (
        <>
          <Header account={accounts.byId(r.account_id)} name={r.name} mask={r.mask} line={r.summary}>
            {r.ask.length > 1 && (
              <button type="button" disabled={busy} onClick={async () => { for (const a of r.ask) await answer(a); }} className="rounded-full px-3.5 py-1.5 text-[13px] font-medium text-info hover:bg-info/10">None for all</button>
            )}
            {r.ask.length > 0 && <Link to="/import" className={UPLOAD}>Upload</Link>}
          </Header>
          <div className="space-y-7">
            {r.ask.length > 0 && (
              <GroupBlock header="Was there a statement?" footer={'Say "No statement" if the card was quiet that month. Activity later brings it back.'}>
                {r.ask.map((a) => (
                  <GroupRow key={a.cycle.end} label={<span><span className="font-medium">{a.month}</span> <span className="text-[13px] text-muted tnum">· {a.dates}</span></span>}>
                    <span className="hidden truncate text-[13px] sm:inline">{clueFor(a.cycle)}</span>
                    <button type="button" disabled={busy} onClick={() => answer(a)} className="shrink-0 rounded-full bg-info/10 px-3 py-1 text-[13px] font-medium text-info hover:bg-info/15">No statement</button>
                  </GroupRow>
                ))}
              </GroupBlock>
            )}
            {r.quiet.length > 0 && (
              <GroupBlock header="Silent months" footer="$0 and no activity, shown by both sides or by your answer.">
                {r.quiet.map((q) => (
                  <GroupRow key={q.cycle.end} label={<span><span className="font-medium">{q.month}</span> <span className="text-[13px] text-muted tnum">· {q.dates}</span></span>}>
                    <span className="text-[13px]">{q.answered ? 'You said no statement' : 'No activity'}</span>
                    {q.answered && (
                      <button type="button" disabled={busy} onClick={() => unanswer({ ...q.card, cycle: q.cycle })} className="shrink-0 text-[13px] font-medium text-info hover:underline">Undo</button>
                    )}
                  </GroupRow>
                ))}
              </GroupBlock>
            )}
          </div>
        </>
      )}
    />
  );
}

/* ------------------------------------------------------------------ Payments */

export function ReviewPayments({ data }) {
  const accounts = useAccounts();
  const groups = paymentsToTrace(data.payments ?? [], data.card_bills ?? []);
  const toRow = (g) => ({
    id: g.key, title: g.name, suffix: g.mask ? `··${g.mask}` : null, data: g,
    subtitle: g.count > 0 ? `${g.either ? 'Either card · ' : ''}${g.count} ${g.count === 1 ? 'payment' : 'payments'} · ${g.range}` : `${g.waiting} on the way · ${g.range}`,
    trailing: g.count > 0 ? formatMoney(g.cents) : null,
    art: <Art account={accounts.byId(g.account_id) ?? accounts.byName(g.name)} />, dimmed: !g.uploadable,
  });
  const sections = [
    { key: 'match', label: 'To match', rows: groups.filter((g) => g.uploadable && g.count > 0).map(toRow) },
    { key: 'way', label: 'On the way', rows: groups.filter((g) => g.uploadable && g.count === 0).map(toRow) },
    { key: 'none', label: 'No upload will match', rows: groups.filter((g) => !g.uploadable).map(toRow) },
  ];

  return (
    <Split label="Payments" sections={sections}
      empty={<><p className="text-[17px] font-semibold text-ink">Every payment is matched</p><p className="mt-1 text-[13px] text-muted">Each one shows where it left and where it landed.</p></>}
      renderDetail={({ data: g }) => (
        <>
          <Header account={accounts.byId(g.account_id) ?? accounts.byName(g.name)} name={g.name} mask={g.mask}
            line={g.uploadable
              ? `${g.count ? `${g.count} ${g.count === 1 ? 'payment shows' : 'payments show'} on one side only.` : 'Named on the card statement.'} Upload this account's statements for ${g.range} and they match.`
              : 'Every statement in the app is uploaded and none shows these. Add the account they came from to match them.'}>
            {g.uploadable && <Link to="/import" className={UPLOAD}>Upload</Link>}
          </Header>
          <div className="space-y-7">
            {g.months.map((m) => (
              <GroupBlock key={m.key} header={m.label}>
                {m.lines.map((l) => (
                  <GroupRow key={l.key} label={<span className={l.waiting ? 'text-muted' : ''}>{l.text}</span>}>
                    <span className="text-[13px] tnum">{formatShortDate(l.date)}</span>
                    <span className="w-24 shrink-0 text-right text-ink tnum">{formatMoney(l.cents)}</span>
                  </GroupRow>
                ))}
              </GroupBlock>
            ))}
          </div>
        </>
      )}
    />
  );
}
