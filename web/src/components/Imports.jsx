import { useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { api } from '../api';
import { MerchantAvatar } from './MerchantAvatar';
import { Button, PageTitle } from './Form';
import { Review } from './Review';
import { ReadingStatement } from './ReadingStatement';
import { AccountFilter } from './AccountFilter';
import { AccountFilterBar } from './AccountFilters';
import { useAccountFilters } from '../account-filters';
import { MonthStatusGrid } from './MonthStatusGrid';
import { bankBrandFor } from '../bankBrands';
import { useNotify } from '../use-notify';
import { useApi } from '../use-api';

// Kept in sync by hand with api/src/parse/pdf-local.js's LOCAL_PARSER_ISSUERS —
// a plain display list, not worth a round trip to the API for.
const LOCAL_PARSER_ISSUERS = ['Bank of America', 'American Express', 'Chase', 'Bilt', 'Robinhood', 'Barclays', 'SoFi', 'Apple Card', 'Zolve'];

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

/**
 * The one drop zone (D182, design A of four). Every file is read free,
 * on this machine, first. A wide, low row (icon, words, the banks it
 * reads, the button) rather than a tall centered box, so it doesn't
 * waste the page's width. Dragging a file over swells the zone and
 * bounces the bank logos, which answers the person's own action.
 *
 * Claude never runs from here. If the free parser doesn't know the
 * bank, the page asks first (ClaudeOffer below).
 */
function DropZone({ fileRef, fileName, onFileChosen, onUpload, uploading }) {
  const [dragOver, setDragOver] = useState(false);

  function acceptFiles(fileList) {
    const file = fileList?.[0];
    if (!file) return;
    // Puts the dropped file onto the same hidden <input> upload() reads.
    const transfer = new DataTransfer();
    transfer.items.add(file);
    fileRef.current.files = transfer.files;
    onFileChosen(file.name);
  }

  return (
    <motion.div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); acceptFiles(e.dataTransfer.files); }}
      animate={{ scale: dragOver ? 1.01 : 1 }}
      transition={{ type: 'spring', stiffness: 260, damping: 20 }}
      className={`rounded-2xl border-2 border-dashed px-5 py-4 transition-colors ${
        dragOver ? 'border-earn bg-earn/5' : 'border-rule-str bg-raised'
      }`}
    >
      <div className="flex flex-col items-stretch gap-4 md:flex-row md:items-center">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex min-w-0 flex-1 items-center gap-4 text-left"
        >
          <motion.span
            className="flex size-12 shrink-0 items-center justify-center rounded-full bg-earn/10 text-earn"
            animate={dragOver ? { y: [0, -5, 0] } : { y: 0 }}
            transition={dragOver ? { duration: 0.9, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.2 }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 15V4M7.5 8.5L12 4l4.5 4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M4 15v3a2 2 0 002 2h12a2 2 0 002-2v-3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          </motion.span>
          <span className="min-w-0">
            <span className="block text-base text-ink md:truncate">
              {fileName ?? (dragOver ? 'Drop it here' : 'Drop a statement, PDF or CSV, or click to browse')}
            </span>
            <span className="block text-sm text-muted">Read free on your computer. Nothing leaves this machine.</span>
          </span>
        </button>

        <div className="flex shrink-0 flex-wrap items-center gap-2" aria-label={`Read free: ${LOCAL_PARSER_ISSUERS.join(', ')} and any CSV`}>
          {LOCAL_PARSER_ISSUERS.map((bank, i) => (
            <motion.span
              key={bank}
              title={bank}
              animate={dragOver ? { y: [0, -5, 0] } : { y: 0 }}
              transition={dragOver ? { duration: 0.8, delay: i * 0.08, repeat: Infinity } : { duration: 0.2 }}
            >
              <MerchantAvatar merchant={bank} size={26} clickable={false} />
            </motion.span>
          ))}
          <span className="ml-1 text-xs whitespace-nowrap text-faint">+ any CSV</span>
        </div>

        <Button onClick={onUpload} disabled={uploading || !fileName}>
          {uploading ? 'Reading…' : 'Read it, free'}
        </Button>
        <input ref={fileRef} type="file" accept=".pdf,.csv" className="hidden" onChange={(e) => acceptFiles(e.target.files)} />
      </div>

      {uploading && <ReadingStatement fileName={fileName} />}
    </motion.div>
  );
}

/**
 * Asked, never assumed (D182): a PDF the free parser couldn't read can
 * go to Claude, but only from this explicit button, for this one file.
 */
