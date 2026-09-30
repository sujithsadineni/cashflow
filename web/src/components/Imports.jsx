import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { Button, PageTitle } from './Form';
import { Review } from './Review';
import { AccountFilter } from './AccountFilter';
import { useAccountFilters, AccountFilterBar } from './AccountFilters';
import { MonthStatusGrid } from './MonthStatusGrid';
import { bankBrandFor } from '../bankBrands';
import { useNotify } from '../notification-context';

// Kept in sync by hand with api/src/parse/pdf-local.js's LOCAL_PARSER_ISSUERS —
// a plain display list, not worth a round trip to the API for.
const LOCAL_PARSER_ISSUERS = ['Bank of America', 'American Express', 'Chase', 'Bilt'];

const STATUS_LABELS = {
  UPLOADED: 'Uploaded',
  PARSING: 'Parsing',
  NEEDS_ACCOUNT: 'Confirm account',
  REVIEW: 'Needs review',
  APPROVED: 'Approved',
  FAILED: 'Failed',
};

// Anything not yet resolved to a confirmed account — there's no card
// to file these under yet, so they can't live in the wallet view.
const NEEDS_ATTENTION_STATUSES = new Set(['UPLOADED', 'PARSING', 'NEEDS_ACCOUNT', 'FAILED']);

