import { useEffect, useState } from 'react';
import { api, formatTimestamp } from '../../api';
import { Button } from '../Form';
import { useDesign } from '../../use-design';
import { GroupSection, Group, Row } from './glass-ui';

/**
 * Settings → Backups (D205): when the last copy was made, where it lives,
 * a "Back up now", and how to restore. The API makes one a day on its own;
 * this is for checking it's happening and for a copy before something risky.
 */

const size = (bytes) => (bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const ago = (iso, now) => {
  const hours = (now - Date.parse(iso)) / 3_600_000;
  if (hours < 1) return 'less than an hour ago';
  if (hours < 24) return `${Math.floor(hours)} hour${Math.floor(hours) === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
};

export function Backups() {
  const glass = useDesign().design === 'glass';
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.backups.status().then((d) => !cancelled && setData({ ...d, now: Date.now() })).catch((err) => !cancelled && setError(err.message));
    return () => { cancelled = true; };
  }, []);

  const backUp = async () => {
    setBusy(true);
    setError(null);
    try {
      setData({ ...(await api.backups.run()), now: Date.now() });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const last = data?.last;
  // "Now" is when the status arrived, so rendering stays pure.
  const stale = last && data.now - Date.parse(last.at) > 2 * 86_400_000;
  const file = last?.file?.split('/').pop();

  if (glass) return <GlassBackups data={data} error={error} busy={busy} backUp={backUp} last={last} stale={stale} file={file} />;

  return (
    <div className="max-w-2xl space-y-6">
      <section>
        <h2 className="text-base font-medium text-ink">Backups</h2>
        <p className="mt-1 text-sm text-muted">
          Once a day the app copies the whole database and any new statement PDFs to a folder outside the project, and keeps
          the newest {data?.keep ?? 30} database copies.
        </p>
      </section>

      {error && <p className="text-sm text-spend">{error}</p>}
      {!data && !error && <p className="text-sm text-muted">Loading…</p>}

      {data && (
        <div className="rounded-lg border border-rule bg-raised px-4 py-3 text-sm">
          {last ? (
            <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-1.5">
              <dt className="text-muted">Last backup</dt>
              <dd className={stale ? 'text-spend' : 'text-ink'}>
                {ago(last.at, data.now)} <span className="text-faint">· {formatTimestamp(last.at)}</span>
                {stale && <span className="block text-xs">The API makes one a day while it's running. Back up now to catch up.</span>}
              </dd>
              <dt className="text-muted">Database</dt>
              <dd className="text-ink"><span className="font-mono text-xs">{file}</span> <span className="text-faint">· {size(last.bytes)}</span></dd>
              <dt className="text-muted">Statements</dt>
              <dd className="text-ink"><span className="font-mono tnum">{last.statements}</span> PDFs{last.statements_added > 0 && <span className="text-faint"> · {last.statements_added} new</span>}</dd>
              <dt className="text-muted">Folder</dt>
              <dd className="break-all font-mono text-xs text-ink">{data.folder}</dd>
            </dl>
          ) : (
            <p className="text-spend">No backup yet. Back up now to make the first one.</p>
          )}
          <div className="mt-3">
            <Button size="sm" onClick={backUp} disabled={busy}>{busy ? 'Backing up…' : 'Back up now'}</Button>
          </div>
        </div>
      )}

      {data && (
        <section className="text-sm">
          <h3 className="font-medium text-ink">Restoring</h3>
          <p className="mt-1 text-muted">Stop the API, then in a terminal, using the database copy you want:</p>
          <pre className="mt-2 overflow-x-auto rounded-md border border-rule bg-band px-3 py-2 font-mono text-xs text-ink">{`dropdb cashflow && createdb cashflow
pg_restore --no-owner -d cashflow "${data.folder}/db/${file ?? 'cashflow-YYYY-MM-DD-HHMM.dump'}"`}</pre>
          <p className="mt-2 text-muted">
            Statement PDFs are in <span className="font-mono text-xs">{data.folder}/data</span>. Copy that folder back to the project's
            <span className="font-mono text-xs"> data</span> folder.
          </p>
        </section>
      )}
    </div>
  );
}

/**
 * Glass (D244): the status as a grouped list, "Back Up Now" as the group's
 * blue action row (Apple puts a list's action in the list), and the restore
 * command in its own group with a Copy button, so nobody retypes a path.
 */
function GlassBackups({ data, error, busy, backUp, last, stale, file }) {
  const [copied, setCopied] = useState(false);
  if (error && !data) return <p className="px-4 text-[13px] text-spend">{error}</p>;
  if (!data) return <p className="px-4 text-[13px] text-muted">Loading…</p>;

  const command = `dropdb cashflow && createdb cashflow
pg_restore --no-owner -d cashflow "${data.folder}/db/${file ?? 'cashflow-YYYY-MM-DD-HHMM.dump'}"`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard blocked: the text is still selectable */ }
  };

  return (
    <div className="grid grid-cols-1 gap-8 xl:grid-cols-2 xl:items-start">
      <GroupSection
        label="Status"
        footnote={`Once a day the app copies the whole database and any new statement PDFs to a folder outside the project, and keeps the newest ${data.keep ?? 30} database copies.`}
      >
        <Group>
          {last ? (
            <>
              <Row
                title="Last backup"
                subtitle={formatTimestamp(last.at)}
                trailing={<span className={`text-[15px] ${stale ? 'text-spend' : 'text-muted'}`}>{ago(last.at, data.now)}</span>}
              />
              <Row title="Database" subtitle={file} trailing={<span className="text-[15px] text-muted tnum">{size(last.bytes)}</span>} />
              <Row
                title="Statements"
                trailing={
                  <span className="text-[15px] text-muted">
                    <span className="tnum">{last.statements}</span> PDFs
                    {last.statements_added > 0 && <span className="text-earn"> · {last.statements_added} new</span>}
                  </span>
                }
              />
              <Row title="Folder" subtitle={<span className="font-mono text-[12px]">{data.folder}</span>} />
            </>
          ) : (
            <Row title={<span className="text-spend">No backup yet</span>} subtitle="Back up now to make the first one." />
          )}
          <Row
            onClick={busy ? undefined : backUp}
            actionProps={{ disabled: busy }}
            title={<span className="font-medium text-info">{busy ? 'Backing Up…' : 'Back Up Now'}</span>}
          />
        </Group>
        {stale && <p className="mt-1.5 px-4 text-[13px] text-spend">It's been over two days. The API makes one a day while it's running.</p>}
        {error && <p className="mt-1.5 px-4 text-[13px] text-spend">{error}</p>}
      </GroupSection>

      <GroupSection
        label="Restoring"
        action={
          <button type="button" onClick={copy} className="text-[13px] font-medium text-info">
            {copied ? 'Copied' : 'Copy'}
          </button>
        }
        footnote={<>Stop the API first. Statement PDFs are in <span className="font-mono text-[12px]">{data.folder}/data</span>; copy that folder back to the project's <span className="font-mono text-[12px]">data</span> folder.</>}
      >
        <Group as="div">
          <pre className="overflow-x-auto px-4 py-3 font-mono text-[12px] leading-relaxed text-ink">{command}</pre>
        </Group>
      </GroupSection>
    </div>
  );
}
