/**
 * How a row was paid (D359), for the Paid column and its picker. The keys
 * and labels mirror PAYMENT_METHODS in api/src/merchants/payment-method.js
 * (and db/063's check). A row arrives with `paid_with`: { key, label,
 * source: 'you' | 'statement', read } or null.
 */
export const PAYMENT_METHODS = [
  { key: 'apple_pay', label: 'Apple Pay', group: 'Phone wallet' },
  { key: 'google_pay', label: 'Google Pay', group: 'Phone wallet' },
  { key: 'samsung_pay', label: 'Samsung Pay', group: 'Phone wallet' },
  { key: 'tap', label: 'Tap', group: 'In person' },
  { key: 'chip', label: 'Chip', group: 'In person' },
  { key: 'swipe', label: 'Swipe', group: 'In person' },
  { key: 'in_person', label: 'In person', group: 'In person' },
  { key: 'online', label: 'Online', group: 'Online' },
  { key: 'paypal', label: 'PayPal', group: 'Online' },
  { key: 'autopay', label: 'Autopay', group: 'Bills and transfers' },
  { key: 'app', label: 'App', group: 'Bills and transfers' },
  { key: 'bill_pay', label: 'Bill pay', group: 'Bills and transfers' },
  { key: 'ach', label: 'Bank transfer', group: 'Bills and transfers' },
  { key: 'zelle', label: 'Zelle', group: 'Bills and transfers' },
  { key: 'wire', label: 'Wire', group: 'Bills and transfers' },
  { key: 'check', label: 'Check', group: 'Bills and transfers' },
  { key: 'atm', label: 'ATM', group: 'Bills and transfers' },
];
const LABEL = Object.fromEntries(PAYMENT_METHODS.map((m) => [m.key, m.label]));
export const paymentLabel = (key) => (key ? LABEL[key] ?? key : null);

/** The picker's value: the person's own pick, or '' for "what the statement says". */
export const paidValue = (paid) => (paid?.source === 'you' ? paid.key : '');

/**
 * The picker's options for one row: first what its statement says (picking
 * it clears a hand-set method), then every method in its group.
 */
export function paidChoices(paid) {
  const read = paymentLabel(paid?.read);
  return [
    { value: '', label: read ?? '—', hint: read ? 'As its statement says' : 'Its statement doesn\'t say' },
    ...PAYMENT_METHODS.map((m) => ({ value: m.key, label: m.label, group: m.group })),
  ];
}

/** The row's paid_with after picking `value` ('' goes back to the statement's). */
export function paidAfter(paid, value) {
  const read = paid?.read ?? null;
  const key = value || read;
  if (!key) return null;
  return { key, label: paymentLabel(key), source: value ? 'you' : 'statement', read };
}