const slugify = (s) =>
  (s ?? '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * A consistent bank-date label instead of whatever the issuer named
 * the download — real examples from this household's own statements:
 * "eStmt_2026-08-13.pdf", "Statement_f2a6c862-ba8a-432b-8dad-...pdf",
 * "document_1789439521542869.pdf". None of that is worth reading.
 *
 * Bank + date alone collides for real: this household's BofA credit
 * card and BofA checking account both close in the same month, which
 * would make two different statements both "bofa-2026-08". The last 4
 * digits (already unique per account) breaks the tie; an account with
 * no mask on file falls back to a slug of its own name instead.
 *
 * This is a DISPLAY label only — original_filename is never touched,
 * so the real provenance is still there if it's ever needed. Only
 * possible once the statement's parsed (period_end known) and its
 * account confirmed; before that, there's nothing to build it from.
 */
function statementLabel(batch) {
  if (!batch.period_end || !batch.account_id) return batch.original_filename;
  const bank = bankBrandFor(batch.account_issuer)?.key || slugify(batch.account_issuer || batch.account_name) || 'statement';
  const distinguisher = batch.account_mask || slugify(batch.account_name);
  return `${bank}-${distinguisher}-${batch.period_end.slice(0, 7)}`;
}

function StatusChip({ status }) {
  const tone = {
    NEEDS_ACCOUNT: 'text-warn border-warn/40',
    REVIEW: 'text-warn border-warn/40',
    APPROVED: 'text-earn border-earn/40',
    FAILED: 'text-spend border-spend/40',
  }[status] ?? 'text-muted border-rule';

  return (
    <span className={`border px-2 py-0.5 text-xs ${tone}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

// A batch that failed here specifically needs a password, not just a
// retry — pdfjs-dist doesn't hand back a dedicated error code for
// this, so this matches the two exact messages routes/imports.js
// writes for a PasswordException, rather than adding a schema column
// just to carry one boolean.
const needsPassword = (batch) =>
  batch.status === 'FAILED' && /password/i.test(batch.error_message ?? '');

const uploadIconProps = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true };
const uploadStrokeProps = { stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' };

// Cloud (goes out to the API) vs. a shield (verified locally, never
// leaves the machine) — a real, meaningful difference between the two
// boxes, not decoration for its own sake. Line icons, not emoji: this
// app's design system explicitly avoids emoji everywhere else, and a
// third visual vocabulary for just these two boxes would read as
// inconsistent next to the sidebar/Overview icons.
function CloudUploadIcon() {
  return (
    <svg {...uploadIconProps}>
      <path d="M4.5 11.5a2.8 2.8 0 01-.4-5.57 3.3 3.3 0 016.3-1.2 2.6 2.6 0 013.1 2.55 2.4 2.4 0 01-.5 4.22" {...uploadStrokeProps} />
      <path d="M8 6.5v5.5M6 8.5L8 6.5l2 2" {...uploadStrokeProps} />
    </svg>
  );
}

function ShieldCheckIcon() {
  return (
    <svg {...uploadIconProps}>
      <path d="M8 1.8l4.8 1.7v4c0 3-2 5.4-4.8 6.7-2.8-1.3-4.8-3.7-4.8-6.7v-4L8 1.8z" {...uploadStrokeProps} />
      <path d="M5.7 8.2l1.6 1.6 3-3.2" {...uploadStrokeProps} />
    </svg>
  );
}

/**
 * One of the two upload zones on the Statements page, side by side —
 * "Claude API" (left, costs money, reads any issuer) and "Local
 * parsing" (right, free, only the issuers parse/pdf-local.js actually
 * knows how to read). Same shape, different copy/icon/accent, so
 * choosing between them reads as one decision, not two dissimilar
 * forms bolted together.
 *
 * Compact by design (asked for directly — the original was a tall
 * vertical stack: label, native file input on its own row, a long
 * wrapped caption, then the button on yet another row). This packs
 * icon + title + a one-line caption into a single header row, and
 * turns "Choose File" + "Upload & analyze" into one drop target that
 * doubles as the button, rather than three separate controls.
 */
function UploadBox({ title, caption, icon, accent, accentText, fileRef, onUpload, uploading, fileName, onFileChosen }) {
  const [dragOver, setDragOver] = useState(false);

  function acceptFiles(fileList) {
    const file = fileList?.[0];
    if (!file) return;
    // Puts the dropped/re-picked file onto the SAME hidden <input>
    // upload() already reads from — no change needed to that function,
    // drag-and-drop and click-to-browse both just populate one ref.
    const transfer = new DataTransfer();
    transfer.items.add(file);
    fileRef.current.files = transfer.files;
    onFileChosen(file.name);
  }

  return (
    <div className="group relative flex-1 overflow-hidden rounded-xl border border-rule bg-raised p-4 transition-all hover:border-rule-str hover:shadow-md">
      <div className={`absolute inset-x-0 top-0 h-[3px] ${accent}`} />
      <div className="relative flex items-center gap-2.5">
        <span className={`icon-spark flex size-8 shrink-0 items-center justify-center rounded-full bg-band ${accentText} transition-transform duration-300 group-hover:scale-110`}>
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium text-ink">{title}</h3>
          <p className="truncate text-xs text-faint">{caption}</p>
        </div>
      </div>

      <div className="relative mt-3 flex items-center gap-2">
        <div
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); acceptFiles(e.dataTransfer.files); }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click(); }}
          className={`flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-lg border border-dashed px-2.5 py-1.5 text-xs transition-colors ${
            dragOver ? 'border-ink bg-band text-ink' : 'border-rule-str text-muted hover:bg-band/60 hover:text-ink'
          }`}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0">
            <path d="M8 2v7M5 6.5L8 9.5l3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M2.5 11.5v1a1 1 0 001 1h9a1 1 0 001-1v-1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="truncate">{fileName ?? 'Drop file, or click to browse'}</span>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.csv"
            className="hidden"
            onChange={(e) => acceptFiles(e.target.files)}
          />
        </div>
        <Button size="sm" onClick={onUpload} disabled={uploading}>
          {uploading ? '…' : 'Upload'}
        </Button>
      </div>

      {uploading && (
        <div className="relative mt-2 h-1 overflow-hidden rounded-full bg-band" aria-hidden="true">
          <div className={`absolute inset-y-0 w-1/3 rounded-full ${accent} animate-upload-progress`} />
        </div>
      )}
    </div>
  );
}

/**
 * One statement, in either the "needs attention" strip, the wallet's
 * right pane, or the year-grid's popup dialog. `onCloseModal`, when
 * given, means this instance IS that popup: the review table stays
 * permanently expanded (there's nothing else the dialog is for) and
 * the one "Review"/"Close" toggle is replaced by a single ✕ next to
 * the title — previously a second, separately-positioned ✕ floated
 * outside the card entirely, disconnected from its own header and
 * redundant with the "Close" text link still inside it.
 */
function BatchCard({ batch, label, isOpen, onToggleOpen, onCloseModal, parsingId, onParse, onDelete, report, categories, accounts, people, onApproved }) {
  const isParsing = parsingId === batch.id;
  const [password, setPassword] = useState('');
  const reviewOpen = Boolean(onCloseModal) || isOpen;

  const handleDelete = () => {
    const message =
      batch.rows_approved > 0
        ? `Permanently delete this statement and the ${batch.rows_approved} transaction${
            batch.rows_approved === 1 ? '' : 's'
          } it created? This cannot be undone.`
        : 'Permanently delete this import? Nothing has been approved yet, so no transactions are affected.';
    if (window.confirm(message)) onDelete(batch.id);
  };

  return (
    <div className="rounded-2xl border border-rule bg-raised p-5">
      <div className="flex items-baseline justify-between gap-4">
        <div className="min-w-0">
          <span className="text-ink">{label}</span>
          {batch.flagged_count > 0 && (
            <span
              title={`${batch.flagged_count} row${batch.flagged_count === 1 ? '' : 's'} flagged as a possible duplicate — open Review to check them (some may be genuine, e.g. two separate purchases at the same place)`}
              className="ml-1.5 inline-flex size-4 shrink-0 cursor-help items-center justify-center rounded-full
                         bg-warn/15 align-middle text-[10px] font-bold leading-none text-warn"
            >
              !
            </span>
          )}
          {label !== batch.original_filename && (
            <span className="ml-2 text-xs text-faint" title={batch.original_filename}>
              {batch.original_filename}
            </span>
          )}
          <div className="mt-0.5 text-sm text-muted">
            {batch.account_name ?? 'No account'} · {batch.file_type}
            {batch.file_type === 'PDF' && (
              <span className={batch.parse_method === 'local' ? 'text-earn' : ''}>
                {' · '}{batch.parse_method === 'local' ? 'Local parsing' : 'Claude parsing'}
              </span>
            )}
            {batch.rows_parsed > 0 && (
              <span className="tnum"> · {batch.rows_approved}/{batch.rows_parsed} rows approved</span>
            )}
            {batch.error_message && (
              <span className="text-spend"> · {batch.error_message}</span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <StatusChip status={batch.status} />
          {(batch.status === 'UPLOADED' || batch.status === 'FAILED') &&
            (isParsing ? (
              <span className="text-sm text-faint">
                {batch.file_type === 'PDF' ? 'Reading the PDF — takes a minute…' : 'Parsing…'}
              </span>
            ) : needsPassword(batch) ? (
              <>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="PDF password"
                  className="w-32 rounded-md border border-rule bg-raised px-2 py-1 text-sm text-ink
                             focus:border-earn focus:outline-none"
                />
                <button
                  onClick={() => onParse(password)}
                  disabled={parsingId !== null || !password.trim()}
                  className="text-sm text-muted underline-offset-4 hover:text-ink hover:underline disabled:opacity-50"
                >
                  Unlock &amp; parse
                </button>
              </>
            ) : (
              <button
                onClick={() => onParse()}
                disabled={parsingId !== null}
                className="text-sm text-muted underline-offset-4 hover:text-ink hover:underline disabled:opacity-50"
              >
                Parse{batch.file_type === 'PDF' && batch.parse_method !== 'local' ? ' (costs money)' : ''}
              </button>
            ))}
          {!onCloseModal && ['NEEDS_ACCOUNT', 'REVIEW', 'APPROVED'].includes(batch.status) && (
            <button
              onClick={onToggleOpen}
              className="text-sm text-muted underline-offset-4 hover:text-ink hover:underline"
            >
              {isOpen ? 'Close' : 'Review'}
            </button>
          )}
          {!isParsing && (
            <button
              onClick={handleDelete}
              className="text-sm text-faint underline-offset-4 hover:text-spend hover:underline"
            >
              Delete
            </button>
          )}
          {onCloseModal && (
            <button
              onClick={onCloseModal}
              aria-label="Close"
              className="flex size-7 shrink-0 items-center justify-center rounded-full border border-rule
                         text-muted transition-colors hover:bg-band hover:text-ink"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {report && report.parse_method === 'local' ? (
        <div className="mt-2 rounded-md border border-rule bg-band/40 px-3 py-2 text-xs text-muted">
          <span className="tnum text-earn">$0.00</span>
          {' · no API call · '}
          {report.reconciliation && Object.values(report.reconciliation).every((v) => v !== false) ? (
            <span className="text-earn">every printed total matches the parsed rows</span>
          ) : (
            <span className="text-warn">
              a printed total didn't match the parsed rows — double-check this one in Review before trusting it
            </span>
          )}
        </div>
      ) : report && (
        <div className="mt-2 rounded-md border border-rule bg-band/40 px-3 py-2 text-xs text-muted">
          <span className="tnum">
            {report.pages_sent.length}/{report.pages_total} pages sent
          </span>
          {' · '}
          <span className="tnum text-ink">${report.estimated_cost_usd.toFixed(2)}</span>
          {' estimated'}
          {report.pages_skipped.length > 0 && (
            <>
              {' · skipped '}
              {report.pages_skipped.map((p) => `p${p.page}`).join(', ')}
              {' (boilerplate)'}
            </>
          )}
        </div>
      )}

      {reviewOpen && (
        <Review
          batchId={batch.id}
          categories={categories}
          accounts={accounts}
          people={people}
          onApproved={onApproved}
        />
      )}
    </div>
  );
}

export function Imports({ accounts, people, categories, onChange }) {
  const notify = useNotify();
  const [batches, setBatches] = useState([]);
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(null); // null | 'api' | 'local' — which box is busy
  const [openBatchId, setOpenBatchId] = useState(null);
  const [modalBatchId, setModalBatchId] = useState(null); // batch shown in the year-grid's popup dialog
  const [parsingId, setParsingId] = useState(null);
  const [reports, setReports] = useState({}); // batchId -> last parse report (PDF only)
  const [selectedAccountId, setSelectedAccountId] = useState(null);
  const [yearIdx, setYearIdx] = useState(0);
  const apiFileRef = useRef(null);
  const localFileRef = useRef(null);
  const [apiFileName, setApiFileName] = useState(null);
  const [localFileName, setLocalFileName] = useState(null);

  const load = useCallback(async () => {
    try {
      setBatches(await api.imports.list());
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /**
   * Upload the file. CSV parsing is a local regex pass plus one cheap
   * Haiku call (fractions of a cent) so it still parses immediately —
   * one less click either way. A PDF uploaded through the "Claude"
   * box is a real-money API call and never fires without an explicit,
   * confirmed click: see parse() below. A PDF uploaded through the
   * "Local parsing" box costs nothing, so it auto-parses too, same as
   * CSV — there's no cost gate to protect against.
   */
  async function upload(fileRef, parseMethod, setFileName) {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError('Choose a statement file first');
      return;
    }
    setUploading(parseMethod);
    setError(null);
    try {
      const batch = await api.imports.upload(file, parseMethod);
      if (batch.file_type === 'CSV' || parseMethod === 'local') {
        setParsingId(batch.id);
        await load();
        const result = await api.imports.parse(batch.id);
        if (result.report) setReports((r) => ({ ...r, [batch.id]: result.report }));
        setOpenBatchId(batch.id);
      }
      fileRef.current.value = '';
      setFileName(null);
      await load();
      notify(`${file.name} uploaded`, { type: 'success' });
    } catch (err) {
      setError(err.message);
      await load();
      notify(`Upload failed: ${err.message}`, { type: 'error' });
    } finally {
      setUploading(null);
      setParsingId(null);
    }
  }

  /**
   * A PDF parsed via the Claude box sends real content to the
   * Anthropic API and costs real money (typically a few cents, shown
   * in the batch's report once parsed) — it only ever runs after an
   * explicit confirmation, never automatically. A local-parsed PDF
   * (or any CSV) skips the gate: there's no cost to confirm.
   */
  async function parse(batchId, fileType, parseMethod, password) {
    if (fileType === 'PDF' && parseMethod !== 'local') {
      const proceed = window.confirm(
        'This sends the statement to Claude for extraction and costs real money — typically a few cents, more for a long statement. Continue?'
      );
      if (!proceed) return;
    }
    setError(null);
    setParsingId(batchId);
    try {
      const result = await api.imports.parse(batchId, password);
      if (result.report) setReports((r) => ({ ...r, [batchId]: result.report }));
      setOpenBatchId(batchId);
      await load();
    } catch (err) {
      setError(err.message);
      await load(); // pick up a FAILED status + error_message
      notify(`Parsing failed: ${err.message}`, { type: 'error' });
    } finally {
      setParsingId(null);
    }
  }

  const handleApproved = async () => {
    await load();
    onChange();  // transaction counts on accounts changed
  };

  const handleDelete = async (batchId) => {
    setError(null);
    try {
      await api.imports.remove(batchId);
      if (openBatchId === batchId) setOpenBatchId(null);
      if (modalBatchId === batchId) setModalBatchId(null);
      await load();
      onChange(); // transaction counts on accounts changed, same as approving
    } catch (err) {
      setError(err.message);
    }
  };

  const needsAttention = batches.filter((b) => NEEDS_ATTENTION_STATUSES.has(b.status));

  // A statement only belongs in the wallet once it has a confirmed
  // account — everything else is in needsAttention above instead.
  const walletBatches = batches.filter((b) => !NEEDS_ATTENTION_STATUSES.has(b.status) && b.account_id != null);

  // Only accounts that actually have a statement to show — this is a
  // "browse my statements" view, not account management, so an
  // account with nothing imported yet doesn't need a slot here.
  const walletAccountIds = useMemo(() => new Set(walletBatches.map((b) => b.account_id)), [walletBatches]);
  const walletAccounts = accounts.filter((a) => walletAccountIds.has(a.id));

  // Which of the wallet's own accounts pass the two filters above.
  // The deck always mounts every walletAccount and hides the rest by
  // collapsing them (see AccountFilter's `visibleIds`), so this is a
  // set of ids to show, not a re-filtered array — nothing here reorders
  // the underlying accounts, so a card's DOM node stays put across a
  // filter change instead of remounting.
  const {
    typeFilter, setTypeFilter,
    personFilter, setPersonFilter,
    personOptions: personFilterOptions,
    visibleIds: visibleAccountIds,
  } = useAccountFilters(walletAccounts, people);

  // A card that's selected when a filter hides it shouldn't keep
  // showing its (now hidden) calendar — drop back to the "pick a card"
  // state instead of pointing at something the deck no longer shows.
  useEffect(() => {
    if (selectedAccountId !== null && !visibleAccountIds.has(selectedAccountId)) {
      setSelectedAccountId(null);
    }
  }, [visibleAccountIds, selectedAccountId]);

  useEffect(() => { setYearIdx(0); }, [selectedAccountId]);

  const selectedAccount = walletAccounts.find((a) => a.id === selectedAccountId) ?? null;
  const accountBatches = selectedAccountId === null ? [] : walletBatches.filter((b) => b.account_id === selectedAccountId);
  const uploadedMonthSet = new Set(accountBatches.filter((b) => b.period_end).map((b) => b.period_end.slice(0, 7)));
  const batchByMonth = new Map(accountBatches.filter((b) => b.period_end).map((b) => [b.period_end.slice(0, 7), b]));

  const yearOptions = new Set([new Date().getFullYear()]);
  for (const key of uploadedMonthSet) yearOptions.add(Number(key.slice(0, 4)));
  const sortedYears = [...yearOptions].sort((a, b) => b - a);
  const clampedYearIdx = Math.min(yearIdx, sortedYears.length - 1);
  const year = sortedYears[clampedYearIdx];

  const modalBatch = modalBatchId === null ? null : walletBatches.find((b) => b.id === modalBatchId) ?? null;

  const renderCard = (batch, { onCloseModal } = {}) => (
    <BatchCard
      key={batch.id}
      batch={batch}
      label={statementLabel(batch)}
      isOpen={openBatchId === batch.id}
      onToggleOpen={() => setOpenBatchId(openBatchId === batch.id ? null : batch.id)}
      onCloseModal={onCloseModal}
      parsingId={parsingId}
      onParse={(password) => parse(batch.id, batch.file_type, batch.parse_method, password)}
      onDelete={handleDelete}
      report={reports[batch.id]}
      categories={categories}
      accounts={accounts}
      people={people}
      onApproved={handleApproved}
    />
  );

  return (
    <section className="mb-12">
      <div className="mb-4 flex items-baseline justify-between border-b border-rule pb-2">
        <PageTitle className="text-base font-medium text-ink" emoji="📥" tint="bg-vivid-amber/20">Statements</PageTitle>
      </div>

      <div className="mb-6 flex flex-col gap-4 sm:flex-row">
        <UploadBox
          title="Claude API"
          caption="Any issuer · a few ¢ per PDF · CSV free"
          icon={<CloudUploadIcon />}
          accent="bg-ink/40"
          accentText="text-ink"
          fileRef={apiFileRef}
          fileName={apiFileName}
          onFileChosen={setApiFileName}
          onUpload={() => upload(apiFileRef, 'api', setApiFileName)}
          uploading={uploading === 'api'}
        />
        <UploadBox
          title="Local parsing"
          caption={`Free, $0.00 · ${LOCAL_PARSER_ISSUERS.join(', ')}`}
          icon={<ShieldCheckIcon />}
          accent="bg-earn/60"
          accentText="text-earn"
          fileRef={localFileRef}
          fileName={localFileName}
          onFileChosen={setLocalFileName}
          onUpload={() => upload(localFileRef, 'local', setLocalFileName)}
          uploading={uploading === 'local'}
        />
      </div>
      {error && <p className="mb-6 -mt-2 text-sm text-spend">{error}</p>}

      {needsAttention.length > 0 && (
        <div className="mb-6 max-w-6xl space-y-4">
          {needsAttention.map(renderCard)}
        </div>
      )}

      {walletAccounts.length > 0 && (
        <div className="flex flex-col gap-10 lg:flex-row lg:items-stretch">
          {/* Left half: the two filters stacked, then the deck at its
              own fixed width — never stretched to fill the column —
              centered in whatever vertical space is left under them,
              so a short deck sits in the middle rather than pinned to
              the top. */}
          <div className="flex flex-col lg:w-1/2">
            <div className="mb-6 flex justify-center">
              <AccountFilterBar
                typeFilter={typeFilter} onTypeFilter={setTypeFilter}
                personFilter={personFilter} onPersonFilter={setPersonFilter}
                personOptions={personFilterOptions}
              />
            </div>

            {visibleAccountIds.size === 0 && (
              <p className="mb-6 text-center text-sm text-muted">No cards match this filter.</p>
            )}

            <div className="flex flex-1 items-center justify-center">
              <AccountFilter
                accounts={walletAccounts}
                visibleIds={visibleAccountIds}
                selectedId={selectedAccountId}
                onSelect={setSelectedAccountId}
              />
            </div>
          </div>

          {/* Right half: the statement calendar, unchanged. */}
          <div className="flex flex-col items-center text-center lg:w-1/2 lg:pt-2">
            <div className="mb-4 text-sm">
              {selectedAccount ? (
                <span className="text-ink">
                  {selectedAccount.name}
                  {selectedAccount.mask && <span className="ml-1.5 font-mono text-muted tnum">···{selectedAccount.mask}</span>}
                </span>
              ) : (
                <span className="text-muted">Pick a card to see its statements</span>
              )}
            </div>
            <MonthStatusGrid
              year={year}
              uploadedMonths={uploadedMonthSet}
              canGoPrevYear={clampedYearIdx < sortedYears.length - 1}
              canGoNextYear={clampedYearIdx > 0}
              onPrevYear={() => setYearIdx((i) => Math.min(i + 1, sortedYears.length - 1))}
              onNextYear={() => setYearIdx((i) => Math.max(i - 1, 0))}
              clickableStates={['uploaded']}
              disabled={selectedAccount === null}
              onTileClick={(state, key) => {
                if (state === 'uploaded') setModalBatchId(batchByMonth.get(key)?.id ?? null);
              }}
            />
          </div>
        </div>
      )}

      {modalBatch && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-ink/30 p-4" onClick={() => setModalBatchId(null)}>
          <div className="max-h-[85vh] w-full max-w-3xl overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            {renderCard(modalBatch, { onCloseModal: () => setModalBatchId(null) })}
          </div>
        </div>
      )}
    </section>
  );
}
