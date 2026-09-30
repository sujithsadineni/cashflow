/**
 * GET /api/alerts — one lean round trip for everything worth telling
 * the household about without them going and looking for it: a
 * statement that should have shown up by now, a recurring bill that
 * didn't land this month, a new recurring charge nobody's confirmed
 * yet, transactions sitting in review. The frontend calls this once
 * per session (App.jsx) and turns each finding into a toast
 * (notification-context.jsx) — this file only computes the list, it
 * knows nothing about how it's displayed.
 *
 * GET /api/alerts/history — the persistent version of the same
 * findings, for the Alerts page (browsable by month/YTD, with a
 * cleared section). See db/022_alert_history.sql's own docs for why
 * this only ever WRITES for the current month: every other month is
 * pure history of what was actually recorded while it was current,
 * never re-derived after the fact.
 *
 * Deliberately not separate endpoints per finding type: the frontend
 * needs all of them at once, and every query here is scoped as tight
 * as the question actually is — no 2-year scan except the one case
 * (new-candidate detection) that genuinely needs history to classify
 * a cadence from.
 */

import { Router } from 'express';
import { query } from '../db.js';
import { logger } from '../logger.js';
import { projectOccurrences, isLapsed, addCadence } from '../recurring.js';
import { getRecurringCandidates } from './recurring.js';

export const alertsRouter = Router();

