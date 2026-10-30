/**
 * A terms-change notice on a card statement (D350), in each bank's words.
 * Pure; tested in notice.test.js.
 *
 *   Amex:      "Summary of Changes, Effective October 8, 2025", then sections
 *              "Penalty APR and When it Applies We are clarifying…"
 *   BofA:      "Revised Terms as of 11/12/2026" (or "February 13, 2024"), bullets
 *              "· Balance Transfer 5% of the amount of each transaction",
 *              "You can reject … by 11/11/2026"
 *   Barclays:  "Revised Terms effective on or after February 06, 2026", bullets,
 *              "You can reject the changes … by February 05,\n2026"
 *
 * Returns { effective_on, reject_by, points } (dates YYYY-MM-DD, up to four
 * short points as printed), or null when the statement carries no notice.
 */
const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
const pad = (n) => String(n).padStart(2, '0');
const DATE = '((?:January|February|March|April|May|June|July|August|September|October|November|December) \\d{1,2}, \\d{4}|\\d{2}/\\d{2}/\\d{4})';

function isoOf(text) {
  const slash = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (slash) return `${slash[3]}-${slash[1]}-${slash[2]}`;
  const m = text.match(/^(\w+) (\d{1,2}), (\d{4})$/);
  return m ? `${m[3]}-${pad(MONTHS[m[1].toLowerCase()])}-${pad(m[2])}` : null;
}

const EFFECTIVE = [
  new RegExp(`Summary of Changes, Effective ${DATE}`, 'i'),
  new RegExp(`Revised Terms (?:as of|effective on or after) ${DATE}`, 'i'),
];
const BULLET = /^[·●•oº\-–]\s+/;
const STOP = /^(You (can|have the right to) reject|Other Changes|IMPORTANT|In addition|Please see|For more information)/i;

export function readTermsNotice(text) {
  const lines = (text ?? '').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  let at = -1;
  let effective = null;
  for (let i = 0; i < lines.length && at < 0; i++) {
    for (const re of EFFECTIVE) {
      const m = lines[i].match(re);
      if (m) { at = i; effective = isoOf(m[1]); break; }
    }
  }
  if (at < 0 || !effective) return null;

  // Its points: Amex names each section before "We are…"; the others list bullets.
  const points = [];
  for (const line of lines.slice(at + 1, at + 40)) {
    if (points.length >= 4 || STOP.test(line)) break;
    const section = line.match(/^(.{4,60}?) We are /);
    if (section) { points.push(section[1].trim()); continue; }
    if (BULLET.test(line)) {
      const point = line.replace(BULLET, '').trim();
      if (point.length > 3) points.push(point.length > 80 ? `${point.slice(0, 79)}…` : point);
    }
  }

  // A reject-by date: "reject … by DATE", in the same sentence (a phone number's dots don't end
  // it: "866.300.3122"), the date allowed to wrap onto the next line.
  const joined = lines.join(' ').replace(/P\.O\./g, 'PO'); // Barclays' "P.O. Box" isn't a sentence's end
  const reject = joined.match(new RegExp(`reject(?:[^.]|\\.(?=\\d)){0,200}? by ${DATE}`, 'i'));
  return { effective_on: effective, reject_by: reject ? isoOf(reject[1]) : null, points };
}
