/**
 * Suggested questions (D332 step 3), built from the household's own
 * spending: the categories and merchants with the most spent this year,
 * in the shapes "Answer here" reads. Every one is a question parse.js
 * understands, so picking one always answers.
 */

import { spendSql } from '../money/spend.js';

/** Pure: the top category and merchant names in, the list out. */
export function buildSuggestions({ categories = [], merchants = [] }) {
  const out = [];
  const add = (text, note) => out.some((s) => s.text === text) || out.push({ text, note });
  const [c1, c2, c3, c4] = categories;
  add('How much did I spend this month?', 'All spending · this month');
  add('Spending this month vs last month', 'All spending · compare');
  if (c1) add(`How much did I spend on ${c1} this year?`, `${c1} · year to date`);
  if (c1) add(`${c1} by month this year`, `${c1} · by month`);
  if (c2) add(`${c2} this month vs last month`, `${c2} · compare`);
  if (c2) add(`${c2} by month this year`, `${c2} · by month`);
  if (c3) add(`${c3} this year`, `${c3} · year to date`);
  if (c3) add(`${c3} this month vs same month last year`, `${c3} · compare`);
  if (c4) add(`${c4} last 3 months`, `${c4} · 3 months`);
  for (const m of merchants.slice(0, 4)) {
    add(`${m} this year`, `${m} · year to date`);
    add(`${m} by month this year`, `${m} · by month`);
  }
  add('Top 10 merchants last month', 'Merchants · top');
  add('Top categories this year', 'Categories · top');
  add('Biggest purchases this year', 'Purchases · top');
  add('Spending in the last 30 days', 'All spending · 30 days');
  // Then every shape for every name, so typing "rent" offers each way of asking about rent.
  for (const name of [...categories, ...merchants.slice(0, 4)]) {
    add(`${name} this year`, `${name} · year to date`);
    add(`${name} by month this year`, `${name} · by month`);
    add(`${name} this month vs last month`, `${name} · compare`);
    add(`${name} last month`, `${name} · last month`);
  }
  return out;
}

/** The names, by spend this year (the app's spending rule), most first. */
export async function loadSuggestions(query, year) {
  const spend = spendSql('t');
  const [cats, merchants] = await Promise.all([
    query(
      `SELECT c.name FROM transaction t JOIN category c ON c.id = t.category_id
        WHERE ${spend} AND t.posted_date >= make_date($1, 1, 1) AND c.name <> 'Uncategorized'
        GROUP BY c.name HAVING -SUM(t.amount_cents) > 0 ORDER BY -SUM(t.amount_cents) DESC LIMIT 10`,
      [year]
    ),
    query(
      `SELECT t.merchant AS name FROM transaction t
        WHERE ${spend} AND t.merchant IS NOT NULL AND t.posted_date >= make_date($1, 1, 1)
        GROUP BY t.merchant HAVING COUNT(*) >= 3 AND -SUM(t.amount_cents) > 0 ORDER BY -SUM(t.amount_cents) DESC LIMIT 4`,
      [year]
    ),
  ]);
  return buildSuggestions({ categories: cats.rows.map((r) => r.name), merchants: merchants.rows.map((r) => r.name) });
}
