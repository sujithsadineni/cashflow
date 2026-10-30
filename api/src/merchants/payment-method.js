/**
 * How a row was paid (D359): a phone wallet, in person, online, autopay, a
 * bank transfer and so on. Read from the row's printed line every time it's
 * shown, like its place (D224) and wallet (D352), so every past and future
 * row has it; a person's own pick (transaction.payment_method) wins over it.
 * Pure; tested in payment-method.test.js.
 *
 * What statements print, measured over every saved row: wallets (Amex's
 * "AplPay"), PayPal, Zelle, ATM, ACH wording, autopay and app payments. No
 * bank prints tap, chip or swipe, so an in-store purchase reads "in person"
 * and the person can say which.
 */

/** Every method, in the order a picker lists them; keys match db/063's check. */
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
export const PAYMENT_METHOD_KEYS = PAYMENT_METHODS.map((m) => m.key);
const LABEL = Object.fromEntries(PAYMENT_METHODS.map((m) => [m.key, m.label]));

// Any kind of row: the wording names the method outright.
const ANY = [
  [/\bAplPay\b|\bApple ?Pay\b/i, 'apple_pay'],
  [/\bGglPay\b|\bGoogle ?Pay\b/i, 'google_pay'],
  [/\bSamsung ?Pay\b/i, 'samsung_pay'],
  [/\bZelle\b/i, 'zelle'],
  [/\bPayPal\b/i, 'paypal'],
];
// Money moving to pay a bill, or between banks. Autopay first: its lines also say "payment received".
const MOVES = [
  [/\bauto ?pay\b|\bautopymt\b|\bauto pmt\b|\bautomatic payment\b/i, 'autopay'],
  [/\bATM\b/, 'atm'],
  [/\bwire\b/i, 'wire'],
  [/\bcheck ?#|\bcheck \d|\b(mobile|remote) deposit\b/i, 'check'],
  [/\bbill pay(ment)?\b/i, 'bill_pay'],
  [/\b(mobile|online)(\/mobile)? (payment|banking)\b/i, 'app'],
  [/\bACH(BT)?\b|\bDES:|\b(PPD|CCD|WEB) ID\b|\binternet transfer\b|\be-?payment\b|\belectronic payment\b|\bpayment received\b|\bdirect deposit\b|\bacctverify\b|\b(realtime|instant) payment\b/i, 'ach'],
];
const MOVE_TYPES = new Set(['payment', 'transfer', 'deposit', 'savings']);
const SHOP_TYPES = new Set(['purchase', 'refund']);

/**
 * @param row  { raw, description, txn_type, place, billed } — place from placeFor (D224), or null;
 *             billed: a subscription or a recurring charge, kept on file and never "in person"
 *             (a streaming service's line prints its head office's town)
 * @returns a key from PAYMENT_METHODS, or null when the line doesn't say
 */
export function readPaymentMethod({ raw = null, description = '', txn_type = null, place = null, billed = false }) {
  const text = `${raw ?? ''} ${description ?? ''}`;
  const named = ANY.find(([re]) => re.test(text));
  if (named) return named[1];
  if (MOVE_TYPES.has(txn_type)) return MOVES.find(([re]) => re.test(text))?.[1] ?? null;
  if (SHOP_TYPES.has(txn_type)) {
    if (place?.online || billed) return 'online';
    if (place?.town) return 'in_person';
  }
  return null;
}

/**
 * What a row shows: the person's pick, else what the statement says.
 * @returns { key, label, source: 'you' | 'statement', read } or null; `read` is the statement's, for "Use the statement's".
 */
export function paidWith(chosen, row) {
  const read = readPaymentMethod(row);
  const key = chosen ?? read;
  if (!key) return null;
  return { key, label: LABEL[key] ?? key, source: chosen ? 'you' : 'statement', read };
}
