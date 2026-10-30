/**
 * A short name for an account, made automatically (D416), for the tight places a nickname
 * is shown (Transactions' account column, lists, toasts). The person can change it any time;
 * a nickname they've set is never replaced.
 *   cards: a three-word Amex or Bank of America product by its initials ("Blue Cash Preferred"
 *          → "BCP", "Customized Cash Rewards" → "CCR"); any other without its filler words
 *          ("Bilt Blue Card" → "Bilt Blue", "Frontier Airlines World Mastercard" → "Frontier")
 *   bank accounts: the bank's short name and the kind ("BofA Checking", "Robinhood Savings")
 *   two alike: each with its last 4 ("Zolve 5205", "Zolve 5206")
 */
const SHORT_BANK = [
  [/bank of america|bofa/i, 'BofA'], [/american express|amex/i, 'Amex'], [/goldman sachs|apple/i, 'Apple'],
  [/jpmorgan|chase/i, 'Chase'], [/wells fargo/i, 'Wells Fargo'], [/capital one/i, 'Capital One'],
];
const FILLER = new Set(['card', 'credit', 'world', 'airlines', 'mastercard', 'visa', 'signature', 'the', 'banking', 'account']);
const INITIALS_ISSUERS = /american express|amex|bank of america|bofa/i;
const KIND = { CHECKING: 'Checking', SAVINGS: 'Savings', INVESTMENT: 'Investing' };

const shortBank = (issuer) => SHORT_BANK.find(([re]) => re.test(issuer ?? ''))?.[1] ?? (issuer ?? '').trim().split(/\s+/)[0] ?? '';

/** The nickname this account would get on its own, before telling it apart from others. */
export function baseNickname(account) {
  const name = (account.name ?? '').replace(/[®™]/g, '').trim();
  if (account.account_type !== 'CREDIT_CARD') {
    return [shortBank(account.issuer), KIND[account.account_type]].filter(Boolean).join(' ').trim() || name;
  }
  const words = name.split(/\s+/).filter(Boolean);
  const kept = words.filter((w) => !FILLER.has(w.toLowerCase()));
  // Initials only for three real words ("Cash Magnet Card" is "Cash Magnet", not "CMC").
  if (kept.length >= 3 && INITIALS_ISSUERS.test(account.issuer ?? '') && kept.every((w) => /^[A-Za-z]/.test(w))) {
    return kept.map((w) => w[0].toUpperCase()).join('');
  }
  // "Visa Signature" alone names no card: the bank's short name says whose.
  if (kept.length === 0) return [shortBank(account.issuer), words[0]].filter(Boolean).join(' ');
  return kept.join(' ');
}

/** The nickname for an account among the others: its base, with its last 4 when another shares it. */
export function autoNickname(account, accounts = []) {
  const base = baseNickname(account);
  const twins = accounts.filter((a) => a.id !== account.id && baseNickname(a).toLowerCase() === base.toLowerCase());
  const named = twins.length > 0 && account.mask ? `${base} ${account.mask}` : base;
  return named.slice(0, 24);
}
