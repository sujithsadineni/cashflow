import { formatMoney, formatShortDate, maskName } from '../api';
import { MiniTrend } from './MiniTrend';
import { PersonAvatar } from './ui/PersonAvatar';
import { DetailDialog, ShowMore } from './ui/DetailDialog';
import { MerchantAvatar } from './MerchantAvatar';

/**
 * The Income card's drill-down. Renamed from "Salary" because that
 * name was actively misleading — the figure includes a tax refund, a
 * cash deposit, anything else that's real new money in, not just
 * payroll (D47's fix made the definition precise; this makes the
 * label match it). Two sections answer "where did this come from":
 * Salary, broken down per person with the real paycheck transactions
 * behind it (so one person's two-paycheck month and the other's one-paycheck
 * month are just visible, not summarized away), and Other income for
 * everything else that landed as a deposit that month.
 *
 * A male/female icon pair (`PersonIcons.jsx`) replaces the emoji from
 * the previous pass — asked for directly, after seeing it rendered.
 * This app's own design notes avoid emoji everywhere else; icons keep
 * this dialog inside that line instead of carving out a second
 * exception.
 *
 * `yearToDate` is a single running total (Jan 1 through the end of
 * the selected month), not a full year browser like Savings got
 * (D46) — that's a heavier feature than what was actually asked for
 * ("where should total income so far go"); a fuller year view is an
 * easy follow-up if it turns out to be wanted later.
 *
 * The "so far this year" field went through a round of real style
 * options (a tinted tile, a plain caption, a side-by-side split, a
 * version with a small trend) before landing on the trend version —
 * `MiniTrend` draws real January-through-this-month income per
 * month (`incomeByMonth`, from `GET /api/summary`), never synthetic
 * bars, with the current month picked out at full opacity.
 */


function PersonSalaryRow({ person, avatarPerson, lines }) {
  return (
    <div className="rounded-lg border border-rule p-4">
      <div className="flex items-baseline justify-between">
        <div className="flex items-center gap-2">
          <PersonAvatar person={avatarPerson ?? person} size={28} />
          <span className="text-ink">{maskName(person.name)}</span>
        </div>
        <span className="font-mono text-lg text-earn tnum">{formatMoney(person.salary_cents)}</span>
      </div>

      <div className="mt-2.5 space-y-1">
        {lines.length === 0 ? (
          <p className="text-sm text-faint">No paycheck posted yet this month.</p>
        ) : (
          lines.map((l) => (
            <div key={l.id} className="flex items-baseline justify-between text-sm">
              <span className="text-muted">{formatShortDate(l.posted_date)} · {l.merchant}</span>
              <span className="font-mono text-ink tnum">{formatMoney(l.amount_cents)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// A category-by-category emoji, direct exception to this app's usual
// no-emoji rule (same exception Recurring's own glyphs already are) —
// asked for specifically here, to turn a dense description-heavy list
// into something scannable at a glance. Unmapped categories fall back
// to a plain money icon rather than guessing.
const OTHER_INCOME_ICONS = {
  'Cash Deposit': '💵',
  Interest: '📈',
  'Tax-Refund': '🧾',
  Refund: '↩️',
  Cashback: '💳',
  Savings: '🏦',
};

/**
 * One card, two lines: icon + amount on top, name (+ a small date) below.
 * Direct feedback on the first pass (icon/name/date/amount, each its
 * own line, centered): the Zelle mark reads better here than a
 * contact's colored initial/photo — those repeat per person and get
 * visually noisy across several cards for the same name, where the
 * one consistent Zelle mark doesn't. The name shown is still the
 * live contact name/nickname (a rename still shows up here
 * immediately, no transaction touched) — only the icon choice
 * changed, not where the label comes from. Date is folded into the
 * name line rather than dropped: two cards for the same repeat payer
 * (a real case — two senders sharing a first name) would
 * otherwise be identical but for the amount.
 */
// Nickname first if one's set; otherwise just the first name, not the
// full one — "Christopher Allen Bennett" doesn't fit a card without
// truncating to "Christopher ...", and a first name reads cleaner than
// an ellipsis. Category labels (Cash Deposit, Interest, ...) are
// already short and go through untouched.
const firstName = (name) => name.trim().split(/\s+/)[0];

function OtherIncomeCard({ row }) {
  const isZelle = !row.merchant && row.category_name?.startsWith('Zelle from ');
  const contact = row.contact_id ? { id: row.contact_id, name: row.contact_name, nickname: row.contact_nickname, image_path: row.contact_image_path } : null;
  const label = contact
    ? (contact.nickname || firstName(contact.name))
    : isZelle ? firstName(row.category_name.slice('Zelle from '.length)) : row.category_name;

  return (
    <div className="rounded-xl border border-rule bg-raised px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        {isZelle ? (
          <MerchantAvatar description={row.description} size={32} />
        ) : (
          <span className="flex size-7 items-center justify-center rounded-full bg-band text-base">
            {OTHER_INCOME_ICONS[row.category_name] ?? '💰'}
          </span>
        )}
        <span className="font-mono text-sm tnum text-earn">{formatMoney(row.amount_cents)}</span>
      </div>
      <div className="mt-1.5 flex items-baseline justify-between gap-1.5">
        <span className="min-w-0 truncate text-sm text-ink" title={label}>{label}</span>
        <span className="shrink-0 text-xs text-faint">{formatShortDate(row.posted_date)}</span>
      </div>
    </div>
  );
}

export function IncomeDetail({ month, year, total, yearToDate, incomeByMonth, byPerson, salaryLines, otherIncome, people = [], onClose }) {
  return (
    <DetailDialog
      title={`Income in ${month}`}
      emoji="💰"
      tint="bg-vivid-green/10"
      hero={{ label: 'This month', value: formatMoney(total), tone: 'earn' }}
      side={{
        label: `${year} so far`,
        value: formatMoney(yearToDate),
        trend: <MiniTrend months={incomeByMonth} valueKey="income_cents" tone="earn" />,
      }}
      sections={[
        {
          key: 'salary',
          label: 'Salary',
          count: byPerson.length,
          content: (
            <div className="space-y-3">
              {byPerson.map((person) => (
                <PersonSalaryRow
                  key={person.id}
                  person={person}
                  avatarPerson={people.find((p) => p.id === person.id)}
                  lines={salaryLines.filter((l) => l.person_id === person.id)}
                />
              ))}
            </div>
          ),
        },
        otherIncome.length > 0 && {
          key: 'other',
          label: 'Other income',
          count: otherIncome.length,
          content: (
            <ShowMore items={otherIncome} limit={6} className="grid grid-cols-2 gap-2.5" render={(row) => <OtherIncomeCard key={row.id} row={row} />} />
          ),
        },
      ]}
      onClose={onClose}
    />
  );
}
