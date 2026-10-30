import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatMoney, formatShortDate } from '../../api';
import { costLabel, describeAnswer, describeLookup, monthLabel } from '../../lib/assistant/answer-text';

/**
 * An "Answer here" result (D332 step 3): the answer in a sentence, a small
 * chart when it's by month or a comparison, the top list, and the rows
 * behind it, each opening in Transactions. Not understood: what it said,
 * and the choices to ask instead. An Ask Claude answer (step 4): Claude's
 * words, what it cost, and every lookup it made, each one openable as the
 * same answer Answer here would give, so its figures can be checked.
 */

const Money = ({ cents, sign = false }) => <span className="font-mono tnum">{formatMoney(cents, { showSign: sign })}</span>;

function MonthBars({ months }) {
  const max = Math.max(...months.map((m) => m.net_cents), 1);
  return (
    <div className="flex items-end gap-1" role="img" aria-label="Spending by month">
      {months.map((m) => (
        <div key={m.month} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={`${monthLabel(m.month)} ${m.month.slice(0, 4)}: ${formatMoney(m.net_cents)}`}>
          <div className="flex h-20 w-full items-end">
            <div className="w-full rounded-t-[3px] bg-ink/75" style={{ height: `${Math.max((Math.max(m.net_cents, 0) / max) * 100, m.net_cents > 0 ? 3 : 0)}%` }} />
          </div>
          <span className="text-[10px] text-faint">{monthLabel(m.month)}</span>
        </div>
      ))}
    </div>
  );
}

function CompareBars({ periods }) {
  const max = Math.max(...periods.map((p) => p.net_cents), 1);
  return (
    <div className="grid gap-1.5">
      {periods.map((p) => (
        <div key={p.label} className="grid grid-cols-[minmax(0,7.5rem)_1fr_auto] items-center gap-2 text-[12px]">
          <span className="truncate text-muted">{p.label}</span>
          <span className="h-2 rounded-full bg-band">
            <span className="block h-2 rounded-full bg-ink/75" style={{ width: `${(Math.max(p.net_cents, 0) / max) * 100}%` }} />
          </span>
          <span className="text-ink"><Money cents={p.net_cents} /></span>
        </div>
      ))}
    </div>
  );
}

function TopList({ top }) {
  return (
    <ol className="grid grid-cols-1 gap-0.5 text-[12.5px]">
      {top.items.map((i, n) => {
        const label = (
          <>
            <span className="w-5 shrink-0 text-faint tnum">{n + 1}</span>
            <span className="min-w-0 flex-1 truncate text-ink">{i.name}</span>
            {i.posted_date && <span className="shrink-0 text-faint">{formatShortDate(i.posted_date)}</span>}
            {i.count != null && !i.posted_date && <span className="shrink-0 text-faint">{i.count}×</span>}
            <span className="shrink-0 text-ink"><Money cents={i.net_cents} /></span>
          </>
        );
        return (
          <li key={`${i.name}-${i.id ?? n}`}>
            {i.id ? (
              <Link to={`/transactions?txn=${i.id}`} className="flex items-baseline gap-2 rounded-md px-1 py-0.5 hover:bg-band">{label}</Link>
            ) : (
              <div className="flex items-baseline gap-2 px-1 py-0.5">{label}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function RowsBehind({ rows, total }) {
  const [open, setOpen] = useState(false);
  if (total === 0) return null;
  return (
    <div className="min-w-0">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="text-[12px] text-muted underline underline-offset-[3px] hover:text-ink">
        {open ? 'Hide the rows' : `Show the ${total === 1 ? 'row' : `${total} rows`} behind it`}
      </button>
      {open && (
        <ul className="mt-1.5 grid grid-cols-1 gap-0.5 text-[12px]">
          {rows.map((r) => (
            <li key={r.id}>
              <Link to={`/transactions?txn=${r.id}`} className="flex items-baseline gap-2 rounded-md px-1 py-0.5 hover:bg-band">
                <span className="w-12 shrink-0 text-faint">{formatShortDate(r.posted_date)}</span>
                <span className="min-w-0 flex-1 truncate text-ink">{r.name}</span>
                <span className="hidden max-w-[7rem] shrink-0 truncate text-faint sm:inline-block">{r.account_name}</span>
                <span className={`shrink-0 ${r.amount_cents > 0 ? 'text-earn' : 'text-ink'}`}><Money cents={r.amount_cents} sign /></span>
              </Link>
            </li>
          ))}
          {total > rows.length && <li className="px-1 pt-1 text-faint">Showing the newest {rows.length} of {total}.</li>}
        </ul>
      )}
    </div>
  );
}

function ClaudeAnswer({ detail }) {
  const [open, setOpen] = useState(false);
  const lookups = detail.lookups ?? [];
  return (
    <div className="grid min-w-0 grid-cols-1 gap-2.5 rounded-xl border border-rule bg-raised px-3 py-2.5">
      <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink">{detail.text}</p>
      <p className="text-[11.5px] text-faint">
        Claude · {costLabel(detail.cost_microdollars)} · {lookups.length === 1 ? '1 lookup' : `${lookups.length} lookups`}
      </p>
      {lookups.length > 0 && (
        <div className="min-w-0">
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="text-[12px] text-muted underline underline-offset-[3px] hover:text-ink">
            {open ? 'Hide what it looked up' : 'Show what it looked up'}
          </button>
          {open && (
            <ol className="mt-2 grid grid-cols-1 gap-2">
              {lookups.map((l, i) => (
                <li key={i} className="grid min-w-0 grid-cols-1 gap-1.5">
                  <p className="text-[12px] text-muted">{i + 1}. {describeLookup(l)}</p>
                  {l.result && <AnswerView detail={l.result} />}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

export function AnswerView({ detail, onAsk }) {
  if (!detail) return null;
  if (detail.via === 'claude') return <ClaudeAnswer detail={detail} />;
  if (detail.understood === false) {
    return (
      <div className="grid min-w-0 grid-cols-1 gap-2 rounded-xl border border-rule bg-band px-3 py-2.5 text-[13px]">
        <p className="text-ink">{detail.message}</p>
        {detail.choices?.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {detail.choices.map((c) => (
              <button key={c.question} type="button" onClick={() => onAsk?.(c.question)} className="rounded-full border border-rule-str bg-raised px-2.5 py-1 text-[12.5px] text-ink hover:bg-band">
                {c.label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }
  const d = describeAnswer(detail, formatMoney);
  return (
    <div className="grid min-w-0 grid-cols-1 gap-2.5 rounded-xl border border-rule bg-raised px-3 py-2.5">
      <p className="text-[14.5px] font-semibold leading-snug text-ink">{d.headline}</p>
      {d.lines.length > 0 && <p className="text-[12.5px] text-muted">{d.lines.join(' ')}</p>}
      {detail.intent === 'by_month' && detail.months?.length > 1 && <MonthBars months={detail.months} />}
      {detail.intent === 'compare' && <CompareBars periods={detail.periods} />}
      {detail.intent === 'top' && detail.top.items.length > 0 && <TopList top={detail.top} />}
      <RowsBehind rows={detail.rows} total={detail.rows_total} />
      <p className="text-[11.5px] leading-snug text-faint">{d.how}</p>
      {d.notes.map((n) => <p key={n} className="text-[11.5px] leading-snug text-muted">{n}</p>)}
    </div>
  );
}
