import { formatMoney, maskName } from '../../api';
import { useDesign } from '../../hooks/use-design';
import { TxnName } from '../transactions/TxnName';
import { MerchantAvatar } from '../ui/MerchantAvatar';
import { PersonAvatar } from '../ui/PersonAvatar';
import { VIVID_MIX_COLORS } from '../../lib/app/designs';

/** The sections under "Where it's going", each switched on in Settings → Overview cards (D375). */

/* ------------------------------------------------------------------
   Vivid only (D146): the by-person line as cards with avatars and each
   person's share of the month, and "Largest this month" as a ranked
   list — medals for the top three, a bar against the biggest, and each
   category chip in the same color that category already has in Spend
   mix and "Where it's going" (both ranked biggest-first from the same
   by_category rows), so a category is one color across the page.
   ------------------------------------------------------------------ */

function VividByPerson({ byPerson, people }) {
  const spentOf = (p) => Math.max(-p.net_cents, 0);
  const total = byPerson.reduce((sum, p) => sum + spentOf(p), 0);
  return (
    <div className="mb-10 grid grid-cols-1 gap-3 sm:grid-cols-2">
      {byPerson.map((p) => {
        const person = people.find((x) => x.id === p.id) ?? p;
        const share = total > 0 ? spentOf(p) / total : 0;
        return (
          <div key={p.id} className="flex items-center gap-3 rounded-2xl border border-rule bg-raised p-4">
            <PersonAvatar person={person} size={40} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm text-ink">{maskName(p.name)}</span>
                <span className={`font-mono text-sm font-semibold tnum ${p.net_cents >= 0 ? 'text-earn' : 'text-spend'}`}>
                  {p.net_cents >= 0 ? '+' : ''}
                  {formatMoney(p.net_cents)}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 rounded-full bg-band">
                <div className="animate-bar-grow h-1.5 rounded-full bg-vivid-purple" style={{ width: `${share * 100}%` }} />
              </div>
              <div className="mt-1 text-[11px] text-muted">{Math.round(share * 100)}% of the household's spend this month</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const MEDALS = ['🥇', '🥈', '🥉'];

function VividLargest({ largest, byCategory }) {
  const max = Math.max(...largest.map((t) => Math.abs(t.amount_cents)), 1);
  const colorOf = (name) => {
    const rank = byCategory.findIndex((c) => c.name === (name ?? 'Uncategorized'));
    return VIVID_MIX_COLORS[rank] ?? 'bg-rule-str';
  };
  return (
    <ol className="flex flex-col gap-2.5">
      {largest.map((t, i) => (
        <li key={t.id} className="grid grid-cols-[2rem_auto_1fr_auto] items-center gap-3">
          <span className="text-center text-lg leading-none" aria-label={`#${i + 1}`}>
            {MEDALS[i] ?? <span className="font-mono text-sm text-faint">{i + 1}</span>}
          </span>
          <MerchantAvatar merchant={t.merchant} description={t.description} amountCents={t.amount_cents} categoryName={t.category_name} categoryIconKey={t.category_icon_key} size={32} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm text-ink" title={t.description}><TxnName t={t} fallback={t.description} /></span>
              <span className="flex shrink-0 items-center gap-1 rounded-full bg-band px-2 py-0.5 text-[11px] text-muted">
                <span className={`size-1.5 rounded-full ${colorOf(t.category_name)}`} />
                {t.category_name ?? 'Uncategorized'}
              </span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-band">
              <div
                className={`animate-bar-grow h-1.5 rounded-full ${colorOf(t.category_name)}`}
                style={{ width: `${(Math.abs(t.amount_cents) / max) * 100}%`, animationDelay: `${i * 60}ms` }}
              />
            </div>
          </div>
          <span className="font-mono text-sm font-semibold text-spend tnum whitespace-nowrap">{formatMoney(t.amount_cents, { showSign: true })}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Where it's going, by person — the same question, split two
 * ways, as plain figures rather than a colored tile each.
 * net_cents isn't clamped at 0 (see routes/summary.js), so a
 * person who went net positive this month (a refund/credit
 * bigger than what they spent) shows a signed "+" here rather
 * than a flat, misleading $0.00.
 */
export function ByPersonSection({ byPerson, people }) {
  const vivid = useDesign().design === 'vivid';
  if (byPerson.length === 0) return null;
  if (vivid) return <VividByPerson byPerson={byPerson} people={people} />;
  return (
    <div className="mb-10 flex flex-wrap gap-x-8 gap-y-1.5 text-sm text-muted">
      {byPerson.map((person) => (
        <span key={person.id}>
          {maskName(person.name)}{' '}
          <span className={`font-mono tnum ${person.net_cents >= 0 ? 'text-earn' : 'text-ink'}`}>
            {person.net_cents >= 0 ? '+' : ''}{formatMoney(Math.abs(person.net_cents))}
          </span>
        </span>
      ))}
    </div>
  );
}

/** The month's largest transactions. */
export function LargestSection({ largest, byCategory }) {
  const vivid = useDesign().design === 'vivid';
  return (
    <section className="mb-10 rounded-2xl border border-rule bg-raised p-5">
      <div className="mb-4">
        <h3 className="text-base font-medium text-ink">Largest this month</h3>
      </div>
      {largest.length === 0 ? (
        <p className="text-sm text-muted">No transactions yet this month.</p>
      ) : vivid ? (
        <VividLargest largest={largest} byCategory={byCategory} />
      ) : (
        <table className="w-full border-collapse text-sm">
          <tbody>
            {largest.map((t) => (
              <tr key={t.id} className="border-b border-rule last:border-0">
                <td className="py-2.5 pr-3">
                  <MerchantAvatar
                    merchant={t.merchant}
                    txnType={t.txn_type}
                    amountCents={t.amount_cents}
                    categoryName={t.category_name}
                    categoryIconKey={t.category_icon_key}
                    size={30}
                  />
                </td>
                {/* max-w-0 + w-full lets a long name shorten with "…" instead of widening the table past a phone (D387). */}
                <td className="w-full max-w-0 truncate py-2.5 pr-4 text-ink" title={t.description}>
                  <TxnName t={t} fallback={t.description} />
                </td>
                <td className="hidden py-2.5 pr-4 sm:table-cell">
                  <span className="whitespace-nowrap rounded-full bg-band px-2 py-0.5 text-xs text-muted">
                    {t.category_name ?? 'Uncategorized'}
                  </span>
                </td>
                <td className="py-2.5 text-right font-mono text-spend tnum whitespace-nowrap">
                  {formatMoney(t.amount_cents, { showSign: true })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
