/**
 * CSV statement parsing.
 *
 * Format-agnostic by design: statements will come from several issuers
 * over several years, so nothing here assumes one layout. The header
 * row is sniffed and columns are mapped by meaning.
 *
 * Everything in this file is a pure function of its input — no
 * database, no filesystem. That's what makes it unit-testable, and the
 * amount/date parsing is exactly where the bugs would live.
 */

/* ------------------------------------------------------------------
   Amounts
   ------------------------------------------------------------------ */

/**
 * "$1,234.56" -> 123456. "(84.32)" -> -8432. "1.5" -> 150.
 *
 * Done with string math, never parseFloat: floats can't represent
 * 0.1 exactly, and the whole point of integer cents is that they never
 * drift. Returns { ok: false } for anything it can't read with
 * certainty — a guessed amount is worse than a flagged one.
 */
export function parseAmountToCents(raw) {
  if (raw == null) return { ok: false };
  let s = String(raw).trim();
  if (s === '') return { ok: false };

  let negative = false;

  // Accountants' negative: (84.32)
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true;
    s = s.slice(1, -1).trim();
  }

  s = s.replace(/[$,\s]/g, '');

  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  // Trailing-minus style some exports use: "84.32-"
  if (s.endsWith('-')) {
    negative = true;
    s = s.slice(0, -1);
  }

  if (!/^\d+(\.\d{1,2})?$/.test(s)) return { ok: false };

  const [dollars, fraction = ''] = s.split('.');
  const cents = parseInt(dollars, 10) * 100 + (fraction ? parseInt(fraction.padEnd(2, '0'), 10) : 0);

  return { ok: true, cents: negative ? -cents : cents };
}

/* ------------------------------------------------------------------
   Dates
   ------------------------------------------------------------------ */

/**
 * MM/DD/YYYY, M/D/YY, YYYY-MM-DD (and dashes for slashes) -> ISO date
 * string. Two-digit years pivot at 50: 26 -> 2026, 74 -> 1974.
 *
 * The round-trip through Date.UTC catches impossible dates like
 * 02/30/2026 that a regex alone would wave through.
 */
export function parseDateToISO(raw) {
  if (raw == null) return { ok: false };
  const s = String(raw).trim();

  let y, m, d, match;

  if ((match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) {
    [y, m, d] = [+match[1], +match[2], +match[3]];
  } else if ((match = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/))) {
    [m, d, y] = [+match[1], +match[2], +match[3]];
  } else if ((match = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2})$/))) {
    [m, d] = [+match[1], +match[2]];
    const yy = +match[3];
    y = yy < 50 ? 2000 + yy : 1900 + yy;
  } else {
    return { ok: false };
  }

  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return { ok: false };
  }

  return {
    ok: true,
    iso: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
  };
}

/* ------------------------------------------------------------------
   CSV records
   ------------------------------------------------------------------ */

/**
 * A small RFC 4180 reader: quoted fields, embedded commas and
 * newlines, "" as an escaped quote, CRLF or LF line endings. Thirty
 * lines of code beats a dependency for a format this stable.
 */
export function parseCsvRecords(text) {
  const records = [];
  let field = '';
  let record = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      record.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      record.push(field);
      records.push(record);
      field = '';
      record = [];
    } else {
      field += c;
    }
  }

  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  // Drop blank lines
  return records.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

/* ------------------------------------------------------------------
   Header sniffing
   ------------------------------------------------------------------ */

const HEADER_ROLES = {
  // Candidates in priority order: when a file has both "Description"
  // and "Memo", the more specific name wins.
  date: ['date', 'transactiondate', 'posteddate', 'postdate', 'postingdate', 'transdate'],
  description: ['description', 'merchant', 'payee', 'details', 'name', 'memo'],
  amount: ['amount', 'transactionamount'],
  debit: ['debit', 'debitamount', 'withdrawal', 'withdrawals', 'moneyout'],
  credit: ['credit', 'creditamount', 'deposit', 'deposits', 'moneyin'],
};

const normalizeHeader = (cell) => String(cell).toLowerCase().replace(/[^a-z]/g, '');

/** Map a header row to column indexes by meaning. */
export function sniffHeader(cells) {
  const normalized = cells.map(normalizeHeader);
  const mapping = {};

  for (const [role, candidates] of Object.entries(HEADER_ROLES)) {
    for (const candidate of candidates) {
      const index = normalized.indexOf(candidate);
      if (index !== -1) {
        mapping[role] = index;
        break;
      }
    }
  }
  return mapping;
}

/* ------------------------------------------------------------------
   Whole file
   ------------------------------------------------------------------ */

/**
 * Parse a statement CSV into rows shaped for staged_transaction.
 *
 * Never throws on a bad row — a row that can't be fully read comes
 * back with confidence LOW and whatever fields did parse, so the
 * review screen can show it to a human instead of silently dropping
 * it. Only a file we can't map at all is an error.
 */
export function parseStatementCsv(text) {
  const records = parseCsvRecords(text);
  if (records.length < 2) {
    return { ok: false, error: 'File has no data rows' };
  }

  const header = sniffHeader(records[0]);
  const hasAmount = header.amount !== undefined;
  const hasDebitCredit = header.debit !== undefined || header.credit !== undefined;

  if (header.date === undefined) {
    return { ok: false, error: 'Could not find a date column in the header row' };
  }
  if (!hasAmount && !hasDebitCredit) {
    return { ok: false, error: 'Could not find an amount (or debit/credit) column in the header row' };
  }

  const cell = (record, index) => (index !== undefined && index < record.length ? record[index] : '');

  const rows = [];

  for (const record of records.slice(1)) {
    if (record.every((f) => f.trim() === '')) continue;

    const problems = [];
    const rawText = record.join(',');

    const date = parseDateToISO(cell(record, header.date));
    if (!date.ok) problems.push('unreadable date');

    const description = cell(record, header.description).trim();
    if (description === '') problems.push('missing description');

    let amountCents = null;

    if (hasAmount) {
      const amount = parseAmountToCents(cell(record, header.amount));
      if (amount.ok) amountCents = amount.cents;
      else problems.push('unreadable amount');
    } else {
      // Separate columns: debit is money out regardless of how the
      // issuer signed it, credit is money in.
      const debit = parseAmountToCents(cell(record, header.debit));
      const credit = parseAmountToCents(cell(record, header.credit));

      if (debit.ok && credit.ok && debit.cents !== 0 && credit.cents !== 0) {
        amountCents = credit.cents - Math.abs(debit.cents);
        problems.push('both debit and credit present');
      } else if (debit.ok && debit.cents !== 0) {
        amountCents = -Math.abs(debit.cents);
      } else if (credit.ok) {
        amountCents = credit.cents;
      } else if (debit.ok) {
        amountCents = 0;
      } else {
        problems.push('unreadable amount');
      }
    }

    rows.push({
      posted_date: date.ok ? date.iso : null,
      description: description || null,
      amount_cents: amountCents,
      confidence: problems.length > 0 ? 'LOW' : 'HIGH',
      raw_text: rawText,
      problems,
    });
  }

  if (rows.length === 0) {
    return { ok: false, error: 'File has no data rows' };
  }

  return { ok: true, rows };
}
