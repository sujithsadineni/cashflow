import { rangeDays, shortDate, todayISO } from '../app/dates.js';

/**
 * The six boxes Import shows while a statement is read (D325), worked out
 * from what the API says it found (`facts`, step 1) or where it stopped
 * (`stage`). Pure: the component only draws this and paces the replay.
 *
 * Each box: { key, label, state, note }, where state is
 *   waiting  not reached yet        active  being worked on now
 *   done     found what it needed   warn    found it, with something to look at
 *   stop     the read stopped here  skip    doesn't apply (a CSV has no pages)
 *   ask      a guess you confirm (the card read off the statement: found only once you say "Yes, that's it")
 *   off      after a stop, never reached
 */
export const STAGES = [
  { key: 'upload', label: 'Upload' },
  { key: 'open', label: 'Open' },
  { key: 'find', label: 'Find the card' },
  { key: 'read', label: 'Read rows' },
  { key: 'sort', label: 'Name & sort' },
  { key: 'check', label: 'Check totals' },
];

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "820 KB", "2.1 MB". */
export function fileSize(bytes) {
  if (!bytes) return null;
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const cardLabel = (card) => [card.name ?? card.issuer, card.mask && `···${card.mask}`].filter(Boolean).join(' ');

/** Why it stopped, in a few words for the box; the full message goes under the rail. */
function stopNote(key, { message, existing }) {
  if (key === 'open' && /password/i.test(message)) return /didn.t open/i.test(message) ? "Password didn't open it" : 'Has a password';
  // A file already on file closes by itself and opens the earlier one (D325).
  if (key === 'upload' && existing) return 'Already on file';
  if (key === 'upload' && /already imported/i.test(message)) return 'Already imported';
  return { upload: "Couldn't upload it", open: "Couldn't open it", find: 'Not a bank it reads yet', read: "Couldn't read the lines" }[key] ?? 'Stopped here';
}

// The Upload box names the file (D325, no header line): the clean label once its card is known.
const uploadBox = (reading, label) => ({
  state: 'done',
  note: label ?? reading.fileName ?? 'On file',
  title: [reading.fileName, [fileSize(reading.size), reading.fileType].filter(Boolean).join(' ')].filter(Boolean).join(' · '),
});

/** What each box found, once the read is in. */
function finished(reading, { accountName, label, today }) {
  const { facts, report } = reading;
  const csv = reading.fileType === 'CSV';
  const card = facts.card ? cardLabel(facts.card) : accountName;
  // A box is about 150px wide (D325): a few words in it, the whole story on hover.
  // A card read off the statement is a guess until the owner confirms it after the read, so no tick yet.
  const find = facts.card_known === 'confirmed'
    ? { state: 'done', note: card ?? 'Your card' }
    : facts.card_known === 'suggested'
      ? { state: 'ask', note: card ?? 'A card of yours', title: `${card ?? 'This card'}: read off the statement. You confirm it's yours after the read.` }
    : facts.card_known === 'tied'
      ? { state: 'warn', note: 'Pick which card', title: `${card}: more than one of your cards has had these last 4` }
      : { state: 'warn', note: card ? 'Pick its card' : 'You pick the card', title: card ? `${card} isn't one of your cards yet` : 'A CSV has no card on it' };

  const read = facts.rows > 0
    ? { state: 'done', note: [plural(facts.rows, 'row'), facts.period?.start && facts.period?.end && rangeDays(facts.period.start.slice(0, 10), facts.period.end.slice(0, 10), today)].filter(Boolean).join(' · ') }
    : { state: 'warn', note: 'No transactions in it' };

  const heads = [
    facts.same_statement && ['Already on file', `This statement is already on file, closing ${shortDate(facts.same_statement.period_end, today)}`],
    facts.duplicates > 0 && [`${facts.duplicates} maybe ${facts.duplicates === 1 ? 'duplicate' : 'duplicates'}`, `${plural(facts.duplicates, 'row')} already saved on this card`],
    report?.reconciliation && Object.values(report.reconciliation).some((v) => v === false) && ['A total is off', "A printed total doesn't match the rows"],
  ].filter(Boolean);
  const matched = report?.reconciliation && Object.values(report.reconciliation).every((v) => v !== false);
  const check = heads.length > 0
    ? { state: 'warn', note: heads.map(([short]) => short).join(' · '), title: heads.map(([, long]) => long).join(' · ') }
    : { state: 'done', note: matched ? 'Totals match' : 'No totals to check', title: matched ? 'Every printed total matches the rows' : 'Nothing printed on it to check against' };

  return {
    upload: uploadBox(reading, label),
    open: csv ? { state: 'skip', note: 'Not needed' } : { state: 'done', note: facts.pages ? plural(facts.pages, 'page') : 'Opened' },
    find,
    read,
    sort: facts.rows > 0
      ? { state: 'done', note: `${facts.sorted} of ${facts.rows} sorted${facts.low_confidence > 0 ? ` · ${facts.low_confidence} unsure` : ''}` }
      : { state: 'skip', note: 'Nothing to sort' },
    check,
  };
}

/**
 * reading: { fileType, size, uploaded, facts?, report?, error?: { message, stage } }
 * Returns the six boxes and, after a stop, the full message to show under them.
 */
export function stageBoxes(reading, { accountName = null, label = null, today = todayISO() } = {}) {
  const csv = reading.fileType === 'CSV';
  if (reading.facts) {
    const found = finished(reading, { accountName, label, today });
    return { boxes: STAGES.map((s) => ({ ...s, ...found[s.key] })), message: null };
  }

  if (reading.error) {
    const at = STAGES.findIndex((s) => s.key === (reading.error.stage ?? (reading.uploaded ? 'read' : 'upload')));
    const stopAt = at === -1 ? 3 : at;
    const before = {
      upload: uploadBox(reading),
      open: csv ? { state: 'skip', note: 'Not needed' } : { state: 'done', note: 'Opened' },
      // Past Find without an answer: a PDF's bank was one it reads; a CSV never has a card to find.
      find: csv ? { state: 'skip', note: 'A CSV has no card' } : { state: 'done', note: accountName ?? 'A bank it reads' },
    };
    return {
      boxes: STAGES.map((s, i) => ({
        ...s,
        ...(i < stopAt ? before[s.key] ?? { state: 'done', note: null }
          : i === stopAt ? { state: 'stop', note: stopNote(s.key, reading.error), title: reading.error.message }
            : { state: 'off', note: null }),
      })),
      message: reading.error.message,
    };
  }

  // Still going: Upload is real (its own request); then the read is one
  // request, so the next box it needs is the one shown working.
  const working = !reading.uploaded ? 0 : csv ? 2 : 1;
  return {
    boxes: STAGES.map((s, i) => ({
      ...s,
      ...(i === 0 ? { ...uploadBox(reading), state: reading.uploaded ? 'done' : 'active' }
        : i === 1 && csv && reading.uploaded ? { state: 'skip', note: 'Not needed' }
          : i === working ? { state: 'active', note: null }
            : { state: 'waiting', note: null }),
    })),
    message: null,
  };
}
