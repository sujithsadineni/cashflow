/**
 * Who's on a shared card (D344): its members, the names its statements
 * print that no member accounts for (proposed, never added: D100), and
 * adding or changing a member, which re-files that card's rows in the same
 * transaction. Every change records the rows it moved, so Undo puts back
 * exactly those. Mounted under /api/accounts.
 */
import { Router } from 'express';
import { query, withTransaction } from '../core/db.js';
import { audit } from '../core/audit.js';
import { validate, accountMemberCreateSchema, accountMemberUpdateSchema } from '../core/validate.js';
import { fileSpenders, proposedMembers } from '../statements/spender-run.js';

export const accountMembersRouter = Router();

const MEMBER_COLUMNS = `m.id, m.account_id, m.person_id, p.name AS person_name, m.role, m.printed_name, m.card_ending,
  m.since::text AS since, m.is_active`;
const EDITABLE = ['person_id', 'role', 'printed_name', 'card_ending', 'since', 'is_active'];

async function accountExists(id) {
  const { rows } = await query('SELECT 1 FROM account WHERE id = $1', [id]);
  return rows.length > 0;
}

accountMembersRouter.get('/:id/members', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!(await accountExists(id))) return res.status(404).json({ error: 'Account not found' });
    const { rows: members } = await query(
      `SELECT ${MEMBER_COLUMNS},
              (SELECT count(*)::int FROM transaction t WHERE t.account_id = m.account_id AND t.spender_person_id = m.person_id) AS rows
         FROM account_member m JOIN person p ON p.id = m.person_id
        WHERE m.account_id = $1 ORDER BY m.is_active DESC, m.id`,
      [id]
    );
    res.json({ members, proposed: await proposedMembers({ query }, id) });
  } catch (err) {
    next(err);
  }
});

accountMembersRouter.post('/:id/members', validate(accountMemberCreateSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!(await accountExists(id))) return res.status(404).json({ error: 'Account not found' });
    const { person_id, role, printed_name = null, card_ending = null, since = null } = req.body;
    const { rows: person } = await query('SELECT 1 FROM person WHERE id = $1', [person_id]);
    if (person.length === 0) return res.status(400).json({ error: 'No such person', field: 'person_id' });
    const { rows: taken } = await query('SELECT 1 FROM account_member WHERE account_id = $1 AND person_id = $2', [id, person_id]);
    if (taken.length > 0) return res.status(409).json({ error: 'That person is already on this card', field: 'person_id' });

    const result = await withTransaction(async (client) => {
      const { rows: [member] } = await client.query(
        `INSERT INTO account_member (account_id, person_id, role, printed_name, card_ending, since)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [id, person_id, role, printed_name || null, card_ending || null, since]
      );
      const moved = await fileSpenders(client, id);
      const auditId = await audit({
        client, action: 'account.member_added', entityType: 'account', entityId: id,
        detail: { member_id: member.id, person_id, role, card_ending, before: null, moved },
      });
      return { member_id: member.id, moved: moved.length, audit_id: auditId };
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

accountMembersRouter.patch('/:id/members/:memberId', validate(accountMemberUpdateSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const memberId = Number(req.params.memberId);
    const { rows: [before] } = await query('SELECT * FROM account_member WHERE id = $1 AND account_id = $2', [memberId, id]);
    if (!before) return res.status(404).json({ error: 'Member not found' });
    if (req.body.person_id !== undefined) {
      const { rows: person } = await query('SELECT 1 FROM person WHERE id = $1', [req.body.person_id]);
      if (person.length === 0) return res.status(400).json({ error: 'No such person', field: 'person_id' });
    }

    // Column names only from the allow-list; values parameterised.
    const fields = EDITABLE.filter((f) => req.body[f] !== undefined);
    const values = fields.map((f) => (req.body[f] === '' ? null : req.body[f]));
    const result = await withTransaction(async (client) => {
      await client.query(
        `UPDATE account_member SET ${fields.map((f, i) => `${f} = $${i + 2}`).join(', ')} WHERE id = $1`,
        [memberId, ...values]
      );
      const moved = await fileSpenders(client, id);
      const snapshot = Object.fromEntries(EDITABLE.map((f) => [f, before[f] instanceof Date ? before[f].toISOString().slice(0, 10) : before[f]]));
      const auditId = await audit({
        client, action: 'account.member_changed', entityType: 'account', entityId: id,
        detail: { member_id: memberId, fields, before: snapshot, moved },
      });
      return { member_id: memberId, moved: moved.length, audit_id: auditId };
    });
    res.json(result);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'That person is already on this card', field: 'person_id' });
    next(err);
  }
});

/**
 * Undo an add or a change: the member goes back as it was (an added one is
 * set inactive, not deleted), and each moved row gets its spender back if it
 * still has the one the change gave it. Once only.
 */
accountMembersRouter.post('/:id/members/undo/:auditId', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const auditId = Number(req.params.auditId);
    const { rows: [entry] } = await query(
      `SELECT action, detail FROM audit_log WHERE id = $1 AND entity_id = $2 AND action IN ('account.member_added', 'account.member_changed')`,
      [auditId, id]
    );
    if (!entry) return res.status(404).json({ error: 'No member change to undo' });
    const { rows: done } = await query(`SELECT 1 FROM audit_log WHERE action = 'account.member_undone' AND (detail->>'audit_id')::int = $1`, [auditId]);
    if (done.length > 0) return res.status(409).json({ error: 'Already undone' });

    const { member_id, before, moved } = entry.detail;
    const result = await withTransaction(async (client) => {
      if (before === null) {
        await client.query('UPDATE account_member SET is_active = false WHERE id = $1', [member_id]);
      } else {
        await client.query(
          `UPDATE account_member SET ${EDITABLE.map((f, i) => `${f} = $${i + 2}`).join(', ')} WHERE id = $1`,
          [member_id, ...EDITABLE.map((f) => before[f])]
        );
      }
      let restored = 0;
      for (const { id: txnId, from, to } of moved) {
        restored += (await client.query(
          `UPDATE transaction SET spender_person_id = $2, updated_at = now() WHERE id = $1 AND spender_person_id IS NOT DISTINCT FROM $3`,
          [txnId, from, to]
        )).rowCount;
      }
      await audit({ client, action: 'account.member_undone', entityType: 'account', entityId: id, detail: { audit_id: auditId, member_id, restored } });
      return { restored };
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});
