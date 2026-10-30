import { useEffect, useState } from 'react';
import { api, formatShortDate, formatTimestamp } from '../../api';
import { agoLabel, bytesLabel, msLabel, uptimeLabel } from '../../lib/app/health';

/**
 * The card above a corner status icon (D333): one for the API, one for the
 * database, each with its own facts, read from /api/health/details when it
 * opens (and on Check again), so the 30-second health check stays small.
 * Greys only, like the icons. A header with the same moving icon and the
 * state in words, what it means when something's down and the command
 * that starts it, the facts as label/value rows (the Settings detail
 * rows' layout), and a footer with when it was checked. A caret points at
 * the button it belongs to.
 */

const STATE_LINE = {
  api: { ok: 'Running', checking: 'Checking…', down: 'Not reachable', unknown: 'Unknown' },
  db: { ok: 'Connected', checking: 'Checking…', down: 'Not reachable', unknown: 'Unknown' },
};

function Rows({ rows }) {
  return (
    <dl className="mx-3 grid grid-cols-1 rounded-xl bg-band/70 px-3 py-1 text-[12.5px]">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-baseline justify-between gap-3 border-t border-rule py-1.5 first:border-t-0">
          <dt className="shrink-0 text-muted">{label}</dt>
          <dd className="min-w-0 truncate text-right text-ink tnum">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Command({ children }) {
  return <p className="mx-3 mt-2 rounded-lg border border-rule bg-band/70 px-3 py-2 font-mono text-[11.5px] text-ink">{children}</p>;
}

function apiBody(health, details, ms, now) {
  if (health.api === 'down') {
    const last = agoLabel(health.lastOkAt, now);
    return {
      message: `Nothing new loads or saves until it's back.${last ? ` Last answered ${last}.` : ''} Start it from the project folder:`,
      command: 'cd api && npm run dev',
    };
  }
  if (health.api !== 'ok' || !details) return { rows: [['Status', STATE_LINE.api[health.api]]] };
  const a = details.api;
  return {
    rows: [
      ['Answered in', msLabel(ms)],
      ['Up for', uptimeLabel(a.uptime_seconds)],
      ['Started', formatTimestamp(a.started_at)],
      ['Node', a.node],
      ['Port', a.port],
    ],
  };
}

function dbBody(health, details) {
  if (health.db === 'unknown') return { message: "It's checked through the API, which isn't answering. Start the API first." };
  if (health.db === 'down' || (details && !details.db)) {
    return { message: "The API is running but can't reach Postgres. Start it with:", command: 'brew services start postgresql@17' };
  }
  if (health.db !== 'ok' || !details) return { rows: [['Status', STATE_LINE.db[health.db]]] };
  const d = details.db;
  return {
    rows: [
      ['Name', d.name],
      ['Server', `PostgreSQL ${d.server_version.split(' ')[0]}`],
      ['Answered in', msLabel(d.ping_ms)],
      ['Size', bytesLabel(d.size_bytes)],
      ['Transactions', d.transactions.toLocaleString('en-US')],
      ['Accounts', `${d.accounts.toLocaleString('en-US')}${d.closed_accounts ? ` · ${d.closed_accounts} closed` : ''}`],
      ['Newest day', formatShortDate(d.latest_posted)],
    ],
  };
}

export function StatusCard({ kind, health, icon, caretLeft, narrow = false }) {
  const [details, setDetails] = useState(null);
  const [ms, setMs] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const apiUp = health.api === 'ok';

  // Read the details when the card opens, after each check, and while the API is up.
  useEffect(() => {
    if (!apiUp) return;
    let live = true;
    const started = performance.now();
    api.healthDetails()
      .then((d) => {
        if (!live) return;
        setMs(performance.now() - started);
        setDetails(d);
      })
      .catch(() => live && setDetails(null));
    return () => {
      live = false;
    };
  }, [apiUp, health.checkedAt]);

  // "Checked 40 s ago" keeps counting while the card is open.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  const state = kind === 'api' ? health.api : health.db;
  const body = kind === 'api' ? apiBody(health, details, ms, now) : dbBody(health, details);
  const title = kind === 'api' ? 'API' : 'Database';

  return (
    <div role="dialog" aria-label={`${title}: ${STATE_LINE[kind][state]}`} className={`status-card dropdown-panel absolute bottom-full left-0 z-10 mb-3 ${narrow ? 'w-[13.5rem]' : 'w-72'} rounded-2xl border border-rule bg-raised pb-1 shadow-lg`}>
      <span className="absolute -bottom-[7px] size-3 rotate-45 border-b border-r border-rule bg-raised" style={{ left: caretLeft }} aria-hidden="true" />
      <header className="flex items-center gap-3 px-4 pb-3 pt-3.5">
        <span className={`status-${kind} s-${state} flex size-9 shrink-0 items-center justify-center rounded-full border border-rule bg-band text-ink`} aria-hidden="true">
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-[15px] font-semibold leading-tight text-ink">{title}</p>
          <p className="text-[12.5px] text-muted">{STATE_LINE[kind][state]}</p>
        </div>
      </header>
      {body.message && <p className="px-4 pb-2 text-[12.5px] leading-snug text-muted">{body.message}</p>}
      {body.rows && <Rows rows={body.rows} />}
      {body.command && <Command>{body.command}</Command>}
      <footer className="flex items-center justify-between px-4 pb-2 pt-2.5 text-[12px]">
        <span className="text-faint">{health.checkedAt ? `Checked ${agoLabel(health.checkedAt, Math.max(now, health.checkedAt))}` : 'Not checked yet'}</span>
        <button type="button" onClick={health.check} disabled={health.checking} className="rounded-md px-1.5 py-0.5 font-medium text-ink hover:bg-band disabled:opacity-50">
          {health.checking ? 'Checking…' : 'Check again'}
        </button>
      </footer>
    </div>
  );
}