// Local calendar-date components, not .toISOString() — that converts
// to UTC, which silently becomes tomorrow's date for the back half of
// every US evening (the household's own working hours). A "due
// today" bill would falsely read as overdue the moment the clock
// crossed into UTC tomorrow while it was still today here.
const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00`) - new Date(`${a}T00:00:00`)) / 86_400_000);
const currentMonth = () => isoDate(new Date()).slice(0, 7);

// How many days past the expected next statement date before it's
// worth a nag rather than just "not due yet" — statements don't all
// close and land on exactly the same day of the month, and this
// household's own upload habit isn't same-day either.
const STATEMENT_GRACE_DAYS = 10;

/**
 * Every active account's most recent statement, assuming a monthly
 * cadence — true of every account type this household actually has
 * (checking, savings, and every card), and simpler than inferring a
 * per-account interval from history for a household this size. An
 * account with no statement history at all is skipped: there's no
 * cadence to judge "overdue" against yet, and a brand-new account
 * nagging on day one would be a false alarm, not a real one.
 */
async function findOverdueStatements(today) {
  const { rows } = await query(`
    SELECT a.id AS account_id, a.name, a.mask, ib.last_period_end
      FROM account a
      LEFT JOIN LATERAL (
        SELECT MAX(period_end) AS last_period_end
          FROM import_batch
         WHERE account_id = a.id AND period_end IS NOT NULL
      ) ib ON true
     WHERE a.is_active = true
  `);

  const overdue = [];
  for (const row of rows) {
    if (!row.last_period_end) continue;
    const expectedNext = addCadence(row.last_period_end, 'MONTHLY', 1);
    const deadline = isoDate(new Date(new Date(`${expectedNext}T00:00:00`).getTime() + STATEMENT_GRACE_DAYS * 86_400_000));
    if (today > deadline) {
      overdue.push({
        account_id: row.account_id,
        account_name: row.name,
        mask: row.mask,
        expected_by: deadline,
        days_overdue: daysBetween(deadline, today),
      });
    }
  }
  return overdue;
}

/**
 * Active, still-relevant (not lapsed — see isLapsed's own docs)
 * series whose only occurrence expected so far THIS calendar month
 * has no real transaction linked to it. Deliberately a coarser check
 * than the Recurring calendar's day-by-day MISSED chips
 * (routes/calendar.js): "did anything from this series land this
 * month at all" is the right grain for a once-a-session notice, and
 * skips building a full month grid this endpoint doesn't need.
 */
async function findMissedThisMonth(today) {
  const monthStart = `${today.slice(0, 7)}-01`;
  const monthEnd = isoDate(new Date(new Date(`${monthStart}T00:00:00`).getFullYear(), new Date(`${monthStart}T00:00:00`).getMonth() + 1, 0));

  const { rows: series } = await query(`SELECT * FROM recurring_series WHERE status = 'ACTIVE'`);
  const relevant = series.filter((s) => !isLapsed(s.next_expected_date, s.cadence, s.cadence_interval));
  if (relevant.length === 0) return [];

  const { rows: linked } = await query(
    `SELECT DISTINCT recurring_series_id FROM transaction
      WHERE recurring_series_id IS NOT NULL AND posted_date >= $1 AND posted_date <= $2`,
    [monthStart, monthEnd]
  );
  const coveredIds = new Set(linked.map((r) => r.recurring_series_id));

  const missed = [];
  for (const s of relevant) {
    if (coveredIds.has(s.id)) continue;
    // Strictly before today, not on-or-before — something due TODAY
    // hasn't necessarily posted yet (statements process overnight),
    // and the Recurring calendar's own MISSED chips (routes/
    // calendar.js) already draw this same line at today, not before.
    const dueDatesSoFar = projectOccurrences(s, monthStart, today).filter((d) => d < today);
    if (dueDatesSoFar.length === 0) continue; // not overdue yet this month
    missed.push({
      id: s.id,
      name: s.name,
      glyph: s.glyph,
      expected_amount_cents: s.expected_amount_cents,
      expected_date: dueDatesSoFar[0],
    });
  }
  return missed;
}

/**
 * Import batches sitting in REVIEW with staged rows nobody's approved
 * or rejected yet — the household asked for this explicitly as its
 * own alert type, distinct from the other three, since a stalled
 * review means real transactions aren't in the ledger at all yet.
 */
async function findPendingReview() {
  const { rows } = await query(`
    SELECT ib.id AS batch_id, ib.account_id, a.name AS account_name, ib.original_filename,
           COUNT(st.id) FILTER (WHERE st.review_status = 'PENDING') AS pending_count
      FROM import_batch ib
      JOIN account a ON a.id = ib.account_id
      LEFT JOIN staged_transaction st ON st.import_batch_id = ib.id
     WHERE ib.status = 'REVIEW'
     GROUP BY ib.id, ib.account_id, a.name, ib.original_filename
    HAVING COUNT(st.id) FILTER (WHERE st.review_status = 'PENDING') > 0
  `);
  return rows.map((r) => ({
    batch_id: r.batch_id,
    account_id: r.account_id,
    account_name: r.account_name,
    original_filename: r.original_filename,
    pending_count: Number(r.pending_count),
  }));
}

/* ------------------------------------------------------------------
   Persistence — writes only ever target the current month (see this
   file's own docs and db/022_alert_history.sql). Each type has a
   stable natural key so re-running this against the same live state
   is a no-op, and an item that stops appearing live gets resolved_at
   set rather than deleted.
   ------------------------------------------------------------------ */

const NATURAL_KEY = {
  OVERDUE_STATEMENT: (s) => `account:${s.account_id}`,
  MISSED_RECURRING: (s) => `series:${s.id}`,
  NEW_RECURRING: (c) => `candidate:${c.match_name_contains}`,
  PENDING_REVIEW: (b) => `batch:${b.batch_id}`,
};

const TITLE = {
  OVERDUE_STATEMENT: (s) => `${s.account_name}${s.mask ? ` ···${s.mask}` : ''} statement`,
  MISSED_RECURRING: (s) => s.name,
  NEW_RECURRING: (c) => c.suggested_name,
  PENDING_REVIEW: (b) => `${b.account_name} — ${b.pending_count} to review`,
};

async function persist(type, month, liveItems) {
  const keyFn = NATURAL_KEY[type];
  const titleFn = TITLE[type];
  const liveKeys = liveItems.map(keyFn);

  for (const item of liveItems) {
    await query(
      `INSERT INTO alert (type, natural_key, month, title, detail)
            VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (type, natural_key, month)
       DO UPDATE SET title = EXCLUDED.title, detail = EXCLUDED.detail, resolved_at = NULL, updated_at = now()`,
      [type, keyFn(item), month, titleFn(item), JSON.stringify(item)]
    );
  }

  // Anything previously unresolved for this type/month that's no
  // longer in the live set has been fixed — mark it cleared. An empty
  // live set clears everything still open for this type/month.
  await query(
    `UPDATE alert SET resolved_at = now(), updated_at = now()
      WHERE type = $1 AND month = $2 AND resolved_at IS NULL
        AND NOT (natural_key = ANY($3::text[]))`,
    [type, month, liveKeys]
  );
}

/** Live-compute every finding for right now. Shared by GET / and GET /history for the current month. */
async function computeLive() {
  const today = isoDate(new Date());
  const [statements, missed, candidates, pending] = await Promise.all([
    findOverdueStatements(today),
    findMissedThisMonth(today),
    getRecurringCandidates(),
    findPendingReview(),
  ]);
  return { statements, missed, candidates, pending };
}

/** Best-effort — a failure here must never break the alerts response itself. */
async function persistCurrentMonth({ statements, missed, candidates, pending }) {
  const month = currentMonth();
  try {
    await Promise.all([
      persist('OVERDUE_STATEMENT', month, statements),
      persist('MISSED_RECURRING', month, missed),
      persist('NEW_RECURRING', month, candidates),
      persist('PENDING_REVIEW', month, pending),
    ]);
  } catch (err) {
    logger.error({ err }, 'failed to persist alert history');
  }
}

alertsRouter.get('/', async (req, res, next) => {
  try {
    const live = await computeLive();
    await persistCurrentMonth(live);

    res.json({
      overdue_statements: live.statements,
      missed_recurring: live.missed,
      // Only the fields a toast needs — the full candidate shape
      // (evidence transactions, etc.) is what "Review detected"
      // fetches fresh for itself when actually building the card.
      new_recurring: live.candidates.map((c) => ({
        name: c.suggested_name,
        match_name_contains: c.match_name_contains,
        cadence: c.cadence,
        expected_amount_cents: c.expected_amount_cents,
      })),
      pending_review: live.pending,
    });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------
   History — the Alerts page. Current month: live-compute, persist,
   then read back. Any other month: read-only, whatever was actually
   recorded while it was current.
   ------------------------------------------------------------------ */

function splitActiveCleared(rows) {
  return {
    active: rows.filter((r) => r.resolved_at == null),
    cleared: rows.filter((r) => r.resolved_at != null),
  };
}

alertsRouter.get('/history', async (req, res, next) => {
  try {
    const { month, year, ytd } = req.query;
    const thisMonth = currentMonth();

    if (ytd === 'true') {
      const y = year || thisMonth.slice(0, 4);
      const from = `${y}-01`;
      const to = y === thisMonth.slice(0, 4) ? thisMonth : `${y}-12`;

      if (y === thisMonth.slice(0, 4)) {
        await persistCurrentMonth(await computeLive());
      }

      const { rows } = await query(
        `SELECT * FROM alert WHERE month BETWEEN $1 AND $2 ORDER BY month, type, first_detected_at`,
        [from, to]
      );
      return res.json({ from, to, ...splitActiveCleared(rows) });
    }

    const targetMonth = month || thisMonth;
    if (targetMonth > thisMonth) {
      // No forecasting alerts for a month that hasn't happened yet —
      // same "future is capped, never projected" rule as loans.js.
      return res.json({ month: targetMonth, active: [], cleared: [] });
    }

    if (targetMonth === thisMonth) {
      await persistCurrentMonth(await computeLive());
    }

    const { rows } = await query(
      `SELECT * FROM alert WHERE month = $1 ORDER BY type, first_detected_at`,
      [targetMonth]
    );
    res.json({ month: targetMonth, ...splitActiveCleared(rows) });
  } catch (err) {
    next(err);
  }
});
