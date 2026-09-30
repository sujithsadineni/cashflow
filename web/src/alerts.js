import { api, formatMoney } from './api';

/**
 * "Already shown today," not "shown once ever" or "shown every
 * reload." A condition that's still true tomorrow (the statement's
 * still not up, the subscription still hasn't posted) deserves a
 * fresh mention rather than going silent forever the first time it's
 * seen — but three page refreshes in one evening shouldn't repeat the
 * same toast three times. Keyed on the exact set of findings in each
 * group, so the moment that set changes (one gets resolved, a new one
 * joins) it reads as new again automatically, with no separate
 * "clear this alert" logic to build.
 */
const SEEN_PREFIX = 'cashflow_alert_seen:';

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function alreadyShownToday(key) {
  try {
    return localStorage.getItem(SEEN_PREFIX + key) === todayKey();
  } catch {
    return false;
  }
}

function markShownToday(key) {
  try {
    localStorage.setItem(SEEN_PREFIX + key, todayKey());
  } catch {
    // Private browsing / blocked storage — the toast still shows this
    // session, it just won't be remembered as "already seen" next time.
  }
}

/** "A, B, C" for 3 or fewer; "A, B, +3 more" past that — a toast is a line, not a list. */
function summarizeNames(names, max = 3) {
  if (names.length <= max) return names.join(', ');
  return `${names.slice(0, max).join(', ')}, +${names.length - max} more`;
}

/**
 * One toast per CATEGORY of finding, not one per finding — the first
 * version of this did the latter and a real household with five
 * lapsed subscriptions got a wall of seven stacked toasts covering
 * half the screen on every load. A single summarizing line reads as
 * designed; a toast per row reads as a bug.
 */
export async function checkAlerts(notify) {
  let alerts;
  try {
    alerts = await api.alerts();
  } catch {
    return; // best-effort — a failed check shouldn't itself become an error toast
  }

  const { overdue_statements: statements, missed_recurring: missed, new_recurring: found } = alerts;

  if (statements.length > 0) {
    const key = `statements:${statements.map((s) => `${s.account_id}:${s.expected_by}`).sort().join(',')}`;
    if (!alreadyShownToday(key)) {
      const message = statements.length === 1
        ? `${statements[0].account_name}${statements[0].mask ? ` ···${statements[0].mask}` : ''} statement is ${statements[0].days_overdue} day${statements[0].days_overdue === 1 ? '' : 's'} past due — please upload`
        : `${statements.length} statements are past due — please upload: ${summarizeNames(statements.map((s) => s.account_name))}`;
      notify(message, { type: 'error', duration: 8000 });
      markShownToday(key);
    }
  }

  if (missed.length > 0) {
    const key = `missed:${missed.map((r) => `${r.id}:${r.expected_date}`).sort().join(',')}`;
    if (!alreadyShownToday(key)) {
      const message = missed.length === 1
        ? `${missed[0].name}${missed[0].expected_amount_cents != null ? ` (~${formatMoney(Math.abs(missed[0].expected_amount_cents))})` : ''} hasn't shown up this month`
        : `${missed.length} recurring charges haven't shown up this month: ${summarizeNames(missed.map((r) => r.name))}`;
      notify(message, { type: 'error', duration: 8000 });
      markShownToday(key);
    }
  }

  if (found.length > 0) {
    const key = `new-recurring:${found.map((c) => c.match_name_contains).sort().join(',')}`;
    if (!alreadyShownToday(key)) {
      const message = found.length === 1
        ? `Found a new recurring charge: ${found[0].name}${found[0].expected_amount_cents != null ? ` ~${formatMoney(Math.abs(found[0].expected_amount_cents))}` : ''} (${found[0].cadence.toLowerCase()})`
        : `Found ${found.length} new recurring charges: ${summarizeNames(found.map((c) => c.name))}`;
      notify(message, { type: 'info' });
      markShownToday(key);
    }
  }
}
