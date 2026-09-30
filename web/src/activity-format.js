import { formatMoney } from './api.js';

/**
 * Turns raw audit_log rows into plain language for the Activity page
 * (D142). Pure — no React, no fetches — so activity-format.test.js
 * checks it against real audit detail shapes.
 *
 * `lookup` resolves ids to names using data the app already loaded:
 * { categories, accounts, people } (App.jsx passes them down).
 */

// Every action the app writes today, grouped by what the household
// would call it. Anything new falls back to a readable version of its
// own dotted name, so a future action never shows up blank.
const ACTIONS = {
  'transaction.edited': ['✏️', 'Transaction edited'],
  'transaction.merchant_auto_fixed': ['🪄', 'Merchant name cleaned up'],
  'transaction.approved_despite_duplicate': ['⚠️', 'Approved despite a duplicate'],
  'zelle.reviewed': ['💸', 'Zelle payment reviewed'],
  'import.uploaded': ['📤', 'Statement uploaded'],
  'import.parsed': ['🔍', 'Statement read'],
  'import.parse_failed': ['⛔', 'Statement could not be read'],
  'import.account_confirmed': ['🏦', 'Statement account confirmed'],
  'import.approved': ['✅', 'Transactions approved'],
  'import.deleted': ['🗑️', 'Statement removed'],
  'recurring.created': ['🔁', 'Recurring charge added'],
  'recurring.updated': ['🔁', 'Recurring charge edited'],
  'recurring.linked': ['🔗', 'Payment matched to a recurring charge'],
  'recurring.unlinked': ['✂️', 'Payment unmatched'],
  'recurring.deleted': ['🗑️', 'Recurring charges removed'],
  'recurring.candidate_dismissed': ['🙈', 'Suggested recurring charge dismissed'],
  'merchant_review.approved': ['🏷️', 'Merchant name approved'],
  'merchant_review.dismissed': ['🏷️', 'Merchant suggestion dismissed'],
  'merchant_icon.image_updated': ['🖼️', 'Merchant logo updated'],
  'merchant_icon.image_removed': ['🖼️', 'Merchant logo removed'],
  'merchant_icon.emoji_set': ['😀', 'Merchant emoji set'],
  'account.created': ['💳', 'Account added'],
  'account.updated': ['💳', 'Account edited'],
  'account.image_updated': ['🎨', 'Card image updated'],
  'account.image_removed': ['🎨', 'Card image removed'],
  'category.created': ['🗂️', 'Category added'],
  'category.deleted': ['🗂️', 'Category removed'],
  'category.icon_set': ['🗂️', 'Category icon changed'],
  'loan.created': ['🏦', 'Loan added'],
  'loan.updated': ['🏦', 'Loan edited'],
  'loan.deactivated': ['🏦', 'Loan closed'],
  'contact.updated': ['👤', 'Contact edited'],
  'contact.merged': ['👥', 'Contacts merged'],
  'contact.image_updated': ['👤', 'Contact photo updated'],
  'contact.image_removed': ['👤', 'Contact photo removed'],
  'person.renamed': ['👤', 'Person renamed'],
  'person.created': ['👤', 'Person added'],
  'person.avatar_set': ['🧑', 'Avatar changed'],
  'app_setting.changed': ['⚙️', 'Setting changed'],
  'statement.period_backfilled': ['📄', 'Statement dates filled in'],
};

const words = (s) => s.replace(/_/g, ' ');
const sentence = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function describeAction(action) {
  const known = ACTIONS[action];
  if (known) return { emoji: known[0], label: known[1] };
  const [area, verb = ''] = action.split('.');
  return { emoji: '•', label: sentence(`${words(area)} ${words(verb)}`.trim()) };
}

/** "category_id" → "Category", "amount_cents" → "Amount", "size_bytes" → "Size". */
export function fieldLabel(field) {
  return sentence(words(field.replace(/_(id|cents|bytes)$/, '')));
}

const nameFrom = (list, id) => list?.find((x) => x.id === id)?.name;

/** One value, as a person would read it. */
export function formatValue(field, value, lookup = {}) {
  if (value === null || value === undefined || value === '') return '—';
  if (field.endsWith('_cents') && typeof value === 'number') return formatMoney(value);
  if (field === 'size_bytes' && typeof value === 'number') {
    return value >= 1_048_576 ? `${(value / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(value / 1024))} KB`;
  }
  if (field === 'category_id') return nameFrom(lookup.categories, value) ?? `#${value}`;
  if (field === 'account_id' || field === 'suggested_account_id') return nameFrom(lookup.accounts, value) ?? `#${value}`;
  if (field === 'person_id') return nameFrom(lookup.people, value) ?? `#${value}`;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.length === 0 ? 'none' : value.map((v) => formatValue(field, v, lookup)).join(', ');
  if (typeof value === 'object') return null; // caller renders nested objects as their own list
  return String(value);
}

/**
 * The detail panel's content: `changes` (from → to rows), plus every
 * other fact the entry recorded. `legacyFields` is set for pre-D142
 * edits that only recorded which fields changed, not their values.
 */
export function describeDetail(detail, lookup = {}) {
  const d = detail ?? {};
  const changes = [];
  let legacyFields = null;

  if (d.changes && typeof d.changes === 'object') {
    for (const [field, { from, to }] of Object.entries(d.changes)) {
      changes.push({ label: fieldLabel(field), from: formatValue(field, from, lookup), to: formatValue(field, to, lookup) });
    }
  } else if ('from' in d && 'to' in d) {
    changes.push({ label: 'Name', from: formatValue('from', d.from, lookup), to: formatValue('to', d.to, lookup) });
  } else if (Array.isArray(d.changed)) {
    legacyFields = d.changed.map(fieldLabel);
  }

  const facts = [];
  for (const [field, value] of Object.entries(d)) {
    if (['changes', 'changed', 'from', 'to'].includes(field)) continue;
    const text = formatValue(field, value, lookup);
    facts.push(text === null ? { label: fieldLabel(field), nested: value } : { label: fieldLabel(field), value: text });
  }

  return { changes, legacyFields, facts };
}

/** The one-line "what" beside an action: the name of the thing it touched, when the entry recorded one. */
export function subjectOf(entry) {
  const d = entry.detail ?? {};
  const name =
    d.name ?? d.merchant ?? d.series_name ?? d.zelle_person ?? d.original_filename ?? d.to ?? d.description ?? d.key ??
    entry.subject ?? null;
  const entity = entry.entity_type
    ? `${sentence(words(entry.entity_type))}${entry.entity_id != null ? ` #${entry.entity_id}` : ''}`
    : null;
  return { name, entity };
}
