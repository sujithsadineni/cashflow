import { useState } from 'react';
import { api, formatMoney } from '../../../api';
import { useApi } from '../../../hooks/use-api';
import { DetailDialog } from '../../ui/DetailDialog';
import { UtilisationBar } from '../../ui/UtilisationBar';
import { CreditIcon } from '../../cards/CardIcons';
import { YearSwitch } from './MoneyExplorer';
import { cardUtilisation, creditMonths, householdUtilisation } from '../../../lib/cards/utilisation';
import { monthLong } from '../../../lib/app/dates';
import { Loading } from '../../ui/Loading';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const BAR = { muted: ['bg-ink/80', 'bg-ink/45', 'bg-ink/15'], warn: ['bg-warn', 'bg-warn/55', 'bg-warn/20'], spend: ['bg-spend', 'bg-spend/55', 'bg-spend/20'] };

/**
 * Twelve months of the household's share of its limits, as bars scaled to
 * the year's highest month, each labelled with its exact share (D358). The same reading as the money explorer's bars (MoneyExplorer.jsx):
 * months still to come are a stub, the picked one is solid, hover says the
 * month's figures, tap picks it. Coloured by the same thresholds as every
 * credit bar: quiet under 30%, amber from 30%, red from 70%.
 */
function UsedBars({ months, picked, onPick }) {
  const [hovered, setHovered] = useState(null);
  const pickedAt = months.findIndex((m) => m.month === picked);
  const tip = hovered !== null ? months[hovered] : null;
  // Scaled to the year's highest month, like the money bars, so a quiet year still shows its shape.
  const top = Math.max(10, ...months.map((m) => m.household?.pct ?? 0));
  if (months.every((m) => !m.household)) return <p className="py-8 text-center text-sm text-faint">No limits on file for this year.</p>;
  return (
    <div className="relative">
      <div className="flex h-44 items-end gap-1 sm:gap-2" onMouseLeave={() => setHovered(null)}>
        {months.map((m, i) => {
          const h = m.household;
          const bar = BAR[h?.tone ?? 'muted'];
          const on = i === pickedAt || i === hovered;
          return (
            <button key={m.month} type="button" disabled={!h} onClick={() => onPick(m.month)}
              onMouseEnter={() => setHovered(i)} onFocus={() => setHovered(i)} onBlur={() => setHovered(null)}
              aria-pressed={i === pickedAt} aria-label={`${MONTHS[i]}: ${h ? `${h.pct}% used` : 'no figure'}`}
              className="group relative flex h-full min-w-0 flex-1 cursor-pointer flex-col items-center justify-end outline-none disabled:cursor-default">
              {h && (on || pickedAt < 0) && <span className="mb-1 font-mono text-[10px] text-muted tnum sm:text-[11px]">{h.pct}%</span>}
              <span className={`w-full max-w-9 rounded-t-[4px] transition-colors ${!h ? 'h-px bg-rule' : on ? bar[0] : pickedAt < 0 ? bar[1] : bar[2]}`}
                style={h ? { height: `${Math.max((Math.min(h.pct, 100) / top) * 100, 2)}%` } : undefined} />
            </button>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-1 sm:gap-2" aria-hidden="true">
        {months.map((m, i) => <span key={m.month} className={`flex-1 text-center text-[10px] sm:text-[11px] ${i === pickedAt ? 'text-ink' : 'text-faint'}`}>{MONTHS[i]}</span>)}
      </div>
      {tip?.household && (
        <div className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 rounded-lg border border-rule bg-raised px-3 py-1.5 text-xs shadow-sm tnum">
          {monthLong(tip.month)}: <span className="text-ink">{tip.household.pct}%</span> · {formatMoney(tip.household.used)} of {formatMoney(tip.household.limit)}
        </div>
      )}
    </div>
  );
}

/**
 * Behind Overview's Credit used card (D346), laid out like the other cards'
 * details (D358): the year's months as bars, the picked month's share and
 * what's left beside it, then each card that month, highest first. Each card's
 * figures are its own statement's, or the limit the household set (marked).
 */
export function CreditDetail({ month, onClose }) {
  const [year, setYear] = useState(Number(month.slice(0, 4)));
  const [picked, setPicked] = useState(month);
  const { data } = useApi(`credit:${year}`, () => api.credit(year), { tags: ['imports', 'accounts'] });
  const months = creditMonths(data);
  const years = data?.years?.length ? data.years : [year];
  // The picked month, or this year's last month with a figure.
  const shown = months.find((m) => m.month === picked && m.household) ?? [...months].reverse().find((m) => m.household) ?? null;
  const household = shown?.household ?? null;
  const cards = (shown?.cards ?? []).map((a) => [a, cardUtilisation(a)]).filter(([, u]) => u).sort((x, y) => y[1].pct - x[1].pct);
  const pickYear = (y) => { setYear(y); setPicked(`${y}-12`); };

  return (
    <DetailDialog
      title="Credit used"
      emoji="💳"
      icon={<CreditIcon />}
      tint="bg-vivid-amber/10"
      actions={years.length > 1 && <YearSwitch years={years} year={year} onChange={pickYear} />}
      hero={household && { label: `Every card, ${monthLong(shown.month)}`, value: `${household.pct}%`, tone: household.tone === 'spend' ? 'spend' : 'ink' }}
      side={household && { label: 'Available', value: <span className="font-mono tnum">{formatMoney(household.limit - household.used)}</span> }}
      sections={[
        {
          key: 'months',
          label: 'Month by month',
          content: data ? (
            <>
              <UsedBars months={months} picked={shown?.month} onPick={setPicked} />
              {household && (
                <div className="mt-6">
                  <UtilisationBar u={{ ...household, available: household.limit - household.used, asOf: null }} />
                  <h4 className="mt-6 mb-3 text-[13px] text-muted">By card, {monthLong(shown.month)}</h4>
                  <ul className="space-y-4">
                    {cards.map(([a, u]) => (
                      <li key={a.id}>
                        <div className="mb-1 text-sm text-ink">{a.nickname ?? a.name}{u.manual && <span className="text-faint"> · your limit</span>}</div>
                        <UtilisationBar u={u} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : <Loading />,
        },
      ]}
      note={[
        'Each card\'s balance and limit as its newest statement up to that month printed them; a limit you set in Settings → Accounts where none is printed.',
        household && householdUtilisation(shown.cards)?.without.length ? `Not counted that month: ${householdUtilisation(shown.cards).without.join(', ')} (no limit known).` : null,
      ].filter(Boolean).join(' ')}
      width="max-w-4xl"
      onClose={onClose}
    />
  );
}
