/**
 * Confirm which account a statement belongs to.
 * Split out of routes/imports.js (D213); mounted under /api/imports.
 */

import { Router } from 'express';

import { query, withTransaction } from '../../db.js';
import { audit } from '../../audit.js';
import { validate, accountConfirmSchema } from '../../validate.js';
import { randomCardColor } from '../../card-palette.js';
import { isKnownBank } from '../../known-banks.js';
import { upsertStatement, relocateStatementFile } from './shared.js';

const router = Router();
export { router as accountRouter };

/* ------------------------------------------------------------------
   Account confirmation — the human step between "the parser thinks
   this is account X" and it being so.
   ------------------------------------------------------------------ */

router.post('/:id/account', validate(accountConfirmSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { account_id, create } = req.body;

    const { rows: batches } = await query('SELECT * FROM import_batch WHERE id = $1', [id]);
    if (batches.length === 0) return res.status(404).json({ error: 'Import not found' });
    const batch = batches[0];

    if (batch.status !== 'NEEDS_ACCOUNT' && batch.status !== 'REVIEW') {
      return res.status(409).json({ error: `This import is ${batch.status.toLowerCase()} — the account can't be changed here` });
    }

    let accountId = account_id ?? null;
    let accountName, accountMask;

    if (create) {
      const { rows: people } = await query('SELECT id FROM person WHERE id = $1', [create.person_id]);
      if (people.length === 0) {
        return res.status(400).json({ error: 'That person does not exist', field: 'person_id' });
      }
      const detectedIssuer = create.issuer === '' || create.issuer === undefined ? null : create.issuer;
      // Same rule as the Settings create path (routes/accounts.js): a
      // checking/savings account at a bank we recognize gets its color
      // from the real brand (frontend, see bankBrands.js) rather than
      // the random palette, so `color` is left NULL here instead.
      const skipRandomColor = create.account_type !== 'CREDIT_CARD' && isKnownBank(detectedIssuer);

      const { rows } = await query(
        `INSERT INTO account (person_id, name, issuer, account_type, mask, holder_name, color)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, name, mask`,
        [
          create.person_id,
          create.name,
          detectedIssuer,
          create.account_type,
          create.mask === '' || create.mask === undefined ? null : create.mask,
          // The name as printed on the statement — extracted data, not
          // something the human types in the create form.
          batch.detected_holder ?? null,
          skipRandomColor ? null : randomCardColor(),
        ]
      );
      accountId = rows[0].id;
      accountName = rows[0].name;
      accountMask = rows[0].mask;
      await audit({
        action: 'account.created',
        entityType: 'account',
        entityId: accountId,
        detail: { name: rows[0].name, source: 'statement_detection', import_batch_id: id },
      });
    } else {
      const { rows } = await query('SELECT id, name, mask FROM account WHERE id = $1', [accountId]);
      if (rows.length === 0) {
        return res.status(400).json({ error: 'That account does not exist', field: 'account_id' });
      }
      accountName = rows[0].name;
      accountMask = rows[0].mask;
    }

    await withTransaction(async (client) => {
      await client.query(
        `UPDATE import_batch SET account_id = $2, status = 'REVIEW' WHERE id = $1`,
        [id, accountId]
      );
      const summary = batch.detected_summary;
      if (summary?.period_start && summary?.period_end) {
        await upsertStatement(client, accountId, id, summary);
      }
    });

    // Best-effort: the batch is already confirmed at this point, so a
    // filesystem hiccup here shouldn't fail the request — it would just
    // leave this one file flat (or un-renamed) until the next successful
    // move. period_end is already on `batch` — parsing (which is what
    // got this batch to NEEDS_ACCOUNT/REVIEW in the first place) set it.
    await relocateStatementFile(batch, accountId, accountName, accountMask, batch.period_end).catch(() => {});

    await audit({
      action: 'import.account_confirmed',
      entityType: 'import_batch',
      entityId: id,
      detail: { account_id: accountId, created: Boolean(create) },
    });

    res.json({ id, status: 'REVIEW', account_id: accountId });
  } catch (err) {
    next(err);
  }
});

