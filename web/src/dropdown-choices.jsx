/**
 * Options for the app's Dropdown (D229), each with its round icon badge:
 * the category's own glyph, a card or bank for an account in its bank's
 * colour, a glyph per transaction type with a one-line hint. Kept here so
 * every screen offering the same list shows it the same way.
 */

import { CategoryGlyph } from './category-icons';
import { defaultIconFor } from './category-icon-keys';
import { avatarColorFor, initialsFor } from './merchant-logos';
import { bankBrandFor } from './bankBrands';
import { maskName, shortPersonName, ACCOUNT_TYPES, TXN_TYPE_LABELS } from './api';
import { LoanTypeIcon } from './components/LoanIcons';

const glyph = (key) => <CategoryGlyph iconKey={key} size={13} />;
const NEUTRAL = '#5A5A6B';

/** "All …" / "—" at the top of a list: no group, a plain dot. */
export const blankChoice = (label) => ({ value: '', label, icon: glyph('dot'), color: NEUTRAL });

// The long category list is grouped by what the money did. Matched on the
// lowercased name, first rule wins; anything else is spending.
const CATEGORY_GROUPS = [
  [/uncategori/, 'Other'],
  [/salary|refund|cashback|tax|cash deposit|income/, 'Money in'],
  [/card payment|transfer|zelle|saving|invest|loan/, 'Moving money'],
  [/fee|interest|verification/, 'Fees & interest'],
];
const CATEGORY_GROUP_ORDER = ['Spending', 'Money in', 'Moving money', 'Fees & interest', 'Other'];
const groupOf = (name) => CATEGORY_GROUPS.find(([re]) => re.test(name.toLowerCase()))?.[1] ?? 'Spending';

/** Categories, keyed by id (the ledger) or by name (staged rows and findings). */
export function categoryChoices(categories, { by = 'id' } = {}) {
  const rank = (c) => CATEGORY_GROUP_ORDER.indexOf(groupOf(c.name));
  return [...categories].sort((a, b) => rank(a) - rank(b)).map((c) => ({
    value: by === 'name' ? c.name : String(c.id),
    label: c.name,
    icon: glyph(c.icon_key ?? defaultIconFor(c.name)),
    color: avatarColorFor(c.name),
    group: groupOf(c.name),
  }));
}

const ACCOUNT_KIND = { CREDIT_CARD: ['Cards', 'card'], CHECKING: ['Bank accounts', 'bank'], SAVINGS: ['Savings', 'piggy'], INVESTMENT: ['Investments', 'trend-up'] };

/** Accounts, grouped by kind, in the bank's own colour, with the last four digits. */
export function accountChoices(accounts) {
  const order = Object.keys(ACCOUNT_KIND);
  return [...accounts]
    .sort((a, b) => order.indexOf(a.account_type) - order.indexOf(b.account_type))
    .map((a) => {
      const [group, icon] = ACCOUNT_KIND[a.account_type] ?? ['Other', 'dot'];
      return {
        value: String(a.id),
        label: a.name,
        sub: a.mask ? `··${a.mask}` : null,
        icon: glyph(icon),
        color: a.color ?? bankBrandFor(a.issuer)?.primary ?? avatarColorFor(a.issuer ?? a.name),
        group,
      };
    });
}

/** People: their usual initials badge (Classic keeps no emoji). `short` labels them by nickname, else first name (D237). */
export function personChoices(people, { short = false } = {}) {
  return people.map((p) => ({
    value: String(p.id),
    label: short ? shortPersonName(p.name, p.nickname) : maskName(p.name),
    icon: <span className="text-[0.65rem] font-semibold">{initialsFor(maskName(p.name))}</span>,
    color: avatarColorFor(p.name),
  }));
}

const TYPE_LOOK = {
  purchase: ['bag', 'Money spent at a store'],
  refund: ['undo', 'A store gave money back'],
  payment: ['card', 'Paying off a card'],
  transfer: ['swap', 'Between your own accounts'],
  deposit: ['tray-down', 'Money arriving in a bank account'],
  fee: ['briefcase', 'Charged by the bank or card'],
  interest: ['percent', 'Charged or earned on a balance'],
  cashback: ['tag', 'Rewards the card paid out'],
  savings: ['piggy', 'Moved into savings or investing'],
};
const TYPE_COLOR = { purchase: 'var(--color-spend)', refund: 'var(--color-earn)', deposit: 'var(--color-earn)', cashback: 'var(--color-earn)' };

/** Transaction types, each with a hint saying what it means. */
export const TXN_TYPE_CHOICES = Object.entries(TXN_TYPE_LABELS).map(([value, label]) => ({
  value,
  label,
  hint: TYPE_LOOK[value]?.[1],
  icon: glyph(TYPE_LOOK[value]?.[0] ?? 'dot'),
  color: TYPE_COLOR[value] ?? NEUTRAL,
}));

const ACCOUNT_TYPE_ICON = { CREDIT_CARD: 'card', CHECKING: 'bank', SAVINGS: 'piggy', INVESTMENT: 'trend-up' };
export const ACCOUNT_TYPE_CHOICES = ACCOUNT_TYPES.map((t) => ({ ...t, icon: glyph(ACCOUNT_TYPE_ICON[t.value]), color: NEUTRAL }));

/** Loan types with the Loans page's own icons. */
export const loanTypeChoices = (options) =>
  options.map((o) => ({ ...o, icon: <span className="flex scale-[0.8]"><LoanTypeIcon type={o.value} /></span>, color: NEUTRAL }));

const CADENCE_MARK = { WEEKLY: '1w', BIWEEKLY: '2w', MONTHLY: '1m', QUARTERLY: '3m', ANNUAL: '1y' };
/** Cadences: the badge says how often, so the icon carries information. */
export const cadenceChoices = (options) =>
  options.map((o) => ({ ...o, icon: <span className="font-mono text-[0.6rem] font-medium">{CADENCE_MARK[o.value] ?? '·'}</span>, color: NEUTRAL }));