function ClaudeOffer({ offer, onAccept, onDismiss, busy }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-3 rounded-xl border border-warn/40 bg-warn/10 p-4 text-sm"
      role="alert"
    >
      <p className="text-ink">
        <span className="font-medium">{offer.fileName}</span> couldn't be read for free.{' '}
        <span className="text-muted">{offer.reason}</span>
      </p>
      <p className="mt-1 text-muted">
        Claude can read it instead: its transaction pages are sent to Anthropic, and it costs a few cents. Only if you say so.
      </p>
      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={onAccept} disabled={busy}>{busy ? 'Reading with Claude…' : 'Read with Claude'}</Button>
        <Button size="sm" variant="quiet" onClick={onDismiss} disabled={busy}>Not now</Button>
      </div>
    </motion.div>
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
function BatchCard({ batch, label, isOpen, onToggleOpen, onCloseModal, parsingId, onParse, onDelete, report, categories, accounts, people, onApproved, reveal, showReading, onReadWithClaude }) {
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
          {batch.status === 'FAILED' && batch.file_type === 'PDF' && batch.parse_method === 'local' && !needsPassword(batch) && !isParsing && (
            <button
              onClick={onReadWithClaude}
              disabled={parsingId !== null}
              className="text-sm text-ink underline-offset-4 hover:underline disabled:opacity-50"
            >
              Read with Claude
            </button>
          )}
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

      {isParsing && showReading && <ReadingStatement fileName={batch.original_filename} fileType={batch.file_type} />}

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
          reveal={reveal}
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
  // The statement list (D211): loaded by useApi, refreshed in place by
  // load() after an upload or approval, which callers await.
  const list = useApi('imports', () => api.imports.list(), { tags: ['imports'] });
  const batches = list.data ?? [];
  const [actionError, setError] = useState(null);
  const error = actionError ?? list.error;
  const [uploading, setUploading] = useState(null); // null | 'api' | 'local' — which box is busy
  const [openBatchId, setOpenBatchId] = useState(null);
  const [revealId, setRevealId] = useState(null); // batch just parsed: its Review plays the reading reveal once
  const [modalBatchId, setModalBatchId] = useState(null); // batch shown in the year-grid's popup dialog
  const [parsingId, setParsingId] = useState(null);
  const [reports, setReports] = useState({}); // batchId -> last parse report (PDF only)
  const [pickedAccountId, setSelectedAccountId] = useState(null);
  const [yearPick, setYearPick] = useState({ accountId: null, idx: 0 });
  const fileRef = useRef(null);
  const [fileName, setFileName] = useState(null);
  const [claudeOffer, setClaudeOffer] = useState(null); // { batchId, fileName, reason } after a free read fails

  const load = async () => {
    try {
      list.setData(await api.imports.list());
    } catch (err) {
      setError(err.message);
    }
  };

  /**
   * Upload and read the file, free, on this machine (D182). If the free
   * parser can't read a PDF (a bank it doesn't know yet), the page asks
   * whether to use Claude instead; it never switches on its own.
   */
  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError('Choose a statement file first');
      return;
    }
    setUploading('local');
    setError(null);
    setClaudeOffer(null);
    const started = Date.now();
    let batch = null;
    try {
      batch = await api.imports.upload(file, 'local');
      setParsingId(batch.id);
      await load();
      const result = await api.imports.parse(batch.id);
      // A CSV reads in a fraction of a second; hold the reading animation
      // long enough to be seen instead of a flash.
      await new Promise((r) => setTimeout(r, Math.max(0, 2000 - (Date.now() - started))));
      if (result.report) setReports((r) => ({ ...r, [batch.id]: result.report }));
      setRevealId(batch.id);
      setOpenBatchId(batch.id);
      fileRef.current.value = '';
      setFileName(null);
      await load();
      notify(`${file.name} read`, { type: 'success' });
    } catch (err) {
      await load();
      if (batch && batch.file_type === 'PDF' && !/password/i.test(err.message)) {
        setClaudeOffer({ batchId: batch.id, fileName: file.name, reason: err.message });
        fileRef.current.value = '';
        setFileName(null);
      } else {
        setError(err.message);
        notify(`Couldn't read ${file.name}: ${err.message}`, { type: 'error' });
      }
    } finally {
      setUploading(null);
      setParsingId(null);
    }
  }

  /** The one way a PDF reaches Claude: the person said yes to this file. */
  async function readWithClaude(batchId) {
    setError(null);
    setParsingId(batchId);
    try {
      const result = await api.imports.parse(batchId, undefined, 'api');
      if (result.report) setReports((r) => ({ ...r, [batchId]: result.report }));
      setClaudeOffer(null);
      setRevealId(batchId);
      setOpenBatchId(batchId);
      await load();
    } catch (err) {
      setError(err.message);
      await load();
      notify(`Claude couldn't read it: ${err.message}`, { type: 'error' });
    } finally {
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
      setRevealId(batchId);
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
  // Worked out each render, not corrected by an effect after (D211).
  const selectedAccountId = pickedAccountId !== null && visibleAccountIds.has(pickedAccountId) ? pickedAccountId : null;
  // The year being looked at belongs to the card: another card starts on its latest year.
  const yearIdx = yearPick.accountId === selectedAccountId ? yearPick.idx : 0;
  const setYearIdx = (fn) => setYearPick({ accountId: selectedAccountId, idx: fn(yearIdx) });

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
      onToggleOpen={() => { setRevealId(null); setOpenBatchId(openBatchId === batch.id ? null : batch.id); }}
      reveal={revealId === batch.id}
      showReading={uploading === null /* an upload shows it in its own box */}
      onCloseModal={onCloseModal}
      parsingId={parsingId}
      onParse={(password) => parse(batch.id, batch.file_type, batch.parse_method, password)}
      onReadWithClaude={() => {
        if (window.confirm(`Read ${batch.original_filename} with Claude? Its transaction pages are sent to Anthropic, and it costs a few cents.`)) {
          readWithClaude(batch.id);
        }
      }}
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

      <div className="mb-6">
        <DropZone
          fileRef={fileRef}
          fileName={fileName}
          onFileChosen={setFileName}
          onUpload={upload}
          uploading={uploading !== null}
        />
        {claudeOffer && (
          <ClaudeOffer
            offer={claudeOffer}
            busy={parsingId === claudeOffer.batchId}
            onAccept={() => readWithClaude(claudeOffer.batchId)}
            onDismiss={() => setClaudeOffer(null)}
          />
        )}
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
        <div className="modal-scrim fixed inset-0 z-20 flex items-center justify-center bg-ink/30 p-4" onClick={() => setModalBatchId(null)}>
          <div className="max-h-[90vh] w-full max-w-6xl overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            {renderCard(modalBatch, { onCloseModal: () => setModalBatchId(null) })}
          </div>
        </div>
      )}
    </section>
  );
}
