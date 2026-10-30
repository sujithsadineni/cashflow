/**
 * Confirm which account a statement belongs to.
 * Split out of routes/imports.js (D213); mounted under /api/imports.
 */

import { Router } from 'express';

import { query, withTransaction } from '../../core/db.js';
import { audit } from '../../core/audit.js';
import { validate, accountConfirmSchema } from '../../core/validate.js';
import { randomCardColor } from '../../money/card-palette.js';
import { isKnownBank } from '../../merchants/known-banks.js';
import { cardProductFor } from '../../../../web/src/lib/cards/card-products.js';
import { upsertStatement, relocateStatementFile, REPO_ROOT } from './shared.js';
import { parseStatementCsv, BANK_TYPES } from '../../parse/csv.js';
import { inflowType } from '../../review/inflow-type.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

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

    const newPeople = []; // people a shared statement added (D400): Import sends them to People to check
    if (create) {
      const members = create.members ?? [];
      const chosen = members.map((m) => m.person_id).filter(Boolean);
      if (new Set(chosen).size !== chosen.length) {
        return res.status(400).json({ error: 'Each name on the statement needs a different person', field: 'members' });
      }
      const known = [create.person_id, ...chosen].filter(Boolean);
      const { rows: found } = await query('SELECT id FROM person WHERE id = ANY($1)', [known]);
      if (found.length !== new Set(known).size) {
        return res.status(400).json({ error: 'That person does not exist', field: 'person_id' });
      }
      const detectedIssuer = create.issuer === '' || create.issuer === undefined ? null : create.issuer;
      // Same rule as the Settings create path (routes/accounts.js): a
      // checking/savings account at a bank we recognize gets its color
      // from the real brand (frontend, see bankBrands.js) rather than
      // the random palette, so `color` is left NULL here instead.
      const skipRandomColor = (create.account_type !== 'CREDIT_CARD' && isKnownBank(detectedIssuer))
        // A known card product draws its own face (D403): no random colour to hide it.
        || Boolean(cardProductFor({ account_type: create.account_type, issuer: detectedIssuer, name: create.name }));

      // One transaction: the people a shared statement brings, the account, who's on it and its limit.
      const created = await withTransaction(async (client) => {
        const resolved = [];
        for (const m of members) {
          let personId = m.person_id;
          if (!personId) {
            const name = m.new_person.replace(/\s+/g, ' ');
            const { rows: [same] } = await client.query('SELECT id FROM person WHERE lower(trim(name)) = lower($1)', [name]);
            personId = same?.id;
            if (!personId) {
              personId = (await client.query('INSERT INTO person (name) VALUES ($1) RETURNING id', [name])).rows[0].id;
              newPeople.push(personId);
              await audit({ client, action: 'person.created', entityType: 'person', entityId: personId, detail: { name, source: 'statement', import_batch_id: id } });
            }
          }
          resolved.push({ ...m, person_id: personId });
        }
        if (new Set(resolved.map((m) => m.person_id)).size !== resolved.length) {
          throw Object.assign(new Error('Each name on the statement needs a different person'), { status: 400 });
        }
        const ownerId = resolved.find((m) => m.role === 'owner')?.person_id ?? create.person_id;
        const limit = create.account_type === 'CREDIT_CARD' ? create.credit_limit_cents ?? null : null;

        const { rows } = await client.query(
          `INSERT INTO account (person_id, name, issuer, account_type, mask, holder_name, color, credit_limit_manual_cents)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id, name, mask`,
          [
            ownerId,
            create.name,
            detectedIssuer,
            create.account_type,
            create.mask === '' || create.mask === undefined ? null : create.mask,
            // The name as printed on the statement — extracted data, not
            // something the human types in the create form.
            batch.detected_holder ?? null,
            skipRandomColor ? null : randomCardColor(),
            limit,
          ]
        );
        const account = rows[0];
        await audit({
          client,
          action: 'account.created',
          entityType: 'account',
          entityId: account.id,
          detail: { name: account.name, source: 'statement_detection', import_batch_id: id, ...(limit && { credit_limit_manual_cents: limit }), ...(resolved.length && { shared: true }) },
        });
        for (const m of resolved) {
          const { rows: [member] } = await client.query(
            `INSERT INTO account_member (account_id, person_id, role, printed_name, card_ending)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [account.id, m.person_id, m.role, m.printed_name, m.card_ending ?? null]
          );
          await audit({
            client, action: 'account.member_added', entityType: 'account', entityId: account.id,
            detail: { member_id: member.id, person_id: m.person_id, role: m.role, card_ending: m.card_ending ?? null, before: null, source: 'statement', import_batch_id: id },
          });
        }
        return account;
      }).catch((err) => {
        if (err.status === 400) return err;
        throw err;
      });
      if (created instanceof Error) return res.status(400).json({ error: created.message, field: 'members' });
      accountId = created.id;
      accountName = created.name;
      accountMask = created.mask;
    } else {
      const { rows } = await query('SELECT id, name, mask, issuer, account_type FROM account WHERE id = $1', [accountId]);
      if (rows.length === 0) {
        return res.status(400).json({ error: 'That account does not exist', field: 'account_id' });
      }
      const mismatch = statementMismatch(batch, rows[0]);
      if (mismatch && !req.body.force) {
        return res.status(409).json({ error: mismatch, field: 'account_mismatch' });
      }
      accountName = rows[0].name;
      accountMask = rows[0].mask;
    }

    // A CSV read before its account was known (a new install's first upload)
    // guessed its signs from its words; the account now says (see csv.js).
    const csvRows = batch.file_type === 'CSV' && batch.status === 'NEEDS_ACCOUNT'
      ? await csvRowsFor(batch, accountId)
      : [];

    await withTransaction(async (client) => {
      await client.query(
        `UPDATE import_batch SET account_id = $2, status = 'REVIEW' WHERE id = $1`,
        [id, accountId]
      );
      for (const row of csvRows) {
        await client.query(
          'UPDATE staged_transaction SET amount_cents = $2, txn_type = $3 WHERE id = $1',
          [row.id, row.amount_cents, row.txn_type]
        );
      }
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
      detail: { account_id: accountId, created: Boolean(create), ...(csvRows.length && { csv_rows_resigned: csvRows.length }) },
    });

    res.json({ id, status: 'REVIEW', account_id: accountId, new_people: newPeople });
  } catch (err) {
    next(err);
  }
});

/**
 * A CSV's staged rows, signed and typed for the account it now belongs to:
 * a bank account's file is never flipped, and money in is a deposit there,
 * a refund or reward on a card. Only rows that change are returned. Types a
 * rule set (Zelle, Bilt, transfers) are kept unless the row's sign changed.
 */
async function csvRowsFor(batch, accountId) {
  const { rows: owner } = await query('SELECT account_type FROM account WHERE id = $1', [accountId]);
  const bank = BANK_TYPES.has(owner[0]?.account_type);
  let flippedAtRead = false;
  try {
    flippedAtRead = parseStatementCsv((await readFile(path.resolve(REPO_ROOT, batch.stored_path))).toString('utf8')).flipped;
  } catch { /* the file moved or is unreadable: leave the signs as read */ }
  const unflip = bank && flippedAtRead;
  const { rows } = await query(
    'SELECT id, amount_cents, txn_type, description FROM staged_transaction WHERE import_batch_id = $1',
    [batch.id]
  );
  const changed = [];
  for (const r of rows) {
    const amount = unflip ? -r.amount_cents : r.amount_cents;
    const guessed = !r.txn_type || ['purchase', 'refund', 'cashback', 'deposit'].includes(r.txn_type);
    let type = r.txn_type;
    if (amount && (guessed && (unflip || !r.txn_type))) {
      type = amount < 0 ? 'purchase' : bank ? 'deposit' : inflowType(r.description);
    }
    if (amount !== r.amount_cents || type !== r.txn_type) changed.push({ id: r.id, amount_cents: amount, txn_type: type });
  }
  return changed;
}

const kindOf = (type) => (type === 'CREDIT_CARD' ? 'card' : type ? 'bank' : null);
const issuerKey = (s) => (s ?? '').toLowerCase().replace(/\b(bank|usa|n\.?a\.?|inc|corp(oration)?|co|of|the)\b/g, '').replace(/[^a-z]/g, '');

/**
 * Why a statement doesn't look like it belongs on this account, or null: a
 * bank statement on a card (or the other way round), or a statement from one
 * bank on another bank's account. Attaching to the wrong account is the worst
 * failure an importer can have; only an explicit "attach anyway" overrides it.
 */
export function statementMismatch(batch, account) {
  const printed = [batch.detected_issuer, batch.detected_account_type === 'CREDIT_CARD' ? 'card' : batch.detected_account_type ? 'account' : null].filter(Boolean).join(' ');
  const statementKind = kindOf(batch.detected_account_type);
  const accountKind = kindOf(account.account_type);
  if (statementKind && accountKind && statementKind !== accountKind) {
    return `This is a ${printed} statement, and ${account.name} is a ${accountKind === 'card' ? 'credit card' : 'bank account'}.`;
  }
  if (batch.detected_issuer && account.issuer && issuerKey(batch.detected_issuer) !== issuerKey(account.issuer)) {
    return `This statement is from ${batch.detected_issuer}, and ${account.name} is ${account.issuer}'s.`;
  }
  return null;
}
