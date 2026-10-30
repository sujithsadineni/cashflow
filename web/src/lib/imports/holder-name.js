/** "ALEX J MORGAN" → "Alex J Morgan": a statement's printed holder as a name for People. */
export function holderName(printed) {
  return (printed ?? '').trim().replace(/\s+/g, ' ').toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
}
