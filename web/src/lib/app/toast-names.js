/**
 * Every toast the app raises, by key (D384, names rethought D386): its group
 * in Settings → Notifications, its kind, its names and where it shows.
 *
 * The rule: a name is the thing and what happened to it ("Account closed",
 * "Fix saved", "Row skipped"), or "Couldn't …" when it failed. It never holds a
 * file, account or amount; those go in the line under it, so a name reads the
 * same every time and can be renamed. Errors share keys, so renaming "Couldn't
 * save" renames it wherever saving fails.
 *
 * Each design says it its own way (owner's ask, D386):
 *   - Classic: `name`, a plain sentence ("Account closed").
 *   - Glass: Apple's Title Case of it, worked out ("Account Closed").
 *   - Vivid: `friendly`, warmer and a little longer ("Card tucked away"), with
 *     `emoji` in its tile. Errors stay clear: friendly, never a joke about money.
 * The household can rename any toast in any design; renames are kept per design
 * in app_setting `toast_names` as { classic: { key: name }, glass: {…}, vivid: {…} }.
 */

export const TOAST_GROUPS = [
  { key: 'saved', label: 'Saved and changed' },
  { key: 'added', label: 'Added' },
  { key: 'removed', label: 'Removed and closed' },
  { key: 'statements', label: 'Statements' },
  { key: 'review', label: 'Review' },
  { key: 'undone', label: 'Undone' },
  { key: 'problems', label: "Couldn't do it" },
];

const t = (group, name, friendly, emoji, where, example, extra = {}) =>
  ({ group, name, friendly, emoji, where, example, type: group === 'problems' ? 'error' : 'success', ...extra });
const UNDO = { action: 'Undo' };

