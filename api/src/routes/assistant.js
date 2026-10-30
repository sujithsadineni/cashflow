/**
 * Questions asked of the assistant (D332). Every question is kept with the
 * time it was asked. Answer here (/ask, step 3) reads and answers it on
 * this computer and keeps what it found. One saved for Claude Code waits here until a session
 * answers it (cashflow-answer-questions skill) and writes the answer back;
 * the panel shows it, and marks it seen when opened. Never deleted: a
 * question no longer wanted is dismissed. Every write is audited.
 */

import { Router } from 'express';
import { query } from '../core/db.js';
import { audit } from '../core/audit.js';
import { validate, assistantAskSchema, assistantAnswerSchema, assistantLocalAskSchema } from '../core/validate.js';
import { parseQuestion } from '../assistant/parse.js';
import { vocabFrom } from '../assistant/vocab.js';
import { answerQuestion, answerSummary, loadVocabLists } from '../assistant/answer.js';
import { loadSuggestions } from '../assistant/suggestions.js';
import { askClaude } from '../assistant/claude.js';

export const assistantRouter = Router();

const LIST_COLUMNS = 'id, question, asked_via, status, answer, answered_by, asked_at, answered_at, seen_at, answer_detail IS NOT NULL AS has_detail';
// One question in full: with what a local answer found (answer_detail), which the list leaves out.
const COLUMNS = 'id, question, asked_via, status, answer, answer_detail, answered_by, asked_at, answered_at, seen_at';
const byId = async (id) => (await query(`SELECT ${COLUMNS}, dismissed_at FROM assistant_question WHERE id = $1`, [id])).rows[0];
const STATUSES = ['waiting', 'answered', 'not_understood'];

// Today on this computer, not in UTC: "this month" must not turn into next month at 8pm.
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** The questions not dismissed, newest first; ?status=waiting for the ones still to answer. */
assistantRouter.get('/questions', async (req, res, next) => {
  try {
    const status = req.query.status;
    if (status !== undefined && !STATUSES.includes(status)) return res.status(400).json({ error: `Use status=${STATUSES.join(', ')}`, field: 'status' });
    const { rows } = await query(
      `SELECT ${LIST_COLUMNS} FROM assistant_question
        WHERE status <> 'dismissed' AND ($1::text IS NULL OR status = $1)
        ORDER BY asked_at DESC, id DESC LIMIT 200`,
      [status ?? null]
    );
    const unseen = rows.filter((r) => r.status === 'answered' && !r.seen_at).length;
    res.json({ questions: rows, unseen });
  } catch (err) {
    next(err);
  }
});

/** Questions to suggest as the person types, from what this household spends on most this year. */
assistantRouter.get('/suggestions', async (req, res, next) => {
  try {
    res.json(await loadSuggestions(query, Number(localToday().slice(0, 4))));
  } catch (err) {
    next(err);
  }
});

assistantRouter.get('/questions/:id', async (req, res, next) => {
  try {
    const q = await byId(Number(req.params.id));
    if (!q || q.dismissed_at) return res.status(404).json({ error: 'Question not found' });
    const { dismissed_at, ...rest } = q;
    res.json(rest);
  } catch (err) {
    next(err);
  }
});

