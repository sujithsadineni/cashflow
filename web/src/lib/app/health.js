/**
 * What the corner status icons show (D333), from one call to /api/health.
 * The API answers 200 when it and Postgres are both up, and 503 when it's
 * up but can't reach the database; no answer, or any other error, means
 * the API itself is down, and then nothing is known about the database.
 *
 * `outcome` is { status, body } for an answer, or { unreachable: true }.
 */
export function readHealth(outcome) {
  if (!outcome) return { api: 'checking', db: 'checking' };
  if (outcome.unreachable) return { api: 'down', db: 'unknown' };
  if (outcome.status === 200 && outcome.body?.status === 'ok') {
    return {
      api: 'ok',
      db: 'ok',
      database: outcome.body.database,
      // "PostgreSQL 17.11 (Homebrew) on aarch64-…" → "PostgreSQL 17.11"
      postgres: outcome.body.postgres?.split(' ').slice(0, 2).join(' '),
      uptimeSeconds: outcome.body.uptime_seconds,
    };
  }
  // Only the API's own 503 says the database is down. Anything else (the
  // Vite proxy's 502 when nothing is listening on :4000) is the API down.
  if (outcome.status === 503 && outcome.body?.status === 'error') return { api: 'ok', db: 'down' };
  return { api: 'down', db: 'unknown' };
}

/** "3 min", "2 h 5 min", "4 days": how long the API has been running. */
export function uptimeLabel(seconds) {
  if (seconds == null) return null;
  if (seconds < 60) return 'under a minute';
  const min = Math.floor(seconds / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
  const days = Math.floor(h / 24);
  return days === 1 ? '1 day' : `${days} days`;
}

/** 48213504 → "46 MB": the database's size on disk, as a person reads it. */
export function bytesLabel(bytes) {
  if (bytes == null) return null;
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${i === 0 ? n : n < 10 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

/** How long ago a check was, from two millisecond times: "just now", "40 s ago", "3 min ago". */
export function agoLabel(then, now) {
  if (then == null) return null;
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s} s ago`;
  const min = Math.floor(s / 60);
  return min < 60 ? `${min} min ago` : `${Math.floor(min / 60)} h ago`;
}

/** Round-trip time in words: "under 1 ms", "4 ms", "1.2 s". */
export function msLabel(ms) {
  if (ms == null) return null;
  if (ms < 1) return 'under 1 ms';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}
