/**
 * The words of the app's success toasts (D317): one place, so every page
 * says the same thing the same way. Each returns { message, options } for
 * notify(), or null when there's nothing to say. Pure; tested in
 * toast-words.test.js.
 */

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const list = (names) => (names.length <= 2 ? names.join(' and ') : `${names.slice(0, 2).join(', ')} +${names.length - 2} more`);

/**
 * After a statement is approved: the save itself, then what the app found in
 * it (bills linked, new bills, payments matched, transfers linked, card
 * dates and address learned, rows to review), each pointing where it lives.
 */
export function approvalToasts(result) {
  const f = result?.follow_up ?? {};
  const saved = {
    message: result?.rows_approved ? plural(result.rows_approved, 'row', 'rows') : 'No activity this period',
    options: { name: 'statement.saved', duration: 5000 },
  };
  const found = [];
  let to = null;
  const note = (text, path) => { found.push(text); to ??= path; };
  if (f.bills_linked?.length) note(`${list(f.bills_linked)} charged`, '/recurring');
  if (f.new_bills?.length) note(`new recurring: ${list(f.new_bills)}`, '/recurring?bill=new');
  if (f.payments_verified) note(`${plural(f.payments_verified, 'payment', 'payments')} matched`, '/review?tab=payments');
  if (f.payments_named) note(`${plural(f.payments_named, 'payment', 'payments')} named`, '/review?tab=payments');
  if (f.transfers_linked) note(`${plural(f.transfers_linked, 'transfer', 'transfers')} linked`, '/transactions');
  if (f.card_days_learned) note('card due day learned', '/cards');
  if (f.address_read) note('mailing address read', '/settings?tab=people');
  if (f.review_added) note(`${plural(f.review_added, 'row', 'rows')} to review`, '/review?tab=findings');
  if (found.length === 0) return [saved];
  const text = found.join(' · ');
  return [saved, {
    message: text.charAt(0).toUpperCase() + text.slice(1),
    options: { name: 'statement.found', duration: 8000, action: { label: 'Show', to } },
  }];
}

/** A transaction edited in place (D384): named by what changed ("Category changed"), the line saying which and to what. */
export function editedToast(name, field, value, onUndo) {
  const key = { category: 'txn.category', txn_type: 'txn.type', merchant: 'txn.merchant', payment_method: 'txn.paid_with' }[field] ?? 'txn.category';
  return {
    message: `${name ?? 'Transaction'} → ${value ?? 'none'}`,
    options: { name: key, duration: 5000, ...(onUndo ? { action: { label: 'Undo', onClick: onUndo } } : {}) },
  };
}
