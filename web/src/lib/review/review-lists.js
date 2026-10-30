/**
 * Review's Statements, Silent months and Payments tabs as account lists
 * (D319): one row per account on the left, everything about it on the
 * right. These group what the tabs already have (statement gaps, statements
 * that don't add up, silent months, payments to trace) by account and say
 * each in a line. Pure; tested in review-lists.test.js.
 */
import { formatMoney } from '../../api.js';
import { missingStatements } from './upload-view.js';
import { statementMonth, cycleRange } from './statement-gaps-view.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * Statements: every account with something to do, worst first. A row holds
 * its missing statements (each with its clue), the statements that don't
 * add up (biggest first; under $10 marked small), and anything saved wrong.
 * `statements` rows name their account, so `accountIdByName` ties them back.
 */
export function statementAccounts({ view, statements = [], accountIdByName = () => null }) {
  const rows = new Map();
  const row = (key, init) => {
    if (!rows.has(key)) rows.set(key, { id: key, missing: [], off: [], problems: [], ...init });
    return rows.get(key);
  };
  for (const c of missingStatements(view?.upload ?? [])) {
    row(`a${c.account_id}`, { account_id: c.account_id, name: c.name, mask: c.mask }).missing = c.statements;
  }
  for (const s of statements) {
    const id = accountIdByName(s.account_name);
    const r = row(id ? `a${id}` : `n${s.account_name}`, { account_id: id, name: s.account_name, mask: null });
    r.off.push({ ...s, small: s.hint?.kind === 'small', cents: Math.abs(s.tally?.diff_cents ?? 0) });
  }
  for (const p of view?.problems ?? []) {
    row(`a${p.account_id}`, { account_id: p.account_id, name: p.name, mask: p.mask }).problems.push(p.problem);
  }
  return [...rows.values()]
    .map((r) => {
      const off = r.off.sort((a, b) => b.cents - a.cents);
      const big = off.filter((s) => !s.small);
      const parts = [
        r.missing.length && plural(r.missing.length, 'missing', 'missing'),
        big.length && `${formatMoney(big.reduce((n, s) => n + s.cents, 0))} off`,
        off.length > big.length && plural(off.length - big.length, 'small gap', 'small gaps'),
        r.problems.length && plural(r.problems.length, 'saved wrong', 'saved wrong'),
      ].filter(Boolean);
      const worst = r.missing.length ? 'missing' : big.length ? 'off' : r.problems.length ? 'problem' : 'small';
      return { ...r, off, worst, count: r.missing.length + big.length + r.problems.length, summary: parts.join(' · ') };
    })
    .sort((a, b) => ['missing', 'off', 'problem', 'small'].indexOf(a.worst) - ['missing', 'off', 'problem', 'small'].indexOf(b.worst) || b.count - a.count || a.name.localeCompare(b.name));
}

/**
 * Silent months: every card with a month to answer or a silent month, the
 * ones waiting on an answer first. A month to answer keeps its cycle (for
 * the answer) and its first clue; a silent month says whether it was you.
 */
export function silentAccounts(silent) {
  const rows = new Map();
  const row = (c) => {
    if (!rows.has(c.account_id)) rows.set(c.account_id, { id: `a${c.account_id}`, account_id: c.account_id, name: c.name, mask: c.mask, ask: [], quiet: [] });
    return rows.get(c.account_id);
  };
  for (const a of silent?.ask ?? []) row(a).ask.push({ ...a, month: statementMonth(a.cycle), dates: cycleRange(a.cycle) });
  for (const c of silent?.silent ?? []) {
    const r = row(c);
    for (const cy of c.months) r.quiet.push({ cycle: cy, month: statementMonth(cy), dates: cycleRange(cy), answered: Boolean(cy.answered), card: c });
  }
  return [...rows.values()]
    .map((r) => ({
      ...r,
      ask: r.ask.sort((a, b) => b.cycle.end.localeCompare(a.cycle.end)),
      quiet: r.quiet.sort((a, b) => b.cycle.end.localeCompare(a.cycle.end)),
      summary: [r.ask.length && plural(r.ask.length, 'to answer', 'to answer'), r.quiet.length && plural(r.quiet.length, 'silent month', 'silent months')].filter(Boolean).join(' · '),
    }))
    .sort((a, b) => b.ask.length - a.ask.length || a.name.localeCompare(b.name));
}