assistantRouter.post('/questions', validate(assistantAskSchema), async (req, res, next) => {
  try {
    const { rows } = await query(
      `INSERT INTO assistant_question (question, asked_via) VALUES ($1, $2) RETURNING ${COLUMNS}`,
      [req.body.question, req.body.via]
    );
    await audit({ action: 'assistant.asked', entityType: 'assistant_question', entityId: rows[0].id, detail: { question: rows[0].question, via: rows[0].asked_via } });
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

/**
 * Answer here (step 3): read the question, look it up, keep it with what was
 * found. Free and on this computer: no outside call. A question it can't
 * read is kept as not_understood with what it said (and any choices).
 */
assistantRouter.post('/ask', validate(assistantLocalAskSchema), async (req, res, next) => {
  try {
    const question = req.body.question;
    const plan = parseQuestion(question, vocabFrom(await loadVocabLists(query)), localToday());
    const result = plan.understood ? await answerQuestion(query, plan) : { understood: false, reason: plan.reason, message: plan.message, choices: plan.choices ?? [] };
    const { rows } = await query(
      `INSERT INTO assistant_question (question, asked_via, status, answer, answer_detail, answered_by, answered_at, seen_at)
       VALUES ($1, 'local', $2, $3, $4, 'local', now(), now()) RETURNING ${COLUMNS}`,
      [question, plan.understood ? 'answered' : 'not_understood', plan.understood ? answerSummary(plan) : plan.message, result]
    );
    await audit({
      action: 'assistant.asked',
      entityType: 'assistant_question',
      entityId: rows[0].id,
      detail: { question, via: 'local', understood: plan.understood, ...(plan.understood && { summary: rows[0].answer }) },
    });
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

/**
 * Ask Claude (step 4): only when the person presses Ask Claude for this
 * question (D182: opt-in, one at a time). Claude answers with read-only
 * tools over the same queries; the answer, what it looked up and the
 * estimated cost are kept. A failure is audited too, and nothing is saved.
 */
assistantRouter.post('/ask-claude', validate(assistantLocalAskSchema), async (req, res, next) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({ error: 'Ask Claude needs an Anthropic API key in api/.env (ANTHROPIC_API_KEY).' });
    }
    const question = req.body.question;
    const out = await askClaude({ question, query, lists: await loadVocabLists(query), today: localToday() });
    if (!out.ok) {
      await audit({ action: 'assistant.claude_failed', entityType: 'assistant_question', detail: { question, error: out.error } });
      return res.status(502).json({ error: out.error });
    }
    const detail = { via: 'claude', text: out.text, lookups: out.lookups, usage: out.usage, cost_microdollars: out.cost_microdollars, model: out.model, rounds: out.rounds };
    const { rows } = await query(
      `INSERT INTO assistant_question (question, asked_via, status, answer, answer_detail, answered_by, answered_at, seen_at)
       VALUES ($1, 'claude', 'answered', $2, $3, 'claude', now(), now()) RETURNING ${COLUMNS}`,
      [question, out.text.slice(0, 20000), detail]
    );
    await audit({
      action: 'assistant.asked',
      entityType: 'assistant_question',
      entityId: rows[0].id,
      detail: { question, via: 'claude', model: out.model, tools: out.lookups.map((l) => l.tool), cost_microdollars: out.cost_microdollars },
    });
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

/** Claude Code writes its answer back, once: a second answer to the same question is 409. */
assistantRouter.post('/questions/:id/answer', validate(assistantAnswerSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await query(
      `UPDATE assistant_question SET status = 'answered', answer = $2, answered_by = 'claude_code', answered_at = now()
        WHERE id = $1 AND status = 'waiting' RETURNING ${COLUMNS}`,
      [id, req.body.answer]
    );
    if (rows.length === 0) {
      const q = await byId(id);
      return res.status(q ? 409 : 404).json({ error: q ? `That question is already ${q.status}` : 'Question not found' });
    }
    await audit({ action: 'assistant.answered', entityType: 'assistant_question', entityId: id, detail: { by: 'claude_code', length: rows[0].answer.length } });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

/** The person opened the answer: recorded (and audited) the first time only; later opens change nothing. */
assistantRouter.post('/questions/:id/seen', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await query(
      `UPDATE assistant_question SET seen_at = now() WHERE id = $1 AND status = 'answered' AND seen_at IS NULL RETURNING ${COLUMNS}`,
      [id]
    );
    if (rows.length > 0) {
      await audit({ action: 'assistant.seen', entityType: 'assistant_question', entityId: id });
      return res.json(rows[0]);
    }
    const q = await byId(id);
    if (!q || q.status !== 'answered') return res.status(404).json({ error: 'No answered question with that id' });
    res.json(q);
  } catch (err) {
    next(err);
  }
});

assistantRouter.post('/questions/:id/dismiss', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await query(
      `UPDATE assistant_question SET status = 'dismissed', dismissed_at = now() WHERE id = $1 AND status <> 'dismissed' RETURNING id, question`,
      [id]
    );
    if (rows.length === 0) {
      const q = await byId(id);
      return res.status(q ? 409 : 404).json({ error: q ? 'That question was already dismissed' : 'Question not found' });
    }
    await audit({ action: 'assistant.dismissed', entityType: 'assistant_question', entityId: id, detail: { question: rows[0].question } });
    res.json({ id, dismissed: true });
  } catch (err) {
    next(err);
  }
});
