import { maskName } from '../../api.js';

/**
 * The name a transaction shows (D174). A real merchant shows as-is. A
 * Zelle payment has no merchant, just the bank's line ("Zelle payment
 * from FIRST MIDDLE LAST for "rent"; Conf# …"), so it reads as
 * "From Jordan Lee — “rent”" / "To Sam Rivera" instead. The Zelle logo or
 * contact photo beside it already says it's Zelle.
 *
 * Display only: `merchant` stays null, so recurring detection and
 * merchant history group these exactly as before, and every statement
 * imported later reads the same way with nothing to migrate.
 *
 * The person is the contact's nickname, else the full name (the
 * contact's, else off the bank's line, in normal capitals: D396, the
 * owner's ask; it was the first name). The memo the sender typed is set
 * apart, " — “rent”", and zelleParts gives the pieces so a list can draw
 * it in its own style (TxnName.jsx). Direction comes from the sign, which
 * also covers transfers between the two of you.
 */
const ZELLE_RE = /zelle®?\s+payment\s+(?:to|from)\s+(.+?)(?:\s+for\s+"([^"]*)"|\s+conf#|\s+jpm\w*|\s+\d{6,}|;|$)/i;

// A name in normal capitals: a bank's SHOUTING or all-lowercase line is title-cased,
// one already mixed ("McDonald", "DeShawn") is kept as written.
const properName = (full) => {
  const name = full?.trim().replace(/\s+/g, ' ');
  if (!name) return null;
  if (name !== name.toUpperCase() && name !== name.toLowerCase()) return name;
  return name.toLowerCase().replace(/(^|[\s\-'])([a-z])/g, (_, p, c) => p + c.toUpperCase());
};

// The note the sender typed, as written, except a SHOUTED one reads in sentence case ("OCTOBER RENT" → "October rent").
const memoText = (raw) => {
  const memo = raw?.trim();
  if (!memo) return null;
  return /[A-Z]/.test(memo) && memo === memo.toUpperCase() ? memo[0] + memo.slice(1).toLowerCase() : memo;
};

/** A Zelle row's pieces: { direction: 'To' | 'From', person, memo }, or null for any other row. */
export function zelleParts(t) {
  const m = ZELLE_RE.exec(t.description ?? '');
  if (!m) return null;
  const person = t.contact_nickname || properName(t.contact_name) || properName(m[1]);
  return { direction: t.amount_cents < 0 ? 'To' : 'From', person: maskName(person), memo: memoText(m[2]) };
}

export function zelleName(t) {
  const z = zelleParts(t);
  if (!z) return null;
  return `${z.direction} ${z.person}${z.memo ? ` — “${z.memo}”` : ''}`;
}

/** Whether a row's name is its Zelle name (no merchant of its own), so a list can style the memo. */
export const showsZelleName = (t) => !(t.merchant && !/^zelle$/i.test(t.merchant)) && zelleParts(t) !== null;

/**
 * A raw bank line made readable, for a place nobody has named yet (D188):
 * "TST* HARBOR GRILL RESTAUR KILL DEVIL HI NC" → "Harbor Grill Restaur Kill Devil Hi",
 * "TOUS LES JOURS LAKEVIEW LAKEVIEW NC" → "Tous Les Jours Lakeview". Processor
 * prefixes, store numbers, a trailing state and a repeated city go; shouting
 * becomes title case. Display only: it's never saved, so a guessed name can't
 * teach merchant learning anything.
 */
export function tidyDescription(description) {
  if (!description) return null;
  const words = description
    .replace(/^(TST\*|SQ \*|SQ\*|SP \*|AplPay |PAYPAL \*|PP\*|PY \*|CTLP\*|DD \*|BPS\*|IN \*)\s*/i, '')
    .replace(/\*/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !/\d/.test(w) && !/^#/.test(w) && !/^(LLC|INC\.?|USA)$/i.test(w));
  if (words.length > 1 && /^[A-Z]{2}$/.test(words.at(-1))) words.pop(); // trailing state
  if (words.length > 2 && words.at(-1).toLowerCase() === words.at(-2).toLowerCase()) words.pop(); // "LAKEVIEW LAKEVIEW"
  const text = words.join(' ');
  if (!text) return null;
  const shouting = text === text.toUpperCase();
  return shouting ? text.toLowerCase().replace(/(^|[\s\-/&(])([a-z])/g, (_, p, c) => p + c.toUpperCase()) : text;
}

/** What to show for a transaction's name: its merchant, a Zelle name, or its bank line made readable. */
export function txnName(t) {
  if (t.merchant && !/^zelle$/i.test(t.merchant)) return t.merchant;
  return zelleName(t) ?? tidyDescription(t.description) ?? t.merchant ?? null;
}

/**
 * A row's account where space is tight (D353): its nickname ("BofA Custom"),
 * with the last four only when another open account shares the nickname
 * ("Zolve ··5114"); its full name and last four when it has none. `full` is
 * the whole name, for a tooltip.
 */
export function accountShort(t) {
  const full = `${t.account_name ?? ''}${t.account_mask ? ` ··${t.account_mask}` : ''}`;
  if (!t.account_nickname) return { label: full, full };
  return { label: t.account_nickname_shared && t.account_mask ? `${t.account_nickname} ··${t.account_mask}` : t.account_nickname, full };
}