export const TOASTS = {
  // Saved and changed
  'txn.category': t('saved', 'Category changed', 'Moved to a new category', '🏷️', 'Transactions, Cards', 'Costco → Groceries', UNDO),
  'txn.type': t('saved', 'Type changed', 'Type updated', '🔁', 'Transactions', 'Costco → Purchase', UNDO),
  'txn.merchant': t('saved', 'Name changed', 'Name tidied up', '✏️', 'Transactions, Cards', 'COSTCO WHSE #1234 → Costco', UNDO),
  'txn.paid_with': t('saved', 'Payment changed', 'Payment noted', '💳', 'Cards', 'Costco → Paid from checking', UNDO),
  'txn.source': t('saved', 'Payment source saved', 'Got it, source saved', '🧾', 'Transactions', 'Paid back by a person'),
  'account.saved': t('saved', 'Account saved', 'Account all set', '🏦', 'Settings → Accounts', 'Freedom Unlimited ···1234'),
  'account.balance': t('saved', 'Balance saved', 'Balance noted', '💰', 'Settings → Accounts, Overview', 'Savings ···5678'),
  'account.merged': t('saved', 'Accounts merged', 'Two cards, one account', '🔗', 'Settings → Accounts', 'Cash Rewards ···5207 is now part of ···5208'),
  'account.members': t('saved', 'Card holders changed', 'Card holders updated', '👥', 'Settings → Accounts', 'Added as an authorised user', UNDO),
  'loan.saved': t('saved', 'Loan saved', 'Loan all set', '📝', 'Settings → Loans', 'Car loan'),
  'loan.owed': t('saved', 'Amount owed saved', 'Amount owed noted', '📉', 'Settings → Loans', 'Car loan'),
  'loan.suggestion_hidden': t('saved', 'Suggestion hidden', "Won't suggest that again", '🙈', 'Settings → Loans', "Won't be suggested again"),
  'person.saved': t('saved', 'Person saved', 'Profile updated', '🙂', 'Settings → People, Overview', 'Alex'),
  'person.nickname': t('saved', 'Nickname saved', 'Nickname set', '🏷️', 'Overview', 'Al'),
  'contact.saved': t('saved', 'Contact saved', 'Contact updated', '📇', 'Settings → People', 'Nickname'),
  'contacts.merged': t('saved', 'Contacts merged', 'Two became one', '🤝', 'Settings → People', 'Into Alex'),
  'contacts.kept': t('saved', 'Contacts kept apart', 'Kept them separate', '↔️', 'Settings → People', 'Two different people'),
  'category.icon': t('saved', 'Icon changed', 'Fresh new icon', '🎨', 'Settings → Categories', 'Groceries'),
  'merchant.renamed': t('saved', 'Merchant renamed', 'New name, same shop', '🏪', 'Settings → Merchants', 'Costco Wholesale → Costco', UNDO),
  'merchant.merged': t('saved', 'Merchants merged', 'Merged into one', '🧲', 'Settings → Merchants', 'Costco Gas into Costco', UNDO),
  'merchant.logo': t('saved', 'Logo saved', 'Looking sharp', '✨', 'Settings → Merchants', 'Costco', UNDO),
  'photo.added': t('saved', 'Photo added', 'Nice photo', '📸', 'Cards, Settings → People', 'Freedom Unlimited'),
  'gift.updated': t('saved', 'Gift card updated', 'Gift card updated', '🎁', 'Overview → Savings', 'Starbucks'),
  'bill.updated': t('saved', 'Bill updated', 'Bill updated', '🗓️', 'Recurring', 'Phone bill paused', UNDO),
  'bill.restored': t('saved', 'Bill suggested again', "It's back on the list", '↩️', 'Recurring', 'If it still looks like a bill'),
  'alert.snoozed': t('saved', 'Alert snoozed', 'Snoozed for now', '😴', 'Alerts', 'Statement due · for 7 days', UNDO),
  'alert.paid': t('saved', 'Alert marked paid', 'Paid, nicely done', '✅', 'Alerts', 'Phone bill', UNDO),
  'alert.dismissed': t('saved', 'Alert dismissed', 'Out of sight', '👋', 'Alerts', 'Phone bill', UNDO),
  'gap.none': t('saved', 'No statement noted', 'Noted, nothing that month', '🗒️', 'Alerts', 'Freedom Unlimited · no statement for March'),
  'gap.asked': t('saved', 'Reminder back on', "I'll keep asking", '🔔', 'Alerts', 'Freedom Unlimited · March'),
  'password.saved': t('saved', 'Password remembered', 'Password remembered', '🔑', 'Settings → Privacy', 'Statements it opens will open by themselves'),
  'backup.done': t('saved', 'Backed up', 'Safe and sound', '🛟', 'Settings → Backups', 'A copy of everything is saved'),
  'toast.renamed': t('saved', 'Notification renamed', 'Renamed it', '🔖', 'Settings → Notifications', 'Account closed → Card closed', UNDO),

  // Added
  'account.added': t('added', 'Account added', 'New account, welcome', '🎉', 'Settings → Accounts', 'Freedom Unlimited ···1234'),
  'loan.added': t('added', 'Loan added', 'Loan added', '📋', 'Settings → Loans, Overview', 'Car loan'),
  'loan.from_statement': t('added', 'Added to loans', 'Now tracking it in Loans', '📌', 'Settings → Accounts', 'Plan It · 6 payments', { action: 'Loans' }),
  'loan.transfer_tracked': t('added', 'Transfer tracked', 'Tracking that transfer', '📈', 'Overview → Loans', 'Freedom Unlimited', { action: 'Loans' }),
  'person.added': t('added', 'Person added', 'Welcome to the household', '👋', 'Settings → People', 'Alex'),
  'category.added': t('added', 'Category added', 'New category ready', '🗂️', 'Settings → Categories', 'Pets'),
  'gift.added': t('added', 'Gift card added', 'Gift card stashed', '🎁', 'Overview → Savings', 'Starbucks'),
  'bill.added': t('added', 'Bill added', 'Bill on the calendar', '📆', 'Recurring', 'Netflix · edit it any time'),

  // Removed and closed
  'account.closed': t('removed', 'Account closed', 'Card tucked away', '🔒', 'Settings → Accounts', 'Freedom Unlimited ···1234', UNDO),
  'account.reopened': t('removed', 'Account reopened', 'Back in action', '🔓', 'Settings → Accounts', 'Freedom Unlimited ···1234'),
  'loan.closed': t('removed', 'Loan closed', 'Loan closed out', '🏁', 'Settings → Loans', 'Car loan', UNDO),
  'loan.reopened': t('removed', 'Loan reopened', 'Loan back on', '🔁', 'Settings → Loans', 'Car loan'),
  'category.deleted': t('removed', 'Category deleted', 'Category gone', '🗑️', 'Settings → Categories', 'Pets'),
  'gift.removed': t('removed', 'Gift card removed', 'Gift card removed', '🗑️', 'Overview → Savings', 'Starbucks'),
  'photo.removed': t('removed', 'Photo removed', 'Photo removed', '🖼️', 'Cards, Settings → People', 'Freedom Unlimited'),
  'bill.hidden': t('removed', 'Bill hidden', 'Bill hidden', '🙈', 'Recurring', "Netflix won't be suggested again"),
  'txn.source_cleared': t('removed', 'Payment source cleared', 'Source cleared', '🧹', 'Transactions', 'Costco'),
  'upload.deleted': t('removed', 'Upload deleted', 'Upload cleared away', '🗑️', 'Import', 'Its rows went with it'),

  // Statements
  'statement.read': t('statements', 'Statement read', 'Read it, all done', '📄', 'Import, Alerts', 'march-2026.pdf', { action: 'Review' }),
  'statement.unlocked': t('statements', 'Statement unlocked', 'Unlocked and read', '🔓', 'Import', 'march-2026.pdf · with a remembered password'),
  'statement.on_file': t('statements', 'Statement already on file', 'Seen this one before', '📎', 'Import', 'march-2026.pdf · showing that one', { type: 'info' }),
  'statement.account': t('statements', 'Account confirmed', 'Right account, confirmed', '✅', 'Import, Review', 'On Freedom Unlimited ···1234'),
  'statement.saved': t('statements', 'Statement saved', 'All saved!', '🎉', 'Review', '42 rows'),
  'statement.found': t('statements', 'Also found in statement', 'Spotted a few more things', '🔍', 'Review', '2 payments matched · Netflix charged', { action: 'Show' }),
  'statement.fixed': t('statements', 'Statement fixed', 'Fixed it', '🛠️', 'Review', 'Freedom Unlimited · sign flipped'),
  'statement.rows_added': t('statements', 'Missing rows added', 'Filled in the gaps', '🧩', 'Review', '3 missing rows'),
  'statement.balances': t('statements', 'Balances updated', 'Balances squared away', '⚖️', 'Review', 'From the statement'),

  // Review
  'review.saved': t('review', 'Fix saved', 'Fixed!', '✨', 'Review', 'Costco +2 more', UNDO),
  'review.kept': t('review', 'Finding kept as is', 'Left it as is', '👌', 'Review', 'Costco', UNDO),
  'review.approved': t('review', 'Row approved', 'Approved', '👍', 'Review', 'COSTCO WHSE #1234'),
  'review.skipped': t('review', 'Row skipped', 'Skipped that one', '⏭️', 'Review', 'Costco', UNDO),
  'review.checked': t('review', 'Review rechecked', 'Double-checked everything', '🔎', 'Review', '1,812 rows · nothing new to fix'),
  'review.name_approved': t('review', 'Merchant name approved', 'Good name', '👍', 'Review', 'Costco'),
  'review.name_kept': t('review', 'Merchant name kept', 'Kept the old name', '👌', 'Review', 'COSTCO WHSE #1234'),
  'review.duplicate_removed': t('review', 'Duplicate removed', 'Duplicate gone', '✂️', 'Review', 'Costco · $54.20'),
  'review.duplicate_kept': t('review', 'Both kept', 'Kept both', '👯', 'Review', 'Costco · $54.20'),
  'bills.checked': t('review', 'Bills rechecked', 'Bills double-checked', '🔎', 'Recurring', '2 charges matched · no new bills'),

  // Undone
  'undo.done': t('undone', 'Undone', 'Undone, no harm done', '↩️', 'Settings → Accounts, Merchants', 'Costco is back'),

  // Couldn't do it
  'error.save': t('problems', "Couldn't save", "Oops, that didn't save", '🙈', 'Anywhere a change is saved', 'The server said no'),
  'error.undo': t('problems', "Couldn't undo", "Couldn't take that back", '😬', 'Review, Settings → Merchants', 'The server said no'),
  'error.read': t('problems', "Couldn't read statement", "Couldn't make sense of it", '🤔', 'Import, Alerts', 'march-2026.pdf: not a statement'),
  'error.locked': t('problems', 'Password needed', "It's locked", '🔐', 'Import', 'march-2026.pdf · enter it under the boxes'),
  'error.still_locked': t('problems', 'Still locked', 'Still locked, try again', '🔐', 'Import', 'That password didn’t open it'),
  'error.claude': t('problems', "Claude couldn't read it", 'Claude got stuck', '🤖', 'Import', 'The request timed out'),
  'error.update': t('problems', "Couldn't update", "That didn't update", '😬', 'Recurring', 'Netflix: the server said no'),
  'error.check': t('problems', "Couldn't recheck", "Couldn't double-check", '😬', 'Review, Recurring', 'The server said no'),
  'error.rename': t('problems', "Couldn't rename", "The name didn't stick", '😬', 'Review', 'The server said no'),
  'error.fix': t('problems', "Couldn't fix", "Couldn't fix that", '🛠️', 'Review', 'The server said no'),
  'error.close': t('problems', "Couldn't close", "It won't close", '🚪', 'Settings → Accounts, Loans', 'Freedom Unlimited: the server said no'),
  'error.reopen': t('problems', "Couldn't reopen", "It won't reopen", '🚪', 'Settings → Accounts, Loans', 'Freedom Unlimited: the server said no'),
  'error.add': t('problems', "Couldn't add", "Couldn't add that", '😬', 'Settings → Accounts', 'The server said no'),
  'error.merge': t('problems', "Couldn't merge", "Those won't merge", '🧲', 'Settings → People', 'The server said no'),
  'error.hide': t('problems', "Couldn't hide", "Couldn't hide that", '🙈', 'Settings → Loans', 'The server said no'),
  'error.app': t('problems', 'Something went wrong', 'Something went sideways', '🌀', 'Anywhere', 'The server is not answering'),
};

