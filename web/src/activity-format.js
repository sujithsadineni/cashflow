import { formatMoney, TXN_TYPE_LABELS } from './api.js';

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
  'recurring.suggestion_ignored': ['🙈', 'Suggested recurring charge ignored'],
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
  'statement.promos_backfilled': ['📄', 'Promo rates read off statements'],
  'transaction.verification_marked': ['🔎', 'Verification deposit marked'],
  'transaction_review.run': ['🔄', 'Transactions re-checked'],
  'transaction_review.approved': ['✅', 'Review fix approved'],
  'transaction_review.dismissed': ['🙈', 'Review finding kept as is'],
  'transaction_review.undone': ['↩️', 'Review fix undone'],
  'payment_match.run': ['🔗', 'Card payments matched to their source'],
  'payment_match.set': ['✋', 'Payment source set by hand'],
  'payment_match.cleared': ['↩️', 'Payment source handed back to matching'],
  'loan.suggestion_dismissed': ['🙈', 'Loan suggestion dismissed'],
  'account.balance_recorded': ['💰', 'Balance entered'],
  'account.deactivated': ['💳', 'Account closed'],
  'person.nickname_set': ['👤', 'Nickname set'],
  'backup.created': ['💾', 'Backup made'],
  'schema.migrated': ['🗄️', 'Database updated'],
  'import.claude_approved': ['🤖', 'Reading with Claude allowed'],
  'import.rows_recovered': ['🧩', 'Missing rows added'],
  'statement.balances_corrected': ['📄', 'Statement balances corrected'],
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
  return sentence(words(String(field).replace(/_(id|cents|bytes)$/, '')));
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
  if (Array.isArray(value)) {
    if (value.length === 0) return 'none';
    // A list of records (a run's "changed" rows, D199) is counted, not spelled out.
    if (value.some((v) => v !== null && typeof v === 'object')) return `${value.length} item${value.length === 1 ? '' : 's'}`;
    return value.map((v) => formatValue(field, v, lookup)).join(', ');
  }
  if (typeof value === 'object') return null; // caller renders nested objects as their own list
  return String(value);
}

/**
 * The detail panel's content: `changes` (from → to rows), plus every
 * other fact the entry recorded. `legacyFields` is set for pre-D142
 * edits that only recorded which fields changed, not their values.
 */
const isRecord = (v) => v !== null && typeof v === 'object';

export function describeDetail(detail, lookup = {}) {
  const d = detail ?? {};
  const changes = [];
  let legacyFields = null;

  if (d.changes && typeof d.changes === 'object') {
    for (const [field, { from, to }] of Object.entries(d.changes)) {
      changes.push({ label: fieldLabel(field), from: formatValue(field, from, lookup), to: formatValue(field, to, lookup) });
    }
  } else if ('from' in d && 'to' in d && !isRecord(d.from) && !isRecord(d.to)) {
    changes.push({ label: 'Name', from: formatValue('from', d.from, lookup), to: formatValue('to', d.to, lookup) });
  } else if (Array.isArray(d.changed) && d.changed.length > 0 && d.changed.every((f) => typeof f === 'string')) {
    // An empty list (a run that changed nothing) isn't a legacy edit: no "Changed:" with nothing under it.
    legacyFields = d.changed.map(fieldLabel);
  }
  // Which keys were already shown above; any other shape (a from/to that are
  // records, a "changed" list of rows) falls through to the facts below.
  const shown = new Set(['changes']);
  if (changes.length > 0 && !d.changes) ['from', 'to'].forEach((k) => shown.add(k));
  if (Array.isArray(d.changed) && d.changed.every((f) => typeof f === 'string')) shown.add('changed');

  const facts = [];
  for (const [field, value] of Object.entries(d)) {
    if (shown.has(field)) continue;
    const text = formatValue(field, value, lookup);
    facts.push(text === null ? { label: fieldLabel(field), nested: value } : { label: fieldLabel(field), value: text });
  }

  return { changes, legacyFields, facts };
}

/** The one-line "what" beside an action: the name of the thing it touched, when the entry recorded one. */
export function subjectOf(entry) {
  const d = entry.detail ?? {};
  // A Review fix names what it set, in words: "Type → Purchase", not "purchase" (D253).
  if (String(entry.action).startsWith('transaction_review.') && d.field) {
    const shown = d.to == null ? 'None'
      : d.field === 'txn_type' ? TXN_TYPE_LABELS[d.to] ?? d.to
      : d.field === 'amount' ? formatMoney(Number(d.to), { showSign: true })
      : d.to;
    const label = { txn_type: 'Type', category: 'Category', amount: 'Amount' }[d.field] ?? fieldLabel(d.field);
    const entity = entry.entity_type ? `${sentence(words(entry.entity_type))}${entry.entity_id != null ? ` #${entry.entity_id}` : ''}` : null;
    return { name: `${label} → ${shown}`, entity };
  }
  // Only text can be a name: some entries store records under these keys (D199).
  const text = (v) => (typeof v === 'string' || typeof v === 'number' ? v : null);
  const name =
    text(d.name) ?? text(d.merchant) ?? text(d.series_name) ?? text(d.zelle_person) ?? text(d.original_filename) ??
    text(d.to) ?? text(d.description) ?? text(d.key) ?? text(entry.subject) ?? null;
  const entity = entry.entity_type
    ? `${sentence(words(entry.entity_type))}${entry.entity_id != null ? ` #${entry.entity_id}` : ''}`
    : null;
  return { name, entity };
}
