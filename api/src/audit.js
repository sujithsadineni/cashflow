/**
 * The audit log.
 *
 * This is the permanent, queryable record of everything the app does
 * to your data. It lives in Postgres, not in a file, so you can answer
 * questions like "which import created this transaction?" with a join.
 *
 * The rule: anything that changes data gets an audit entry. Reads
 * don't. If you ever find yourself unsure whether an action deserves
 * one, it does.
 *
 * Action names use dot notation so they group naturally when you
 * filter: import.uploaded, import.parsed, import.approved,
 * transaction.created, transaction.edited, transaction.deleted.
 */

import { query } from './db.js';
import { logger } from './logger.js';

export async function audit({ action, entityType = null, entityId = null, detail = {}, actor = 'system' }) {
  try {
    await query(
      `INSERT INTO audit_log (action, entity_type, entity_id, detail, actor)
       VALUES ($1, $2, $3, $4, $5)`,
      [action, entityType, entityId, JSON.stringify(detail), actor]
    );
    logger.info({ action, entityType, entityId }, 'audit');
  } catch (err) {
    // An audit write failing should never take down the operation it
    // was recording. Log loudly and carry on.
    logger.error({ err, action }, 'failed to write audit entry');
  }
}

/**
 * The Activity page's areas (D142) — a fixed allow-list of action
 * prefixes, so a filter covers ALL history server-side rather than
 * just whichever page the client happens to have loaded. Patterns only
 * ever come from here, never from the request.
 */
export const ACTIVITY_AREAS = {
  transactions: ['transaction.%', 'zelle.%', 'merchant_review.%'],
  imports: ['import.%', 'statement.%'],
  recurring: ['recurring.%'],
  setup: ['account.%', 'category.%', 'loan.%', 'contact.%', 'person.%', 'merchant_icon.%', 'app_setting.%'],
};

/**
 * Recent activity, newest first; optionally one area, one entity (a
 * transaction's own history, D145), and only entries older than
 * `beforeId` (paging).
 */
export async function recentActivity(limit = 100, { area = null, beforeId = null, entityType = null, entityId = null } = {}) {
  const { rows } = await query(
    // `subject` is the current name of whatever the entry touched, so a
    // row can say "Transaction edited · Costco" even though the entry
    // itself only recorded an id. Each join is on a primary key and
    // gated on entity_type, so at most one ever matches.
    `SELECT a.id, a.action, a.entity_type, a.entity_id, a.detail, a.actor, a.created_at,
            COALESCE(t.merchant, t.description, acc.name, l.name, rs.name, ct.name) AS subject
       FROM audit_log a
       LEFT JOIN transaction t       ON a.entity_type = 'transaction'      AND t.id = a.entity_id
       LEFT JOIN account acc         ON a.entity_type = 'account'          AND acc.id = a.entity_id
       LEFT JOIN loan l              ON a.entity_type = 'loan'             AND l.id = a.entity_id
       LEFT JOIN recurring_series rs ON a.entity_type = 'recurring_series' AND rs.id = a.entity_id
       LEFT JOIN contact ct          ON a.entity_type = 'contact'          AND ct.id = a.entity_id
      WHERE ($1::text[] IS NULL OR a.action LIKE ANY ($1))
        AND ($2::int IS NULL OR a.id < $2)
        AND ($4::text IS NULL OR (a.entity_type = $4 AND a.entity_id = $5))
      ORDER BY a.id DESC
      LIMIT $3`,
    [ACTIVITY_AREAS[area] ?? null, beforeId, limit, entityType, entityId]
  );
  return rows;
}
