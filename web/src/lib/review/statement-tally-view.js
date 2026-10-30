/**
 * Which months on the Imports calendar glow (D274): a saved statement whose
 * rows don't add up to the cent from its opening to its closing balance
 * (`off`), or one that can't be checked (`unread`: the balances weren't read;
 * `no_summary`: no statement summary saved). The API works out each import's
 * ledger_tally; this only places it on the calendar and words it. Pure:
 * tested in statement-tally-view.test.js.
 */

/** The month keys a statement stands for: each month whose 15th it holds (D269) on a card, else the month it closed in. */
export function statementMonths(batch, byFifteenth) {
  const end = batch.period_end?.slice(0, 10);
  if (!end) return [];
  const start = batch.period_start?.slice(0, 10);
  if (byFifteenth && start) {
    const keys = [];
    let [y, m] = start.slice(0, 7).split('-').map(Number);
    for (;;) {
      const key = `${y}-${String(m).padStart(2, '0')}`;
      if (`${key}-15` > end) break;
      if (`${key}-15` >= start) keys.push(key);
      if (++m > 12) { m = 1; y++; }
    }
    if (keys.length) return keys;
  }
  return [end.slice(0, 7)];
}

/** One statement's tally in words, or null when it adds up (or isn't checked at all). */
export function tallyNote(tally, money) {
  if (!tally || tally.state === 'match') return null;
  const waiting = tally.pending_count > 0
    ? ` · ${tally.pending_count} ${tally.pending_count === 1 ? 'row' : 'rows'} (${money(tally.pending_cents)}) still waiting in the import`
    : '';
  switch (tally.state) {
    case 'off': return { tone: 'off', title: `Doesn't add up: off by ${money(Math.abs(tally.diff_cents))}${waiting}` };
    case 'unread': return { tone: 'warn', title: `Can't check: the statement's balances weren't read${waiting}` };
    case 'no_summary': return { tone: 'warn', title: `Can't check: no statement summary was saved${waiting}` };
    default: return null;
  }
}

/**
 * A card statement whose year-to-date fees or interest don't match its own
 * rows (D346): a fee or interest row missing or filed as something else.
 * null when it matches, or can't be checked (the gap after a missing
 * statement is the missing statement's to show).
 */
export function ytdNote(check) {
  if (!check || check.gap) return null;
  const off = [check.fees === false && 'fees', check.interest === false && 'interest'].filter(Boolean);
  if (off.length === 0) return null;
  const rows = off.map((w) => (w === 'fees' ? 'fee' : w)).join(' and ');
  return { tone: 'warn', title: `Its year-to-date ${off.join(' and ')} don't match its ${rows} rows: one may be missing or filed as something else` };
}

/** month key → { tone, title } for every month a non-adding statement stands for. An `off` wins over a `warn` in the same month. */
export function tallyGlow(batches, { byFifteenth, money }) {
  const glow = new Map();
  for (const b of batches) {
    const note = tallyNote(b.ledger_tally, money) ?? ytdNote(b.ytd_check);
    if (!note) continue;
    for (const key of statementMonths(b, byFifteenth)) {
      if (glow.get(key)?.tone !== 'off') glow.set(key, note);
    }
  }
  return glow;
}
