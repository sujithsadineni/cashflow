import { useCallback, useEffect, useState } from 'react';
import { readHealth } from '../lib/app/health';

const EVERY_MS = 30_000;
const TIMEOUT_MS = 5_000;

/**
 * Live API and database status for the corner icons (D333): checked on
 * load, every 30 seconds, when the window comes back into focus, and on
 * `check()`. A plain fetch, not api.js's request(), so a stopped server
 * shows on the icons instead of a toast every 30 seconds.
 */
export function useHealth() {
  const [outcome, setOutcome] = useState(null);
  const [checking, setChecking] = useState(false);
  // When the last check finished, and when the API last answered: the cards say "Checked just now", "Last answered 3 min ago".
  const [checkedAt, setCheckedAt] = useState(null);
  const [lastOkAt, setLastOkAt] = useState(null);

  const check = useCallback(async () => {
    setChecking(true);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      // The GitHub Pages demo has no server: the recorded answer stands in, as in api.js.
      if (import.meta.env.VITE_DEMO === '1') {
        const { demoRequest } = await import('../lib/demo/demo.js');
        const body = await demoRequest('/health');
        setOutcome({ status: 200, body });
        if (readHealth({ status: 200, body }).api === 'ok') setLastOkAt(Date.now());
        return;
      }
      const res = await fetch('/api/health', { signal: controller.signal });
      const body = await res.json().catch(() => ({}));
      setOutcome({ status: res.status, body });
      if (readHealth({ status: res.status, body }).api === 'ok') setLastOkAt(Date.now());
    } catch {
      setOutcome({ unreachable: true });
    } finally {
      clearTimeout(timer);
      setChecking(false);
      setCheckedAt(Date.now());
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(check, 0);
    const id = setInterval(check, EVERY_MS);
    window.addEventListener('focus', check);
    return () => {
      clearTimeout(first);
      clearInterval(id);
      window.removeEventListener('focus', check);
    };
  }, [check]);

  return { ...readHealth(outcome), checking, check, checkedAt, lastOkAt };
}
