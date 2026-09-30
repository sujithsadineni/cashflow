/**
 * Belt-and-braces PAN scrub, shared by every extraction path.
 *
 * A plain `\d{13,19}` run isn't enough: real statements print card
 * numbers grouped — "4111 2222 3333 2468" or "4111-2222-3333-2468" —
 * which a simple digit-run regex lets straight through. This matches
 * digit groups joined by single spaces or hyphens too, then verifies
 * the digit COUNT (13–19) after stripping separators before redacting,
 * so short things that happen to contain hyphens — phone numbers
 * (555-010-0199, 10 digits), ZIP+4 (27000-0002, 9 digits), a 12-digit
 * checking account number — are left alone.
 */
export function redactPan(text) {
  if (text == null) return null;
  return text.replace(/\b\d[\d\s-]{11,24}\d\b/g, (match) => {
    const digitsOnly = match.replace(/\D/g, '');
    return digitsOnly.length >= 13 && digitsOnly.length <= 19 ? '[redacted]' : match;
  });
}
