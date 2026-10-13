/**
 * Review's findings, as a person works through them (D249): one entry per
 * transaction, not per finding, so a row missing both its type and its
 * category is fixed once, in one place. Pure; tested in
 * review-entries.test.js. The component (components/review/GlassReview.jsx)
 * only lays these out.
 */

import { GROUPS, TIERS } from './review-groups.js';
import { txnName } from './txn-name.js';

const TIER_ORDER = Object.fromEntries(TIERS.map((t, i) => [t.key, i]));
const FIELD_ORDER = { amount: 0, txn_type: 1, category: 2 };
const tierOf = (item) => GROUPS[item.check_kind]?.tier ?? 'tidy';

/**
 * Findings → entries, worst tier first, then newest. Each entry is the
 * transaction (from its first finding) with every finding on it, in field
 * order: amount, type, category.
 */
export function entriesFrom(items) {
  const byTxn = new Map();
  for (const item of items) {
    if (!byTxn.has(item.transaction_id)) {
      byTxn.set(item.transaction_id, {
        id: item.transaction_id,
        posted_date: item.posted_date,
        description: item.description,
        merchant: item.merchant,
        amount_cents: item.amount_cents,
        txn_type: item.txn_type,
        zelle_type: item.zelle_type,
        category_name: item.category_name,
        category_icon_key: item.category_icon_key,
        contact_name: item.contact_name,
        contact_nickname: item.contact_nickname,
        account_name: item.account_name,
        account_mask: item.account_mask,
        findings: [],
      });
    }
    byTxn.get(item.transaction_id).findings.push(item);
  }
  const entries = [...byTxn.values()];
  for (const e of entries) {
    e.findings.sort((a, b) => (FIELD_ORDER[a.field] ?? 9) - (FIELD_ORDER[b.field] ?? 9));
    e.tier = e.findings.map(tierOf).sort((a, b) => TIER_ORDER[a] - TIER_ORDER[b])[0];
  }
  return entries.sort(
    (a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || String(b.posted_date).localeCompare(String(a.posted_date)) || a.id - b.id
  );
}

/**
 * What to pick for a finding before anyone touches it: only an answer the
 * evidence stands behind. The type from the money's direction, history, or
 * the same merchant's own rows. Never a "commonly used" guess: a default
 * that's often wrong gets approved by a tired Enter.
 */
export function preselect(finding) {
  if (finding.field === 'amount') return finding.suggested_value ?? null;
  if (finding.suggested_value) return finding.suggested_value;
  const top = finding.options?.[0];
  if (!top) return null;
  if (finding.field === 'txn_type') return top.value;
  return /^Like your other|^What this merchant usually gets/.test(top.why) ? top.value : null;
}

/** The finding number keys act on: the first one nobody has picked for yet, else the last. */
export function activeFinding(findings, touched) {
  return findings.find((f) => f.field !== 'amount' && !touched.has(f.id)) ?? findings.at(-1) ?? null;
}

/**
 * Other entries from the same merchant, with money going the same way and
 * a finding of the same kind: "also apply to these". A $5 credit from
 * Apple isn't filed like a $50 purchase from Apple.
 */
export function siblingsOf(entry, entries) {
  const name = (txnName(entry) ?? entry.description ?? '').toLowerCase();
  if (!name) return [];
  const kinds = new Set(entry.findings.map((f) => f.check_kind));
  const out = Math.sign(entry.amount_cents);
  return entries.filter(
    (e) => e.id !== entry.id && Math.sign(e.amount_cents) === out
      && (txnName(e) ?? e.description ?? '').toLowerCase() === name && e.findings.some((f) => kinds.has(f.check_kind))
  );
}

/**
 * One save, as the batch endpoint wants it: every finding on the entry
 * with its chosen value, plus the same kind of finding on each sibling
 * (only where the value fits it: a sibling's type must be one of its own
 * options, so a refund isn't typed as a purchase because the names match).
 */
export function approvalsFor(entry, choices, siblings = []) {
  const approve = entry.findings.filter((f) => choices[f.id]).map((f) => ({ id: f.id, value: choices[f.id] }));
  for (const s of siblings) {
    for (const f of s.findings) {
      const mine = entry.findings.find((m) => m.check_kind === f.check_kind);
      const value = mine && choices[mine.id];
      if (!value) continue;
      if (f.field === 'txn_type' && f.options && !f.options.some((o) => o.value === value)) continue;
      if (f.field === 'amount') continue; // a sign flip is only ever its own row's
      approve.push({ id: f.id, value });
    }
  }
  return approve;
}

/**
 * A bulk fix (D253): one value for one field across many entries. A type
 * only goes on a row whose own options include it, so selecting a $50
 * purchase and a $5 credit and picking Purchase doesn't type the credit
 * as a purchase. Returns the approvals and how many were left alone.
 */
export function bulkApprovals(entries, field, value) {
  const findings = entries.flatMap((e) => e.findings.filter((f) => f.field === field));
  const fits = (f) => field !== 'txn_type' || !f.options?.length || f.options.some((o) => o.value === value);
  const approve = value ? findings.filter(fits).map((f) => ({ id: f.id, value })) : [];
  return { approve, skipped: value ? findings.length - approve.length : 0 };
}
