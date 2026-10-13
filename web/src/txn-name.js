import { maskName } from './api.js';

/**
 * The name a transaction shows (D174). A real merchant shows as-is. A
 * Zelle payment has no merchant, just the bank's line ("Zelle payment
 * from FIRST MIDDLE LAST for "rent"; Conf# …"), so it reads as
 * "From First · rent" / "To First" instead. The Zelle logo or contact
 * photo beside it already says it's Zelle.
 *
 * Display only: `merchant` stays null, so recurring detection and
 * merchant history group these exactly as before, and every statement
 * imported later reads the same way with nothing to migrate.
 *
 * The person is the contact's nickname, else the first name (the
 * contact's, else off the bank's line). Direction comes from the sign,
 * which also covers transfers between the two of you.
 */
const ZELLE_RE = /zelle®?\s+payment\s+(?:to|from)\s+(.+?)(?:\s+for\s+"([^"]*)"|\s+conf#|\s+jpm\w*|\s+\d{6,}|;|$)/i;

const firstName = (full) => {
  const word = full?.trim().split(/\s+/)[0];
  return word ? word[0].toUpperCase() + word.slice(1).toLowerCase() : null;
};

export function zelleName(t) {
  const m = ZELLE_RE.exec(t.description ?? '');
  if (!m) return null;
  const person = t.contact_nickname || firstName(t.contact_name) || firstName(m[1]);
  const memo = m[2]?.trim();
  return `${t.amount_cents < 0 ? 'To' : 'From'} ${maskName(person)}${memo ? ` · ${memo}` : ''}`;
}

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
