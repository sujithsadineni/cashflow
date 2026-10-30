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
import { query } from '../core/db.js';
import { audit } from '../core/audit.js';
import { validate, alertSnoozeSchema } from '../core/validate.js';
import { logger } from '../core/logger.js';
import { step, suggestionKey } from '../money/bills.js';
import { getBills, getSuggestions } from './recurring.js';
import { loadStatementGaps } from '../statements/statement-gaps-run.js';
import { loadCardDates } from '../statements/card-dates-run.js';
import { nextClose } from '../statements/card-dates.js';
import { termsChanges } from '../statements/terms-change.js';
import { highUse, spendJumps, USUAL_OF } from '../statements/card-alerts.js';

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
    SELECT a.id AS account_id, a.name, a.mask, a.closing_day, ib.last_period_end,
           to_char(ib.last_period_end, 'YYYY-MM-DD') AS last_end, to_char(ib.last_period_end + 1, 'YYYY-MM-DD') AS next_start
      FROM account a
      LEFT JOIN LATERAL (
        SELECT MAX(period_end) AS last_period_end
          FROM import_batch
         WHERE account_id = a.id AND period_end IS NOT NULL
      ) ib ON true
     WHERE a.is_active = true
  `);

  // A card quiet since its last statement isn't late: it sent none (D268). Review asks
  // about a "likely quiet" one instead of this nagging; missing or can't-tell still nags.
  const quietSince = {
    cards: null,
    async has(accountId) {
      this.cards ??= await loadStatementGaps({ today });
      const trailing = this.cards.find((c) => c.account_id === accountId)?.gaps.find((g) => g.trailing);
      return Boolean(trailing) && trailing.cycles.every((c) => c.verdict === 'quiet' || c.verdict === 'likely_quiet');
    },
  };

  const overdue = [];
  for (const row of rows) {
    if (!row.last_period_end) continue;
    // A card with a closing day closes on it (D270); otherwise a month after the last statement.
    // From the date as stored, not a Date object: one shifts a day west of UTC (D320).
    const expectedNext = row.closing_day ? nextClose(row.last_end, row.closing_day) : step(row.last_end, 'MONTHLY');
    const deadline = isoDate(new Date(new Date(`${expectedNext}T00:00:00`).getTime() + STATEMENT_GRACE_DAYS * 86_400_000));
    if (today > deadline && !(await quietSince.has(row.account_id))) {
      overdue.push({
        account_id: row.account_id,
        account_name: row.name,
        mask: row.mask,
        expected_by: deadline,
        days_overdue: daysBetween(deadline, today),
        // The statement itself (D320): the day it closed, and the day after the last one.
        closed_on: expectedNext,
        period_start: row.next_start,
      });
    }
  }
  return overdue;
}

/**
 * Card bills that need paying (D270): past their date with the minimum
 * unpaid, only the minimum paid, due within days, and (D361) any other bill
 * not paid yet, from the day its statement closes, so a big one weeks out is
 * seen (status 'due'). A bill the app can't see a payment for yet
 * ("unconfirmed") isn't nagged about.
 */
const PAYMENT_ALERT = new Set(['due', 'due_soon', 'overdue', 'minimum_paid']);
async function findCardPayments(today) {
  const [{ rows: cards }, dates] = await Promise.all([
    query(`SELECT id, name, mask FROM account WHERE account_type = 'CREDIT_CARD' AND is_active`),
    loadCardDates({ today }),
  ]);
  return cards
    .map((c) => ({ c, due: dates.get(c.id)?.due }))
    .filter(({ due }) => due && PAYMENT_ALERT.has(due.status))
    .map(({ c, due }) => ({
      account_id: c.id,
      account_name: c.name,
      mask: c.mask,
      status: due.status,
      due_date: due.due_date,
      days_left: due.days_left,
      remaining_cents: due.remaining_cents,
      minimum_remaining_cents: due.minimum_remaining_cents,
    }))
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
}

/**
 * Bills that are late (D185): past their date by more than the cadence's
 * grace, with no charge seen. The same rule the Recurring page shows.
 */
async function findLateBills() {
  const bills = await getBills();
  return bills
    .filter((b) => b.state === 'late')
    .map((b) => ({ id: b.id, name: b.name, glyph: b.glyph, expected_amount_cents: b.expected_amount_cents, expected_date: b.next_date }));
}

/**
 * A card whose newest statement printed a different purchase APR or credit
 * limit from the one before (D349). Only while that statement is recent
 * (closed in the last 60 days), so history doesn't nag.
 */
const TERMS_RECENT_DAYS = 60;
async function findTermsChanges(today) {
  const { rows } = await query(
    `SELECT a.id AS account_id, a.name AS account_name, a.mask, to_char(s.period_end, 'YYYY-MM-DD') AS period_end,
            s.apr_purchase_bps, s.credit_limit_cents,
            p.apr_purchase_bps AS prev_apr_purchase_bps, p.credit_limit_cents AS prev_credit_limit_cents
       FROM account a
       JOIN LATERAL (SELECT * FROM statement WHERE account_id = a.id ORDER BY period_end DESC LIMIT 1) s ON true
       JOIN LATERAL (SELECT * FROM statement WHERE account_id = a.id AND period_end < s.period_end ORDER BY period_end DESC LIMIT 1) p ON true
      WHERE a.is_active AND a.account_type = 'CREDIT_CARD'`
  );
  return rows
    .filter((r) => daysBetween(r.period_end, today) <= TERMS_RECENT_DAYS)
    .map((r) => ({
      account_id: r.account_id, account_name: r.account_name, mask: r.mask, period_end: r.period_end,
      changes: termsChanges(r, { apr_purchase_bps: r.prev_apr_purchase_bps, credit_limit_cents: r.prev_credit_limit_cents }),
    }))
    .filter((r) => r.changes.length > 0);
}

/**
 * Cards using a lot of their limit, and cards whose spending jumped (D361),
 * from each open card's newest statement while it's recent; the rules are in
 * statements/card-alerts.js.
 */
const USE_RECENT_DAYS = 45;
async function findCardUse(today) {
  const { rows } = await query(
    `SELECT a.id AS account_id, a.name AS account_name, a.mask, to_char(s.period_end, 'YYYY-MM-DD') AS period_end,
            s.closing_balance_cents, s.credit_limit_cents, a.credit_limit_manual_cents, s.total_spend_cents AS spend_cents,
            (SELECT array_agg(p.total_spend_cents ORDER BY p.period_end DESC)
               FROM (SELECT total_spend_cents, period_end FROM statement
                      WHERE account_id = a.id AND period_end < s.period_end ORDER BY period_end DESC LIMIT $1) p) AS earlier
       FROM account a
       JOIN LATERAL (SELECT * FROM statement WHERE account_id = a.id ORDER BY period_end DESC LIMIT 1) s ON true
      WHERE a.is_active AND a.account_type = 'CREDIT_CARD'`,
    [USUAL_OF]
  );
  const recent = rows.filter((r) => daysBetween(r.period_end, today) <= USE_RECENT_DAYS);
  return { highUse: highUse(recent), spendJumps: spendJumps(recent) };
}

/**
 * A terms-change notice a card's statement carried (D350), from that
 * statement until a month after the change takes effect.
 */
const NOTICE_AFTER_DAYS = 30;
async function findTermsNotices(today) {
  const { rows } = await query(
    `SELECT DISTINCT ON (a.id, s.terms_notice->>'effective_on')
            a.id AS account_id, a.name AS account_name, a.mask, to_char(s.period_end, 'YYYY-MM-DD') AS period_end, s.terms_notice
       FROM statement s JOIN account a ON a.id = s.account_id
      WHERE a.is_active AND s.terms_notice IS NOT NULL
      ORDER BY a.id, s.terms_notice->>'effective_on', s.period_end DESC`
  );
  return rows
    .filter((r) => daysBetween(r.terms_notice.effective_on, today) <= NOTICE_AFTER_DAYS)
    .map((r) => ({ account_id: r.account_id, account_name: r.account_name, mask: r.mask, period_end: r.period_end, ...r.terms_notice }));
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
  CARD_PAYMENT_DUE: (p) => `card:${p.account_id}:${p.due_date}`,
  CARD_TERMS_CHANGED: (t) => `card:${t.account_id}:${t.period_end}`,
  TERMS_NOTICE: (n) => `card:${n.account_id}:${n.effective_on}`,
  CARD_HIGH_USE: (u) => `card:${u.account_id}:${u.period_end}`,
  CARD_SPEND_JUMP: (j) => `card:${j.account_id}:${j.period_end}`,
};

const TITLE = {
  OVERDUE_STATEMENT: (s) => `${s.account_name}${s.mask ? ` ···${s.mask}` : ''} statement`,
  MISSED_RECURRING: (s) => s.name,
  NEW_RECURRING: (c) => c.suggested_name,
  PENDING_REVIEW: (b) => `${b.account_name} — ${b.pending_count} to review`,
  CARD_PAYMENT_DUE: (p) => `${p.account_name}${p.mask ? ` ···${p.mask}` : ''} payment`,
  CARD_TERMS_CHANGED: (t) => `${t.account_name}${t.mask ? ` ···${t.mask}` : ''} terms changed`,
  TERMS_NOTICE: (n) => `${n.account_name}${n.mask ? ` ···${n.mask}` : ''} terms change ${n.effective_on}`,
  CARD_HIGH_USE: (u) => `${u.account_name}${u.mask ? ` ···${u.mask}` : ''} at ${u.pct}% of its limit`,
  CARD_SPEND_JUMP: (j) => `${j.account_name}${j.mask ? ` ···${j.mask}` : ''} spending ${j.ratio}× usual`,
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
  const [statements, missed, candidates, pending, payments, terms, notices, use] = await Promise.all([
    findOverdueStatements(today),
    findLateBills(),
    getSuggestions().then((list) =>
      list.map((s) => ({ suggested_name: s.name, match_name_contains: suggestionKey(s), cadence: s.cadence, expected_amount_cents: s.expected_amount_cents }))
    ),
    findPendingReview(),
    findCardPayments(today),
    findTermsChanges(today),
    findTermsNotices(today),
    findCardUse(today),
  ]);
  return { statements, missed, candidates, pending, payments, terms, notices, highUse: use.highUse, spendJumps: use.spendJumps };
}

/** Best-effort — a failure here must never break the alerts response itself. */
async function persistCurrentMonth({ statements, missed, candidates, pending, payments, terms, notices, highUse: high, spendJumps: jumps }) {
  const month = currentMonth();
  try {
    await Promise.all([
      persist('OVERDUE_STATEMENT', month, statements),
      persist('MISSED_RECURRING', month, missed),
      persist('NEW_RECURRING', month, candidates),
      persist('PENDING_REVIEW', month, pending),
      persist('CARD_PAYMENT_DUE', month, payments),
      persist('CARD_TERMS_CHANGED', month, terms),
      persist('TERMS_NOTICE', month, notices),
      persist('CARD_HIGH_USE', month, high),
      persist('CARD_SPEND_JUMP', month, jumps),
    ]);
    // An alert still open from an earlier month is closed now (D315): only the
    // current month is ever re-checked, so September's "3 days late" stayed open
    // beside October's "24 days late". Whatever is still true was just recorded
    // for this month; the rest was fixed or no longer applies (an archived bill).
    await query(`UPDATE alert SET resolved_at = now(), updated_at = now() WHERE month < $1 AND resolved_at IS NULL`, [month]);
  } catch (err) {
    logger.error({ err }, 'failed to persist alert history');
  }
}

/**
 * Card payments with no known source (D199/D200), and pending Review
 * fixes that change totals, summed by which total they move.
 */
const TOTALS_KINDS = ['zelle_card_payment', 'card_deposit', 'card_now_tracked', 'type_reward', 'abroad', 'income_internal', 'audit_roommate_rent'];
async function paymentAndReviewNudges() {
  const { rows: payments } = await query(
    `SELECT t.id, a.name AS account_name, to_char(t.posted_date, 'YYYY-MM-DD') AS posted_date, t.amount_cents
       FROM payment_match m JOIN transaction t ON t.id = m.card_transaction_id JOIN account a ON a.id = t.account_id
      WHERE m.status = 'unverified'
      ORDER BY t.posted_date DESC, t.id DESC`
  );
  const { rows: review } = await query(
    `SELECT r.check_kind, COUNT(*)::int AS count, COALESCE(SUM(abs(t.amount_cents)), 0)::bigint AS cents,
            array_agg(r.id ORDER BY r.id) AS ids
       FROM transaction_review r JOIN transaction t ON t.id = r.transaction_id
      WHERE r.status = 'pending' AND r.check_kind = ANY($1)
      GROUP BY r.check_kind`,
    [TOTALS_KINDS]
  );
  return {
    payments_unknown: payments,
    review_changes: review.map((r) => ({ ...r, cents: Number(r.cents) })),
  };
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
      // D270: card bills due within days, overdue, or only the minimum paid.
      card_payments_due: live.payments,
      // D349: a card's APR or limit that changed on its newest statement.
      card_terms_changed: live.terms,
      // D350: a notice that a card's terms change on a date.
      terms_notices: live.notices,
      // D361: a card at 30% or more of its limit, and a card spending twice its usual.
      card_high_use: live.highUse,
      card_spend_jumps: live.spendJumps,
      // D201: what the payment matcher and Review found, for their toasts.
      // Not persisted to alert history: both have their own page that is
      // the record (Review), so this is only a nudge.
      ...(await paymentAndReviewNudges()),
      // What the household has answered (D318): every view hides these the same way.
      snoozed: await activeSnoozes(),
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

/* ------------------------------------------------------------------
   Answering an alert (D318): snooze, dismiss, or mark a card bill paid.
   ------------------------------------------------------------------ */

/** Answers still in force: dismissed and paid for good, a snooze until its day. */
async function activeSnoozes() {
  const { rows } = await query(
    `SELECT key, ref, kind, to_char(until, 'YYYY-MM-DD') AS until FROM alert_snooze
      WHERE until IS NULL OR until >= CURRENT_DATE ORDER BY id`
  );
  return rows;
}

alertsRouter.post('/snooze', validate(alertSnoozeSchema), async (req, res, next) => {
  try {
    const { key, ref, kind, days } = req.body;
    const { rows: [row] } = await query(
      `INSERT INTO alert_snooze (key, ref, kind, until)
       VALUES ($1, $2, $3, CASE WHEN $4::int IS NULL THEN NULL ELSE CURRENT_DATE + $4::int END)
       ON CONFLICT (key, ref) DO UPDATE SET kind = EXCLUDED.kind, until = EXCLUDED.until, created_at = now()
       RETURNING id, key, ref, kind, to_char(until, 'YYYY-MM-DD') AS until`,
      [key, ref, kind, kind === 'snooze' ? days : null]
    );
    await audit({ action: 'alert.answered', entityType: 'alert', entityId: row.id, detail: { key, ref, kind, until: row.until } });
    res.status(201).json(row);
  } catch (err) {
    next(err);
  }
});

/** Undo an answer: the alert shows again. */
alertsRouter.delete('/snooze', async (req, res, next) => {
  try {
    const key = String(req.query.key ?? '');
    const ref = String(req.query.ref ?? '');
    if (!key) return res.status(400).json({ error: 'Which alert', field: 'key' });
    const { rows } = await query('DELETE FROM alert_snooze WHERE key = $1 AND ref = $2 RETURNING id', [key, ref]);
    if (rows.length === 0) return res.status(404).json({ error: 'Not answered' });
    await audit({ action: 'alert.unanswered', entityType: 'alert', entityId: rows[0].id, detail: { key, ref } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
