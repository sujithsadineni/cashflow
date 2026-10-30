/**
 * Glass Activity (D247): each action's glyph (an Ionicons name, drawn by
 * glass-activity-glyphs.jsx) and its tile colour. Colour says which part of
 * the app acted; red marks something that failed or was removed. Pure, so
 * it's tested beside activity-format.js. Classic and Vivid keep their emoji.
 */

// Apple's system colours, one per area of the app.
export const TONES = {
  transactions: '#34C759',
  imports: '#007AFF',
  recurring: '#AF52DE',
  merchants: '#FF2D55',
  money: '#FF9500',
  categories: '#5856D6',
  people: '#30B0C7',
  system: '#8E8E93',
  alert: '#FF3B30',
};

const AREA_TONE = {
  transaction: 'transactions', transaction_review: 'transactions', payment_match: 'transactions', transfer_match: 'transactions', statement_gap: 'imports', zelle: 'transactions',
  import: 'imports', statement: 'imports',
  recurring: 'recurring',
  merchant_review: 'merchants', merchant_icon: 'merchants',
  account: 'money', loan: 'money', reward: 'money',
  category: 'categories',
  contact: 'people', person: 'people',
};

const ICONS = {
  'transaction.edited': 'create',
  'transaction.merchant_auto_fixed': 'color-wand',
  'transaction.approved_despite_duplicate': 'warning',
  'transaction.duplicate_removed': 'trash',
  'duplicate.both_real': 'checkmark-done',
  'reward.redeemed': 'gift',
  'reward.redemption_updated': 'gift',
  'reward.redemption_voided': 'trash',
  'transaction.verification_marked': 'search',
  'transaction_review.run': 'sync',
  'transaction_review.queued': 'checkmark-done',
  'transaction_review.approved': 'checkmark-done',
  'transaction_review.dismissed': 'eye-off',
  'transaction_review.undone': 'arrow-undo',
  'payment_match.run': 'link',
  'transfer_match.run': 'link',
  'statement_gap.answered': 'calendar',
  'account.dates_learned': 'calendar',
  'statement.dates_read': 'calendar',
  'statement.opening_corrected': 'receipt',
  'statement.period_corrected': 'calendar',
  'statement.restored': 'calendar',
  'statement.card_read': 'card',
  'statement.rewards_read': 'receipt',
  'assistant.asked': 'color-wand',
  'assistant.claude_failed': 'warning',
  'assistant.answered': 'color-wand',
  'assistant.seen': 'color-wand',
  'assistant.dismissed': 'color-wand',
  'statement_gap.unanswered': 'arrow-undo',
  'payment_match.set': 'hand-left',
  'payment_match.cleared': 'arrow-undo',
  'zelle.reviewed': 'cash',
  'import.uploaded': 'cloud-upload',
  'import.parsed': 'document-text',
  'import.parse_failed': 'alert',
  'import.account_confirmed': 'business',
  'import.approved': 'checkmark-done',
  'import.deleted': 'trash',
  'statement.period_backfilled': 'calendar',
  'statement.promos_backfilled': 'document-text',
  'recurring.created': 'repeat',
  'recurring.updated': 'repeat',
  'recurring.linked': 'link',
  'recurring.unlinked': 'unlink',
  'recurring.rechecked': 'refresh',
  'recurring.deleted': 'trash',
  'recurring.candidate_dismissed': 'eye-off',
  'recurring.suggestion_ignored': 'eye-off',
  'recurring.suggestion_restored': 'arrow-undo',
  'merchant_review.approved': 'pricetag',
  'merchant_review.dismissed': 'pricetag',
  'merchant_icon.image_updated': 'image',
  'merchant_icon.image_removed': 'image',
  'merchant_icon.emoji_set': 'happy',
  'account.created': 'card',
  'account.updated': 'card',
  'account.dates_changed': 'calendar',
  'alert.answered': 'alert',
  'alert.unanswered': 'alert',
  'account.address_read': 'document-text',
  'statement.address_read': 'document-text',
  'statement.member_since_read': 'calendar',
  'transaction.retyped': 'create',
  'staged_transaction.retyped': 'create',
  'merchant.tidied': 'color-wand',
  'merchant.tidy_undone': 'arrow-undo',
  'pdf_password.saved': 'eye-off',
  'pdf_password.forgotten': 'trash',
  'pdf_password.relabelled': 'create',
  'staged_transaction.skipped': 'eye-off',
  'staged_transaction.restored': 'arrow-undo',
  'account.image_updated': 'color-palette',
  'account.image_removed': 'color-palette',
  'loan.created': 'wallet',
  'loan.updated': 'wallet',
  'loan.deactivated': 'wallet',
  'loan.suggestion_dismissed': 'eye-off',
  'category.created': 'folder',
  'category.deleted': 'trash',
  'category.icon_set': 'shapes',
  'contact.updated': 'person',
  'contact.merged': 'people',
  'contact.marked_distinct': 'people',
  'contact.removed': 'person',
  'contact.image_updated': 'person',
  'contact.image_removed': 'person',
  'person.renamed': 'person',
  'person.created': 'person-add',
  'person.avatar_set': 'person',
  'app_setting.changed': 'settings',
  'backup.created': 'archive',
  'schema.migrated': 'server',
  'account.balance_recorded': 'wallet',
  'account.deactivated': 'card',
  'account.member_added': 'people',
  'account.member_changed': 'people',
  'account.member_undone': 'arrow-undo',
  'transaction.spenders_read': 'people',
  'statement.facts_read': 'document-text',
  'person.nickname_set': 'person',
  'import.claude_approved': 'document-text',
  'import.rows_recovered': 'add-circle',
  'statement.balances_corrected': 'document-text',
};

/**
 * The toolbar's filters and Refresh (D248), each in the colour its rows use,
 * so a filter and the rows it leaves read as one thing.
 */
export const AREA_GLYPHS = {
  all: { icon: 'albums', color: TONES.categories },
  transactions: { icon: 'receipt', color: TONES.transactions },
  imports: { icon: 'cloud-upload', color: TONES.imports },
  recurring: { icon: 'repeat', color: TONES.recurring },
  setup: { icon: 'settings', color: TONES.system },
  refresh: { icon: 'refresh', color: TONES.people },
};

/** Every Ionicons name this file can return, for the glyph generator. */
export const ACTIVITY_ICON_NAMES = [...new Set([...Object.values(ICONS), ...Object.values(AREA_GLYPHS).map((g) => g.icon), 'ellipse'])];

const ALERTS = /(\.deleted|\.parse_failed|\.approved_despite_duplicate)$/;

/** Which of TONES an action's rows wear: its area's, or alert for a deletion or a failure. Vivid paints the same tones in its own palette (D395). */
export function activityTone(action) {
  const area = String(action).split('.')[0];
  return ALERTS.test(action) ? 'alert' : AREA_TONE[area] ?? 'system';
}

export function activityGlyph(action) {
  const icon = ICONS[action] ?? 'ellipse';
  return { icon, color: TONES[activityTone(action)] };
}

/**
 * A day's heading, as Apple's lists write them: "Today", "Yesterday", the
 * weekday within the last week, else "Monday, October 12" (with the year
 * when it isn't this year). Both dates are local.
 */
export function dayLabel(date, now = new Date()) {
  const start = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((start(now) - start(date)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days > 1 && days < 7) return date.toLocaleDateString('en-US', { weekday: 'long' });
  return date.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
    ...(date.getFullYear() !== now.getFullYear() && { year: 'numeric' }),
  });
}
