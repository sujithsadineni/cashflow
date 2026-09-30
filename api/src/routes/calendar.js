/**
 * GET /api/calendar?month=YYYY-MM — one round trip for the Recurring
 * page's calendar grid: every day in the month (padded to full weeks
 * so the grid has no holes), each day's real transactions, and which
 * recurring series landed there — PAID (a real linked transaction),
 * UPCOMING (predicted, in the future) or MISSED (predicted, in the
 * past, nothing showed up). Predictions are computed here from
 * recurring_series and never written anywhere — nothing enters
 * `transaction` that didn't come off a statement.
 */

import { Router } from 'express';
import { query } from '../db.js';
import { projectOccurrences, isLapsed } from '../recurring.js';

export const calendarRouter = Router();

const isoDate = (d) => d.toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00`) - new Date(`${a}T00:00:00`)) / 86400000);

// A real transaction can land a few days off a series' predicted date
// (weekends, a statement's own posting delay) — this is how far to
// look before deciding a predicted occurrence is actually MISSED.
const MATCH_TOLERANCE_DAYS = 5;

calendarRouter.get('/', async (req, res, next) => {
  try {
    const month = req.query.month;
    if (!/^\d{4}-\d{2}$/.test(month ?? '')) {
      return res.status(400).json({ error: 'month must be YYYY-MM' });
    }

    const [y, m] = month.split('-').map(Number);
    const monthStart = `${month}-01`;
    const monthEnd = `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;

    // Pad to full weeks (Sun-Sat) so the grid has no holes at the edges.
    const firstOfMonth = new Date(`${monthStart}T00:00:00`);
    const gridStartDate = new Date(firstOfMonth);
    gridStartDate.setDate(gridStartDate.getDate() - firstOfMonth.getDay());
    const lastOfMonth = new Date(`${monthEnd}T00:00:00`);
    const gridEndDate = new Date(lastOfMonth);
    gridEndDate.setDate(gridEndDate.getDate() + (6 - lastOfMonth.getDay()));
    const gridStart = isoDate(gridStartDate);
    const gridEnd = isoDate(gridEndDate);

    const { rows: transactions } = await query(
      `SELECT t.id, t.posted_date::text, t.amount_cents, t.merchant, t.description, t.recurring_series_id,
              rs.name AS series_name, rs.glyph AS series_glyph
         FROM transaction t
         LEFT JOIN recurring_series rs ON rs.id = t.recurring_series_id
        WHERE t.posted_date >= $1 AND t.posted_date <= $2
        ORDER BY t.posted_date, t.id`,
      [gridStart, gridEnd]
    );
    const { rows: activeSeries } = await query(`SELECT * FROM recurring_series WHERE status = 'ACTIVE'`);
    // Same "fall off, don't predict forever" rule as everywhere else
    // lapsed is used (see isLapsed in recurring.js) — a subscription
    // that's gone 1.5+ cadence cycles unconfirmed shouldn't keep
    // generating UPCOMING/MISSED chips into every future month.
    const series = activeSeries.filter((s) => !isLapsed(s.next_expected_date, s.cadence, s.cadence_interval));

    const byDate = new Map();
    const ensureDay = (date) => {
      if (!byDate.has(date)) byDate.set(date, { transactions: [], recurring: [] });
      return byDate.get(date);
    };

    for (const t of transactions) {
      const day = ensureDay(t.posted_date);
      day.transactions.push({ id: t.id, amount_cents: t.amount_cents, merchant: t.merchant, description: t.description });
      if (t.recurring_series_id) {
        day.recurring.push({
          series_id: t.recurring_series_id, name: t.series_name, glyph: t.series_glyph,
          amount_cents: t.amount_cents, status: 'PAID', transaction_id: t.id,
        });
      }
    }

    const today = isoDate(new Date());

    for (const s of series) {
      const projected = projectOccurrences(s, gridStart, gridEnd);
      const realDates = transactions.filter((t) => t.recurring_series_id === s.id).map((t) => t.posted_date);

      for (const d of projected) {
        const alreadyCovered = realDates.some((rd) => Math.abs(daysBetween(rd, d)) <= MATCH_TOLERANCE_DAYS);
        if (alreadyCovered) continue;

        ensureDay(d).recurring.push({
          series_id: s.id, name: s.name, glyph: s.glyph,
          amount_cents: s.expected_amount_cents, status: d >= today ? 'UPCOMING' : 'MISSED',
        });
      }
    }

    const days = [];
    for (let cursor = new Date(gridStartDate); cursor <= gridEndDate; cursor.setDate(cursor.getDate() + 1)) {
      const date = isoDate(cursor);
      const entry = byDate.get(date) ?? { transactions: [], recurring: [] };
      const totalSpendCents = entry.transactions.filter((t) => t.amount_cents < 0).reduce((sum, t) => sum + t.amount_cents, 0);
      days.push({
        date,
        in_month: date.slice(0, 7) === month,
        total_spend_cents: totalSpendCents,
        transactions: entry.transactions,
        recurring: entry.recurring,
      });
    }

    const inMonth = days.filter((d) => d.in_month);
    const totals = {
      spend_cents: inMonth.reduce((sum, d) => sum + d.total_spend_cents, 0),
      recurring_spend_cents: inMonth.reduce(
        (sum, d) => sum + d.recurring.filter((r) => r.status === 'PAID').reduce((s, r) => s + Math.min(r.amount_cents, 0), 0),
        0
      ),
      upcoming_recurring_cents: inMonth.reduce(
        (sum, d) => sum + d.recurring.filter((r) => r.status === 'UPCOMING').reduce((s, r) => s + Math.min(r.amount_cents, 0), 0),
        0
      ),
    };

    res.json({ month, days, totals });
  } catch (err) {
    next(err);
  }
});
