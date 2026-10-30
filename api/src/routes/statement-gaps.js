/**
 * Statement gaps (D268): which months a card has no statement for, and
 * whether that's a quiet month or a statement to upload. Judged live on
 * every read (statement-gaps.js); only the household's "No statement
 * this month" answers are stored.
 */

import { Router } from 'express';
import { query } from '../core/db.js';
import { audit } from '../core/audit.js';
import { validate, statementGapAnswerSchema } from '../core/validate.js';
import { loadStatementGaps } from '../statements/statement-gaps-run.js';

export const statementGapsRouter = Router();

statementGapsRouter.get('/', async (req, res, next) => {
  try {
    res.json(await loadStatementGaps());
  } catch (err) {
    next(err);
  }
});

statementGapsRouter.post('/answer', validate(statementGapAnswerSchema), async (req, res, next) => {
  try {
    const { account_id, cycle_end } = req.body;
    const { rows: card } = await query(`SELECT name FROM account WHERE id = $1 AND account_type = 'CREDIT_CARD'`, [account_id]);
    if (card.length === 0) return res.status(400).json({ error: 'Not a card', field: 'account_id' });
    const { rowCount } = await query(
      `INSERT INTO statement_gap_answer (account_id, cycle_end) VALUES ($1, $2) ON CONFLICT (account_id, cycle_end) DO NOTHING`,
      [account_id, cycle_end]
    );
    if (rowCount > 0) {
      await audit({ action: 'statement_gap.answered', entityType: 'account', entityId: account_id, detail: { name: card[0].name, cycle_end, answer: 'No statement this month' } });
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

statementGapsRouter.delete('/answer', validate(statementGapAnswerSchema), async (req, res, next) => {
  try {
    const { account_id, cycle_end } = req.body;
    const { rowCount } = await query(`DELETE FROM statement_gap_answer WHERE account_id = $1 AND cycle_end = $2`, [account_id, cycle_end]);
    if (rowCount > 0) await audit({ action: 'statement_gap.unanswered', entityType: 'account', entityId: account_id, detail: { cycle_end } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