export const TOAST_NAMES_SETTING_KEY = 'toast_names';
export const MAX_NAME = 40;
export const NAME_DESIGNS = ['classic', 'glass', 'vivid'];

// Apple's title case: every word capitalised but the short joining ones, unless first.
const MINOR = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'nor', 'of', 'on', 'or', 'the', 'to']);
export const titleCase = (s) => s.split(' ').map((w, i) => (i > 0 && MINOR.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');

/** The app's own name for a toast in a design: Classic's sentence, Glass's Title Case, Vivid's friendly line. */
export function defaultName(key, design = 'classic') {
  const d = TOASTS[key];
  if (!d) return null;
  if (design === 'glass') return titleCase(d.name);
  if (design === 'vivid') return d.friendly;
  return d.name;
}

/**
 * The renames for one design. Saved before D386 as one flat { key: name }:
 * that reads as Classic's (the only format there was).
 */
export function designNames(saved, design) {
  if (!saved) return {};
  const legacy = !NAME_DESIGNS.some((d) => d in saved);
  if (legacy) return design === 'classic' ? saved : {};
  return saved[design] ?? {};
}

/** The name a toast shows in a design: the household's rename there, else the app's own. */
export function toastName(key, saved, design = 'classic') {
  const own = designNames(saved, design)[key];
  return typeof own === 'string' && own.trim() ? own.trim() : defaultName(key, design);
}

/**
 * Everything saved after renaming `key` to `name` in `design`. A blank name, or
 * the design's own, drops the rename, so only real changes are kept; trimmed,
 * at most MAX_NAME characters. Always returns the per-design shape.
 */
export function renamedToasts(saved, key, name, design = 'classic') {
  const next = Object.fromEntries(NAME_DESIGNS.map((d) => [d, { ...designNames(saved, d) }]));
  const clean = (name ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  if (!clean || clean === defaultName(key, design)) delete next[design][key];
  else next[design][key] = clean;
  return next;
}

/** The toasts in Settings order for a design, matching `search` against the names, group and where. */
export function toastList(saved, search = '', design = 'classic') {
  const q = search.trim().toLowerCase();
  return TOAST_GROUPS.map((g) => ({
    ...g,
    items: Object.entries(TOASTS)
      .filter(([, d]) => d.group === g.key)
      .map(([key, d]) => {
        const current = toastName(key, saved, design);
        return { key, ...d, current, own: defaultName(key, design), renamed: current !== defaultName(key, design) };
      })
      .filter((i) => !q || [i.current, i.own, i.where, g.label].some((s) => s.toLowerCase().includes(q))),
  })).filter((g) => g.items.length > 0);
}
