/**
 * A person, as the household's statements describe them (D302): the People
 * page's one read. Everything here comes from data the app already holds —
 * the names their statements print, the addresses those statements are
 * mailed to (migration 042), their accounts and how far each one's
 * statements go back, and the year's money on those accounts by the same
 * rules the Overview uses (spend.js, the Salary category). Nothing is
 * written, so nothing is audited.
 */

import { Router } from 'express';
import { query } from '../core/db.js';
import { spendSql, spenderSql } from '../money/spend.js';
import { placeKey } from '../statements/mailing-address.js';

export const peopleProfileRouter = Router();

/** Printed names compared the same way: case and spacing aside. */
const nameKey = (name) => name.toUpperCase().replace(/\s+/g, ' ').trim();

peopleProfileRouter.get('/:id/profile', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid person' });
    const { rows: [person] } = await query('SELECT id, name, nickname, avatar FROM person WHERE id = $1', [id]);
    if (!person) return res.status(404).json({ error: 'Person not found' });
    const year = String(req.query.year ?? new Date().getFullYear());
    if (!/^\d{4}$/.test(year)) return res.status(400).json({ error: 'Use year=YYYY', field: 'year' });

    const [accounts, printed, money, categories, loans, recurring, mailed] = await Promise.all([
      query(
        `SELECT a.id, a.name, a.issuer, a.mask, a.account_type, a.is_active, a.image_path, a.color,
                count(s.id)::int AS statements,
                to_char(min(s.period_start), 'YYYY-MM-DD') AS first_statement,
                to_char(max(s.period_end), 'YYYY-MM-DD') AS last_statement
           FROM account a LEFT JOIN statement s ON s.account_id = a.id
          WHERE a.person_id = $1
          GROUP BY a.id ORDER BY a.is_active DESC, (a.account_type = 'CREDIT_CARD'), a.name`, [id]),
      query(
        `SELECT a.id AS account_id, n.name
           FROM account a
           JOIN LATERAL (SELECT a.holder_name AS name UNION SELECT b.detected_holder FROM import_batch b WHERE b.account_id = a.id) n ON n.name IS NOT NULL
          WHERE a.person_id = $1`, [id]),
      query(
        `SELECT COALESCE(LEAST(SUM(t.amount_cents) FILTER (WHERE ${spendSql('t')}), 0), 0)::bigint AS spent_cents,
                COALESCE(SUM(t.amount_cents) FILTER (WHERE c.name = 'Salary'), 0)::bigint AS salary_cents,
                COALESCE(SUM(t.amount_cents) FILTER (WHERE t.txn_type = 'deposit'), 0)::bigint AS deposits_cents,
                count(t.id)::int AS transactions
           FROM transaction t JOIN account a ON a.id = t.account_id LEFT JOIN category c ON c.id = t.category_id
          WHERE ${spenderSql('t', 'a')} = $1 AND to_char(t.posted_date, 'YYYY') = $2`, [id, year]),
      query(
        `SELECT c.name AS category, LEAST(SUM(t.amount_cents), 0)::bigint AS spent_cents
           FROM transaction t JOIN account a ON a.id = t.account_id LEFT JOIN category c ON c.id = t.category_id
          WHERE ${spenderSql('t', 'a')} = $1 AND to_char(t.posted_date, 'YYYY') = $2 AND ${spendSql('t')}
          GROUP BY c.name HAVING SUM(t.amount_cents) < 0 ORDER BY 2 ASC LIMIT 5`, [id, year]),
      query(
        `SELECT DISTINCT l.id, l.name, l.lender, l.loan_type
           FROM loan l JOIN account a ON a.id IN (l.payment_account_id, l.linked_account_id)
          WHERE a.person_id = $1 AND l.is_active ORDER BY l.name`, [id]),
      query(`SELECT count(*)::int AS n FROM recurring_series WHERE person_id = $1 AND status = 'ACTIVE'`, [id]),
      query(
        `SELECT s.account_id, s.mailing_address AS line, to_char(s.period_end, 'YYYY-MM-DD') AS period_end
           FROM statement s JOIN account a ON a.id = s.account_id
          WHERE a.person_id = $1 AND s.mailing_address IS NOT NULL ORDER BY s.period_end`, [id]),
    ]);

    const card = (a) => ({ id: a.id, name: a.name, issuer: a.issuer, mask: a.mask });

    // Each spelling once, with the accounts whose statements print it.
    const names = new Map();
    for (const { account_id: accountId, name } of printed.rows) {
      const key = nameKey(name);
      if (!names.has(key)) names.set(key, { name: name.trim().replace(/\s+/g, ' '), accounts: new Set() });
      names.get(key).accounts.add(accountId);
    }
    const byId = new Map(accounts.rows.map((a) => [a.id, a]));

    // Each place once (D303), however statements spell it: when it was first
    // and last printed, by which accounts, and in the spelling printed most.
    // The current address is the one on the newest statement; the rest are
    // previous, newest first. An old statement uploaded later can only add
    // history, never move the current address.
    const places = new Map();
    for (const m of mailed.rows) {
      const key = placeKey(m.line) ?? m.line;
      if (!places.has(key)) places.set(key, { spellings: new Map(), first: m.period_end, last: m.period_end, accounts: new Map(), statements: 0 });
      const p = places.get(key);
      p.spellings.set(m.line, (p.spellings.get(m.line) ?? 0) + 1);
      p.last = m.period_end; // rows come oldest first
      p.statements += 1;
      p.accounts.set(m.account_id, m.period_end);
    }
    const timeline = [...places.values()]
      .map((p) => ({
        line: [...p.spellings].sort((a, b) => b[1] - a[1])[0][0],
        first_seen: p.first,
        last_seen: p.last,
        statements: p.statements,
        accounts: [...p.accounts].map(([accountId, asOf]) => byId.get(accountId) && { ...card(byId.get(accountId)), as_of: asOf }).filter(Boolean),
      }))
      .sort((a, b) => b.last_seen.localeCompare(a.last_seen));

    const all = accounts.rows;
    const dated = all.filter((a) => a.first_statement);
    res.json({
      person,
      year,
      printed_names: [...names.values()].map((n) => ({ name: n.name, accounts: [...n.accounts].map((x) => byId.get(x)).filter(Boolean).map(card) })),
      address: { current: timeline[0] ?? null, previous: timeline.slice(1) },
      accounts: all,
      statements: {
        count: all.reduce((s, a) => s + a.statements, 0),
        first: dated.map((a) => a.first_statement).sort()[0] ?? null,
        last: dated.map((a) => a.last_statement).sort().at(-1) ?? null,
      },
      money: { ...money.rows[0], spent_cents: Number(money.rows[0].spent_cents), salary_cents: Number(money.rows[0].salary_cents), deposits_cents: Number(money.rows[0].deposits_cents) },
      top_categories: categories.rows.map((c) => ({ category: c.category ?? 'Uncategorized', spent_cents: Number(c.spent_cents) })),
      loans: loans.rows,
      recurring_bills: recurring.rows[0].n,
    });
  } catch (err) {
    next(err);
  }
});
