/**
 * The mailing address a statement is sent to (D302), read off its first page.
 * Pure: page text in, address out. Tested in mailing-address.test.js.
 *
 * US statements print the mailing block the same way whatever the bank: the
 * holder's name, a street line or two, then "CITY, ST 12345". Some print it
 * on its own; others share its lines with another column (Chase puts the
 * name at the end of a line of contact numbers). So the block is read in the
 * name's own column: from where the name starts on its line, each following
 * line is read from that column up to the next wide gap. A second all-caps
 * name line (a joint holder) is passed over. Nothing is guessed: without a
 * city line within a few lines of the name there is no address.
 *
 * @param pageText     the first page's text, with its spacing (pdf-pages.js)
 * @param holderNames  the names this account's statements print, any case
 * @returns { street: [lines], city, state, zip } or null
 */

// "CITY, ST 12345", "CITY ST 12345-6789", or Zolve's "CITY, ST, 12345".
const CITY_LINE = /^([A-Z][A-Za-z .'-]*?),?\s+([A-Z]{2}),?\s+(\d{5})(?:-\d{4})?$/;
// A street line that ends in its city and state, with the ZIP on the next line (Zolve).
const STREET_CITY_STATE = /^(.*?\d.*?),\s*([A-Za-z .'-]+),\s*([A-Z]{2}),?$/;
// A street starts with its number, a PO box, or (a second line) a unit.
const STREET_START = /^(\d+[A-Z]?\s+\S|P\.?\s?O\.?\s+BOX\b)/i;
const UNIT_LINE = /^(APT|UNIT|STE|SUITE|#|FL|FLOOR|BLDG|RM)\b/i;
const HAS_DATE = /\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b|\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b/;
const LOOK_AHEAD = 5;

// The first and last word of a name, in order on one line, with anything between:
// statements print middle names and initials differently ("JORDAN A LEE", "JORDAN ALEX LEE").
const nameRe = (name) => {
  const words = name.trim().split(/[^A-Za-z'-]+/).filter((w) => w.length >= 2).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!words.length) return null;
  return words.length === 1 ? new RegExp(`\\b${words[0]}\\b`, 'i') : new RegExp(`\\b${words[0]}\\b[A-Za-z .'-]{0,30}?\\b${words.at(-1)}\\b`, 'i');
};

/**
 * The text of a line from `col`, up to the next wide gap (another column).
 * Five spaces, not three: Chase's text puts three between words.
 */
const inColumn = (line, col) => {
  if (line.length <= Math.max(0, col - 2)) return '';
  return line.slice(Math.max(0, col - 2)).trim().split(/\s{5,}/)[0].trim();
};

export function mailingAddress(pageText, holderNames = []) {
  if (!pageText) return null;
  const lines = pageText.split('\n');
  const patterns = [...new Set(holderNames.filter((n) => n && n.trim().length >= 3).map((n) => n.trim()))].map(nameRe).filter(Boolean);
  if (!patterns.length) return null;

  for (let i = 0; i < lines.length; i++) {
    const hit = patterns.map((re) => lines[i].search(re)).filter((at) => at >= 0).sort((a, b) => a - b)[0];
    if (hit === undefined) continue;
    const street = [];
    let skipped = 0;
    for (let j = i + 1; j <= i + LOOK_AHEAD && j < lines.length; j++) {
      let text = inColumn(lines[j], hit).replace(/\s+/g, ' ');
      // Another column's date glued on ("123 MAPLE WAY DUE 10/05/26"): the address is what comes before it.
      const date = text.search(HAS_DATE);
      if (date >= 0) text = text.slice(0, date).trim();
      if (!text) continue;
      const city = text.match(CITY_LINE);
      if (city) {
        if (!street.length) break;
        return { street: street.map(tidy), city: city[1].trim(), state: city[2], zip: city[3] };
      }
      // The ZIP alone on its line, after a street line that ends in its city and state.
      const zipOnly = text.match(/^(\d{5})(?:-\d{4})?$/);
      const last = street.at(-1)?.match(STREET_CITY_STATE);
      if (zipOnly && last) return { street: [...street.slice(0, -1), last[1]].map(tidy), city: last[2].trim(), state: last[3], zip: zipOnly[1] };
      if (/:/.test(text)) break; // a labelled line ("Account:") isn't an address
      if (street.length === 0 && STREET_START.test(text)) street.push(text);
      else if (street.length > 0 && street.length < 3 && (UNIT_LINE.test(text) || STREET_START.test(text))) street.push(text);
      // An all-caps line before any street is a joint holder's name.
      else if (street.length === 0 && /^[A-Z][A-Z .'-]+$/.test(text)) continue;
      // One line of another column between the street and the city (BofA prints its own name there).
      else if (street.length > 0 && skipped === 0) skipped += 1;
      else break;
    }
  }
  return null;
}

/** A street line without the commas a layout leaves at its end. */
const tidy = (line) => line.trim().replace(/[,\s]+$/, '');

/**
 * The same address however a bank spells it: upper case, no punctuation,
 * single spaces. Two statements that print "123 Maple Ave., Apt 4" and
 * "123 MAPLE AVE APT 4" share one key.
 */
export const addressKey = (a) => (a ? addressLine(a).toUpperCase().replace(/[.,#]/g, ' ').replace(/\s+/g, ' ').trim() : null);

/** One line, for showing: "12 Main St, Apt 4, Springfield, IL 62701" (no ZIP+4). */
export const addressLine = (a) => (a ? [...a.street, `${a.city}, ${a.state} ${a.zip}`].join(', ') : null);

/**
 * The same place however a statement spells it (D303): the street's numbers
 * (house and unit) and the five-digit ZIP. "1 Oak Woods Dr" and a statement's
 * typo "1 Oak Wods Dr" are one address; Apt 4 and Apt 5 are two. Null
 * without a ZIP.
 */
export function placeKey(line) {
  const parts = (line ?? '').split(',').map((x) => x.trim());
  const zip = parts.at(-1)?.match(/\b(\d{5})(?:-\d{4})?$/)?.[1];
  if (!zip) return null;
  const street = parts.slice(0, -2).join(' ');
  return `${(street.match(/\d+[A-Z]?/gi) ?? []).join('-').toUpperCase()}|${zip}`;
}
