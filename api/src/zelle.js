/**
 * Zelle review support.
 *
 * Zelle transactions parse as txn_type='transfer' regardless of
 * whether they're really a transfer between the household's own
 * accounts or a real payment to someone else — the statement text
 * looks the same either way (see db/014_zelle_review.sql and
 * routes/zelle.js for how a review is actually applied).
 *
 * `autoZelleReview` applies automatically on import approval
 * (routes/imports.js) rather than waiting on a person: internal (a
 * name matching the household itself) always wins over the sign, since
 * a shuffle between the household's own accounts can be either an
 * outgoing or incoming leg; everything else falls to the sign alone —
 * negative is Sent (spend), positive is Received (income), the same
 * rule the rest of the app already uses for every other transaction.
 * Still just a starting guess, not fact: ZelleReview.jsx's PATCH stays
 * available to correct any row, same as before.
 *
 * Pure functions, no db access — unit tested against real Zelle
 * descriptions, not synthetic ones (see zelle.test.js).
 */

/**
 * Extract a plausible display name from a raw Zelle description.
 * Strips the "Zelle(R)? payment to/from" prefix, a trailing memo/
 * confirmation clause, and a trailing confirmation-code-looking token
 * (mixed letters+digits, or a long pure digit run) — validated 45/45
 * against every real Zelle description in the dev database. Always
 * returns a string (falls back to the original description trimmed,
 * for anything that doesn't match the usual shape) — this is a
 * starting point for the reviewer to edit, never presented as fact.
 */
export function suggestZelleName(description) {
  if (!description) return '';

  let s = description;
  s = s.replace(/^zelle[®\s]*payment\s+(to|from)\s+/i, '');
  s = s.split(/\s+for\s+"/i)[0]; // ...for "zolve"; Conf# ...
  s = s.split(/;?\s*conf#/i)[0]; // ...Conf# 99c00wvt9
  s = s.trim();

  // A trailing confirmation-code-looking token: mixed letters+digits
  // with no space ("Jpm99Bzra837"), or a long pure-digit run
  // ("28281860244"). A real name's last word never looks like this.
  s = s.replace(/\s+([A-Za-z0-9]{7,})$/, (whole, token) => {
    const looksLikeCode = (/[a-z]/i.test(token) && /\d/.test(token)) || /^\d{6,}$/.test(token);
    return looksLikeCode ? '' : whole;
  });

  s = s.trim().replace(/\s+/g, ' ');

  // Statement sources vary in casing ("ALEX MORGAN" vs "Jamie")
  // — title-case any all-caps word, leave anything already mixed-case
  // (a real name typed correctly) untouched.
  return s
    .split(' ')
    .map((word) => (word.length > 1 && word === word.toUpperCase() ? word[0] + word.slice(1).toLowerCase() : word))
    .join(' ');
}

/**
 * Whether a suggested name plausibly refers to someone in the
 * household itself (the two-account-shuffle case — "Alex" paying
 * "Sam", or vice versa, including a legal-name variant like
 * "Samira Rivera"). Driven by the real `person` rows rather than
 * hardcoded names, so it stays correct if either name ever changes.
 */
export function suggestInternal(name, people) {
  if (!name || people.length === 0) return false;
  const tokens = new Set(people.flatMap((p) => p.name.toLowerCase().split(/\s+/)));
  return name.toLowerCase().split(/\s+/).some((word) => tokens.has(word));
}

/**
 * The automatic call for a newly-approved Zelle transaction: a name
 * (same guess a reviewer would have started from) and a type — INTERNAL
 * if the name matches the household itself, otherwise SENT/RECEIVED by
 * the amount's own sign.
 */
export function autoZelleReview(description, amountCents, people) {
  const zelle_person = suggestZelleName(description);
  const zelle_type = suggestInternal(zelle_person, people) ? 'INTERNAL' : amountCents < 0 ? 'SENT' : 'RECEIVED';
  return { zelle_type, zelle_person };
}
