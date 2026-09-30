import { formatMoney } from '../api';
import { MiniTrend } from './MiniTrend';
import { DetailDialog, ShowMore, BarRow } from './ui/DetailDialog';

/**
 * The Savings card's drill-down — same minimal shape as Income and
 * Spend (D51/D54), not the year-browser this used to be (D46). That
 * dialog answered a question nobody asked twice; this one matches
 * what Income/Spend already settled on: this month, plus a running
 * total for the year with a trend alongside it.
 *
 * Savings is now derived, not tracked — income minus spend minus real
 * debt repayment (see the comment in routes/summary.js) — so there's
 * no separate ledger to browse and no per-account split to show
 * (household call: "let's do a single savings for now"). The old
 * SAVINGS-account / txn_type='savings' tagging this replaced is gone
 * from this dialog entirely; a month recalculates the instant a
 * statement is uploaded or a transaction is recategorized.
 *
 * A month can go negative — spending more than came in, or a real
 * debt payment outweighing it — and this shows that as a plain
 * negative number rather than flooring at zero, per explicit
 * instruction: the household wants to see it coming once a
 * balance-transfer loan's payments start pulling the total down.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const signed = (cents) => `${cents < 0 ? '−' : cents > 0 ? '+' : ''}${formatMoney(Math.abs(cents))}`;

export function SavingsDetail({ month, year, total, yearToDate, savingsByMonth, onClose }) {
  const max = Math.max(1, ...savingsByMonth.map((m) => Math.abs(m.savings_cents)));
  // Newest first: the month just picked is what someone opened this to see.
  const months = [...savingsByMonth].reverse();

  return (
    <DetailDialog
      title={`Saved in ${month}`}
      emoji="📈"
      tint="bg-vivid-purple/10"
      hero={{ label: 'This month', value: signed(total), tone: total < 0 ? 'spend' : 'earn' }}
      side={{
        label: `${year} so far`,
        value: signed(yearToDate),
        tone: yearToDate < 0 ? 'spend' : 'ink',
        trend: <MiniTrend months={savingsByMonth} valueKey="savings_cents" tone={yearToDate < 0 ? 'spend' : 'earn'} />,
      }}
      sections={[
        {
          key: 'months',
          label: `${year}, month by month`,
          content: (
            <ShowMore
              items={months}
              limit={6}
              render={(m) => (
                <BarRow
                  key={m.month}
                  label={`${MONTHS[Number(m.month.slice(5, 7)) - 1]} ${m.month.slice(0, 4)}`}
                  amount={m.savings_cents}
                  max={max}
                  formatted={signed(m.savings_cents)}
                  tone={m.savings_cents < 0 ? 'spend' : 'earn'}
                />
              )}
              className="flex flex-col gap-2.5"
            />
          ),
        },
      ]}
      note="Income minus spend, minus any real loan or debt payment that month — a single household total, not split by person or account."
      onClose={onClose}
    />
  );
}
