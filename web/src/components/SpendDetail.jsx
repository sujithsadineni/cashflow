import { formatMoney, formatShortDate, maskName } from '../api';
import { MiniTrend } from './MiniTrend';
import { PersonAvatar } from './ui/PersonAvatar';
import { DetailDialog, ShowMore } from './ui/DetailDialog';
import { MerchantAvatar } from './MerchantAvatar';

/**
 * The Spend card's drill-down — same treatment as Income (D51/D54),
 * adapted for what's actually different about Spend: there's no
 * short list of paychecks to itemize (a household can have dozens of
 * purchases a month), so per person this shows the total plus that
 * person's own top categories instead of every transaction — a cut
 * the main Overview page doesn't have at all (its "Where it's going"
 * bars are household-wide, not per person). The full transaction-by-
 * transaction list already has a home: the Transactions ledger.
 */

/**
 * A person's total is NOT clamped at 0 the way the household Spend
 * card is (see the comment on the by_person query in
 * routes/summary.js) — a real refund or credit bigger than what that
 * person actually bought can push them net positive in a month, and
 * that's shown as a real green "+" figure instead of a flattened
 * "$0.00" that would otherwise sit right above real purchases still
 * listed below it. The caption underneath only appears in that case,
 * to say why a spend card is showing green.
 */
function PersonSpendCard({ person, avatarPerson, categories }) {
  const credit = person.net_cents >= 0;
  return (
    <div className={`rounded-lg border p-4 ${credit ? 'border-earn/40' : 'border-rule'}`}>
      <div className="flex items-baseline justify-between">
        <div className="flex items-center gap-2">
          <PersonAvatar person={avatarPerson ?? person} size={28} />
          <span className="text-ink">{maskName(person.name)}</span>
        </div>
        <span className={`font-mono text-lg tnum ${credit ? 'text-earn' : 'text-spend'}`}>
          {credit ? '+' : '−'}{formatMoney(Math.abs(person.net_cents))}
        </span>
      </div>
      {credit && (
        <p className="mt-1 text-xs text-faint">
          A refund or credit this month outweighs the spending listed below.
        </p>
      )}

      <div className="mt-2.5">
        {categories.length === 0 ? (
          <p className="text-sm text-faint">Nothing spent this month.</p>
        ) : (
          <ShowMore
            items={categories}
            limit={5}
            className="space-y-1"
            render={(c) => (
              <div key={c.category_name} className="flex items-baseline justify-between text-sm">
                <span className="text-muted">{c.category_name}</span>
                <span className="font-mono text-ink tnum">−{formatMoney(Math.abs(c.spend_cents))}</span>
              </div>
            )}
          />
        )}
      </div>
    </div>
  );
}

/**
 * The Spend dialog's mirror of Income's "Other income" Zelle cards
 * (see IncomeDetail.jsx's OtherIncomeCard) — same one-icon/one-amount,
 * name-plus-date layout, same generic Zelle mark rather than the
 * recipient's own photo (avoids the per-card visual noise the Income
 * side already decided against). These rows already sit inside the
 * total above; this only itemizes them, it doesn't add to it.
 */
function ZelleSentCard({ row }) {
  return (
    <div className="rounded-xl border border-rule bg-raised px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <MerchantAvatar description="Zelle" size={32} />
        <span className="font-mono text-sm tnum text-spend">−{formatMoney(Math.abs(row.amount_cents))}</span>
      </div>
      <div className="mt-1.5 flex items-baseline justify-between gap-1.5">
        <span className="min-w-0 truncate text-sm text-ink" title={row.label}>{row.label}</span>
        <span className="shrink-0 text-xs text-faint">{formatShortDate(row.posted_date)}</span>
      </div>
    </div>
  );
}

export function SpendDetail({ month, year, total, yearToDate, spendByMonth, byPerson, byPersonCategory, zelleSent, people = [], onClose }) {
  return (
    <DetailDialog
      title={`Spent in ${month}`}
      emoji="💸"
      tint="bg-vivid-red/10"
      hero={{ label: 'This month', value: `−${formatMoney(total)}`, tone: 'spend' }}
      side={{
        label: `${year} so far`,
        value: `−${formatMoney(Math.abs(yearToDate))}`,
        trend: <MiniTrend months={spendByMonth} valueKey="spend_cents" tone="spend" />,
      }}
      sections={[
        {
          key: 'people',
          label: 'By person',
          count: byPerson.length,
          content: (
            <div className="space-y-3">
              {byPerson.map((person) => (
                <PersonSpendCard
                  key={person.id}
                  person={person}
                  avatarPerson={people.find((p) => p.id === person.id)}
                  categories={byPersonCategory.filter((c) => c.person_id === person.id)}
                />
              ))}
            </div>
          ),
        },
        zelleSent?.length > 0 && {
          key: 'zelle',
          label: 'Zelle sent',
          count: zelleSent.length,
          content: (
            <ShowMore items={zelleSent} limit={6} className="grid grid-cols-2 gap-2.5" render={(row) => <ZelleSentCard key={row.id} row={row} />} />
          ),
        },
      ]}
      onClose={onClose}
    />
  );
}
