import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useDesign } from '../../hooks/use-design';
import { api, formatMoney } from '../../api';
import { useConfirm } from '../../hooks/use-confirm';
import { MerchantAvatar } from '../ui/MerchantAvatar';
import { Button, PageTitle } from '../ui/Form';
import { StatusPill, BatchGlyph, LockedRow, FailedStrip, ReadReport, ErrorBanner, ClaudeOffer } from './BatchParts';
import { UnlockPopover } from './UnlockPopover';
import { ConfirmCardPopover } from './ConfirmCardPopover';
import { PRIMARY, QUIET, DESTRUCTIVE } from './batch-buttons';
import { Review } from '../review/Review';
import { ReadingStages } from './ReadingStages';
import { AccountFilter } from '../ui/AccountFilter';
import { AccountFilterBar } from '../ui/AccountFilters';
import { useAccountFilters } from '../../lib/cards/account-filters';
import { MonthStatusGrid, FoundRing } from '../cards/MonthStatusGrid';
import { statementMonths, tallyGlow, tallyNote } from '../../lib/review/statement-tally-view';
import { printedOn, earlierCards, earlierProducts } from '../../lib/cards/card-history';
import { useCardMonths, useCardMonthAccounts } from '../../hooks/use-statement-gaps';
import { PACE, landingFill } from '../../lib/imports/choreography';
import { bankBrandFor } from '../../lib/cards/bankBrands';
import { statementHeading } from '../../lib/imports/statement-view';
import { StatementPages, StatementSheet } from './StatementPages';
import { useWide } from '../../hooks/use-wide';
import { useNotify } from '../../hooks/use-notify';
import { useApi, invalidate } from '../../hooks/use-api';
import { ListSkeleton } from '../ui/Loading';

// Kept in sync by hand with api/src/parse/pdf-local.js's LOCAL_PARSER_ISSUERS —
// a plain display list, not worth a round trip to the API for.
const LOCAL_PARSER_ISSUERS = ['Bank of America', 'American Express', 'Chase', 'Bilt', 'Robinhood', 'Barclays', 'SoFi', 'Apple Card', 'Zolve'];

// Anything not yet resolved to a confirmed account — there's no card
// to file these under yet, so they can't live in the wallet view.
const NEEDS_ATTENTION_STATUSES = new Set(['UPLOADED', 'PARSING', 'NEEDS_ACCOUNT', 'FAILED']);

// The header's round icon buttons in a statement's own view: Replay, Delete, Close (D335).
const ROUND = 'flex size-8 shrink-0 items-center justify-center rounded-full bg-band text-muted transition-colors hover:text-ink';

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
 * bank, the page asks first, under the reading boxes (D325).
 */
function DropZone({ fileRef, fileName, onFileChosen, onUpload, uploading, rail }) {
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
        dragOver ? 'border-info bg-info/5' : 'border-rule-str bg-raised'
      }`}
    >
      <AnimatePresence mode="wait" initial={false}>
      {rail ? (
        <motion.div key="rail" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: PACE.foldSeconds }}>{rail}</motion.div>
      ) : (
      <motion.div key="drop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: PACE.foldSeconds }}
        className="flex flex-col items-stretch gap-4 md:flex-row md:items-center">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex min-w-0 flex-1 items-center gap-4 text-left"
        >
          <motion.span
            className="flex size-12 shrink-0 items-center justify-center rounded-full bg-info/10 text-info"
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
      </motion.div>
      )}
      </AnimatePresence>
      {/* Stays mounted under the rail: upload() reads the file from it. */}
      <input ref={fileRef} type="file" accept=".pdf,.csv" className="hidden" onChange={(e) => acceptFiles(e.target.files)} />
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
function BatchCard({ still, onAccountConfirmed, batch, label, isOpen, onToggleOpen, onCloseModal, parsingId, onParse, onDelete, report, categories, accounts, people, onApproved, reveal, rail, glow, onUnlock, pickOther, onReadWithClaude, onFocusRow, onReadProgress, pageBeside = false, aside = null, onFinished, printed = null, onFocusFigure, litFigure = null }) {
  const isParsing = parsingId === batch.id;
  const confirm = useConfirm();
  const lockRef = useRef(null); // a locked PDF's password popup hangs from its lock (D325)
  const reviewOpen = Boolean(onCloseModal) || isOpen;
  // Replay the reading, from the header's icon (D335): the review starts over with its reveal.
  const [replay, setReplay] = useState(0);
  const reduceMotion = useReducedMotion();

  const handleDelete = async () => {
    const ok = await confirm(batch.rows_approved > 0
      ? { title: 'Delete this statement?', message: `Its ${batch.rows_approved} transaction${batch.rows_approved === 1 ? '' : 's'} go with it. This can't be undone.`, confirm: 'Delete', destructive: true }
      : { title: 'Delete this upload?', message: 'Nothing from it is approved yet.', confirm: 'Delete', destructive: true });
    if (ok) onDelete(batch.id);
  };

  const account = accounts.find((a) => a.id === batch.account_id);
  const locked = needsPassword(batch);
  const busy = parsingId !== null;
  const canClaude = batch.status === 'FAILED' && batch.file_type === 'PDF' && batch.parse_method === 'local' && !locked;
  const reviewable = ['NEEDS_ACCOUNT', 'REVIEW', 'APPROVED'].includes(batch.status);
  // Its card, last four and dates once they're known (D335); until then the file's name and what's known.
  const heading = statementHeading(batch);
  const facts = heading ? [
    printedOn(batch, account) && `printed on ${printedOn(batch, account)}`,
    ...heading.facts,
  ].filter(Boolean) : [
    batch.account_name ?? 'Card not known yet',
    // An earlier card on the same account: a reissue or the product before an upgrade (D275).
    printedOn(batch, account) && `printed on ${printedOn(batch, account)}`,
    batch.file_type,
    batch.file_type === 'PDF' && (batch.parse_method === 'local' ? 'read on this computer' : 'read by Claude'),
    batch.rows_parsed > 0 && `${batch.rows_approved} of ${batch.rows_parsed} rows saved`,
  ].filter(Boolean);

  const body = (
    <CardBody batch={batch} isParsing={isParsing} locked={locked} busy={busy} onParse={onParse} canClaude={canClaude} onReadWithClaude={onReadWithClaude}
      rail={rail} report={report} reviewOpen={reviewOpen} aside={aside}
      replay={replay} reviewProps={{ reveal: reveal || replay > 0, reading: isParsing, onFinished, hideReplay: Boolean(onCloseModal), categories, accounts, people, onApproved, onAccountConfirmed, pickOther, onFocusRow, onReadProgress, pageBeside, printed, onFocusFigure, litFigure }} />
  );

  return (
    // With its pages (`aside`, D335): one card, the header across the top, the pages and the rows
    // as two columns under it, each scrolling on its own.
    <div id={`batch-${batch.id}`} // overflow-clip, not hidden: it rounds the corners without becoming a scroll container, so the
    // pinned Approve bar sticks to the dialog's own scroll (D335).
    className={`relative overflow-clip border border-rule bg-raised ${aside ? 'flex h-full flex-col rounded-[24px] shadow-[0_30px_80px_-30px_rgb(0_0_0/0.55)]' : 'rounded-[20px]'}`}>
      {glow && <FoundRing className="rounded-[20px]" wash="bg-info/10" />}
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-3 p-4 sm:flex-nowrap sm:p-5">
        {locked && !isParsing ? (
          <button ref={lockRef} type="button" onClick={() => onUnlock(lockRef)} aria-label="Unlock this PDF" className="shrink-0 rounded-xl">
            <BatchGlyph status={batch.status} locked still={still} />
          </button>
        ) : <BatchGlyph status={batch.status} locked={locked} reading={isParsing} still={still} />}
        <div className="min-w-0 flex-1 basis-[calc(100%-3.5rem)] sm:basis-auto">
          <p className="flex items-center gap-1.5 text-[15px] font-medium text-ink">
            <span className="truncate" title={`${label} · ${batch.original_filename}`}>{heading ? heading.title : label}</span>
            {heading?.mask && <span className="shrink-0 font-mono text-[13px] font-normal text-muted tnum">··{heading.mask}</span>}
            {batch.flagged_count > 0 && (
              <span title={`${batch.flagged_count} row${batch.flagged_count === 1 ? '' : 's'} may be a duplicate: open Review to check (two purchases at the same place can be real)`}
                className="inline-flex size-4 shrink-0 cursor-help items-center justify-center rounded-full bg-warn/15 text-[10px] font-bold text-warn">!</span>
            )}
          </p>
          <p className="truncate text-[13px] text-muted tnum">{isParsing ? (batch.file_type === 'PDF' ? 'Reading the PDF, about a minute…' : 'Reading…') : facts.join(' · ')}</p>
        </div>
        <div className="ml-14 flex shrink-0 items-center gap-1 sm:ml-0">
          <span className="mr-2"><StatusPill status={isParsing ? 'PARSING' : batch.status} locked={locked && !isParsing} glyph={Boolean(onCloseModal)} /></span>
          {onCloseModal && !isParsing && Number(batch.rows_parsed) > 0 && !reduceMotion && (
            <button type="button" onClick={() => setReplay((n) => n + 1)} aria-label="Replay the reading" title="Replay the reading" className={ROUND}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 8a5 5 0 1 0 1.5-3.6M3 2.5v2.6h2.6" /></svg>
            </button>
          )}
          {batch.status === 'UPLOADED' && !isParsing && (
            <button type="button" onClick={() => onParse()} disabled={busy} className={PRIMARY}>
              {batch.file_type === 'PDF' && batch.parse_method !== 'local' ? 'Read with Claude…' : 'Read it'}
            </button>
          )}
          {locked && !isParsing && (
            <button type="button" onClick={() => onUnlock(lockRef)} disabled={busy} className={PRIMARY}>Unlock…</button>
          )}
          {!onCloseModal && reviewable && (
            <button type="button" onClick={onToggleOpen} className={isOpen ? QUIET : PRIMARY}>{isOpen ? 'Close' : 'Review'}</button>
          )}
          {!isParsing && (onCloseModal ? (
            <button type="button" onClick={handleDelete} aria-label="Delete this statement" title="Delete this statement" className={`${ROUND} hover:!text-spend`}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" /></svg>
            </button>
          ) : <button type="button" onClick={handleDelete} className={DESTRUCTIVE}>Delete</button>)}
          {onCloseModal && (
            <button type="button" onClick={onCloseModal} aria-label="Close" title="Close"
              className={`ml-1 ${ROUND}`}>
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2 2 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
            </button>
          )}
        </div>
      </div>

      {aside ? (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,4fr)_minmax(0,6fr)] border-t border-rule">
          <div className="min-h-0 border-r border-rule bg-band/60">{aside}</div>
          <div className="min-h-0 overflow-y-auto">{body}</div>
        </div>
      ) : body}
    </div>
  );
}

/** What's under the card's header: what went wrong, the reading boxes, how it was read, the rows. */
function CardBody({ batch, isParsing, locked, busy, onParse, canClaude, onReadWithClaude, rail, report, reviewOpen, aside, replay, reviewProps }) {
  return (
    <>
      {batch.status === 'FAILED' && !isParsing && !locked && (
        <FailedStrip message={batch.error_message} busy={busy} onRetry={() => onParse()} onClaude={canClaude ? onReadWithClaude : null} />
      )}

      {rail && <div className="border-t border-rule px-4 py-4 sm:px-5">{rail}</div>}

      <ReadReport report={report} />

      {reviewOpen && (
        <div className={`px-4 pb-4 sm:px-5 ${aside ? '' : 'border-t border-rule'}`}>
          <Review key={replay} batchId={batch.id} {...reviewProps} />
        </div>
      )}
    </>
  );
}

/**
 * A statement opened from its month (D335): its real pages on the left and
 * the statement on the right, side by side and centred, on a screen wide
 * enough for both (1280px and up). The pages light the line being read as
 * it plays in, and afterwards the line of the row being looked at. A CSV, a
 * password-protected PDF or a narrower screen gets the statement alone, at
 * its old width. It's one card (D335, the owner's sketch): the header
 * across the top, the pages and the rows as two columns under it.
 */
function StatementSplit({ batch, renderCard }) {
  const wide = useWide('(min-width: 1280px)');
  const pdf = batch.file_type === 'PDF';
  // Refreshed with the imports: right after an upload the pages come first and the rows' lines once read.
  const layout = useApi(wide && pdf ? `pages:${batch.id}` : null, () => api.imports.pages(batch.id), { tags: ['imports'] });
  // The printed lines, for the drawn page when the real ones can't be shown.
  const staged = useApi(wide ? `staged:${batch.id}` : null, () => api.imports.staged(batch.id), { tags: ['imports'] });
  const [focusId, setFocusId] = useState(null);
  // The strip's figure being hovered (D360): its printed line lights on the pages.
  const [focusFigure, setFocusFigure] = useState(null);
  const [progress, setProgress] = useState(null);
  const real = pdf && layout.data?.available;
  // Where each row sits on the pages and each person's printed total (D360): the reading follows the
  // pages in that order, so it waits the moment they take to arrive; a statement with none reads in the reader's order.
  // One object per answer: the reading reorders its rows when this changes.
  const pagesPending = pdf && !layout.data && !layout.error;
  const printed = useMemo(
    () => (real ? { located: layout.data.rows, totals: layout.data.sections ?? [], headings: layout.data.headings ?? {} } : pagesPending ? { pending: true } : null),
    [real, layout.data, pagesPending],
  );
  const waiting = pdf && !layout.data && !layout.error;
  const reason = !pdf ? 'csv' : layout.data?.reason ?? 'missing';
  const title = batch.account_name ? `${batch.account_name}${batch.account_mask ? ` ··${batch.account_mask}` : ''}` : batch.original_filename;
  const left = real
    ? <StatementPages batchId={batch.id} layout={layout.data} focusId={focusId} progress={progress} focusFigure={focusFigure} />
    : waiting
      ? <div className="h-full animate-pulse bg-band" aria-label="Loading the statement's pages" />
      : <StatementSheet rows={staged.data?.rows} focusId={focusId} progress={progress} title={title} reason={reason} />;
  // Every statement opens as the same card on a screen wide enough for two columns (D335):
  // its real pages on the left when they can be shown, its printed lines drawn as a page when not.
  return wide ? (
    <div className="h-[calc(100vh-7rem)] w-full max-w-[100rem]">
      {renderCard({ aside: left, onFocusRow: setFocusId, onReadProgress: setProgress, pageBeside: true, printed, onFocusFigure: real ? setFocusFigure : undefined, litFigure: focusFigure })}
    </div>
  ) : (
    <div className="max-h-[calc(100vh-7rem)] w-full max-w-5xl overflow-y-auto rounded-[20px]">{renderCard({})}</div>
  );
}

export function Imports({ accounts, people, categories, onChange }) {
  const notify = useNotify();
  const { design } = useDesign();
  const reduceMotion = useReducedMotion();
  const still = design === 'classic' || Boolean(reduceMotion);
  const confirm = useConfirm();
  // The statement list (D211): loaded by useApi, refreshed in place by
  // load() after an upload or approval, which callers await.
  const list = useApi('imports', () => api.imports.list(), { tags: ['imports'] });
  const batches = list.data ?? [];
  const [actionError, setError] = useState(null);
  const error = actionError ?? list.error;
  const [uploading, setUploading] = useState(null); // null | 'api' | 'local' — which box is busy
  // ?open=<id> opens that upload's review: a statement dropped on its alert lands here (D318),
  // on its card and month like a fresh upload (D322).
  const [openBatchId, setOpenBatchId] = useState(() => Number(new URLSearchParams(window.location.search).get('open')) || null);
  const [revealId, setRevealId] = useState(null); // batch just parsed: its Review plays the reading reveal once
  const [modalBatchId, setModalBatchId] = useState(openBatchId); // batch shown in the year-grid's popup dialog
  const [parsingId, setParsingId] = useState(null);
  const [reports, setReports] = useState({}); // batchId -> last parse report (PDF only)
  const [pickedAccountId, setSelectedAccountId] = useState(null);
  const [yearPick, setYearPick] = useState({ accountId: null, year: null });
  const fileRef = useRef(null);
  const [fileName, setFileName] = useState(null);
  // The statement being read, for the six boxes (D325): { source: 'drop' | 'card', batchId,
  // fileName, fileType, size, uploaded, facts?, report?, error? }. One at a time, like parsingId.
  const [reading, setReading] = useState(null);
  const settle = useRef(null);
  // A locked PDF's password popup (D325): { batchId, fileName, anchorRef }; and what its unlock read back.
  const [unlocking, setUnlocking] = useState(null);
  // Find the card's question (D325): { batchId, account, holder }; and statements whose guess was turned down.
  const [confirming, setConfirming] = useState(null);
  const [declined, setDeclined] = useState(() => new Set());
  const unlocked = useRef(null);
  const readingNow = useRef(reading);
  useEffect(() => { readingNow.current = reading; });
  const readCount = useRef(0);
  const nextReadId = () => ++readCount.current;
  // Show the answer and wait for the boxes to play it (and for any question they ask, D325).
  // The boxes let go when they finish; the page lets go when they can't: a new read, the boxes
  // put away, or the page left. (Not the boxes' own unmount: they can mount after the answer is
  // in, behind the drop row's fade, and React's dev double-mount would let go at once.)
  const playOut = (next) => new Promise((resolve) => {
    settle.current = () => { settle.current = null; resolve(); };
    setReading(next);
  });
  const letGo = () => settle.current?.();
  useEffect(() => letGo, []);

  const load = async () => {
    try {
      const fresh = await api.imports.list();
      list.setData(fresh);
      return fresh;
    } catch (err) {
      setError(err.message);
      return null;
    }
  };

  /**
   * A statement whose card is now known, guessed from the statement or just
   * confirmed with "Yes, that's it" (D322, D324): the page picks that card,
   * shows its year, scrolls to its months and plays the upload on the
   * statement's month; then a statement still to review opens. One still
   * needing its card stays in the list on top.
   */
  const [landingId, setLandingId] = useState(null);
  // A file uploaded again (D325): the statement already on file blinks blue on its month, or as its card in the list.
  const [foundId, setFoundId] = useState(null);
  // The card land() found, lifted to second place in the deck while it stays picked (D325).
  const [liftedId, setLiftedId] = useState(null);
  const landTurn = useRef(0);
  // A card already shown at Find the card (D325): the landing at the end doesn't show it again.
  const cardShown = useRef(null);
  const wait = (ms) => new Promise((r) => setTimeout(r, reduceMotion ? 0 : ms));
  /**
   * Shows a card in the deck, one move at a time: the filters narrow to its kind and its person,
   * then it slides to second place and is picked, with the year of the statement's month (a card
   * statement closing early in January holds December, D269). `period` is the statement's.
   */
  const showCard = async (accountId, period, stillHere = () => true) => {
    // The deck and the months in view first, without losing the boxes above them.
    document.getElementById('statement-months')?.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
    const account = accounts.find((a) => a.id === accountId);
    if (account) {
      setTypeFilter(account.account_type === 'CREDIT_CARD' ? 'CREDIT_CARD' : 'BANK');
      setPersonFilter(account.person_id != null ? String(account.person_id) : 'ALL');
      await wait(PACE.filters);
      if (!stillHere()) return false;
    }
    setLiftedId(accountId);
    setSelectedAccountId(accountId);
    const month = period?.period_end ? statementMonths(period, cardMonthAccounts.has(accountId)).at(-1) : null;
    setYearPick({ accountId, year: month ? Number(month.slice(0, 4)) : null });
    await wait(PACE.lift + PACE.pick);
    return stillHere();
  };
  // The month a confirmed card's statement uploads into while the boxes go on (D325): { batchId, keys, fill }.
  const [railLanding, setRailLanding] = useState(null);
  const railLandingNow = useRef(null);
  useEffect(() => { railLandingNow.current = railLanding; });
  const cardMonthAccounts = useCardMonthAccounts();
  const scrollTo = (id) => requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' }));
  // The statement uploaded in this visit, whose card opened at once: closing it lands it on its month.
  const fresh = useRef(null);
  const land = async (batchId, { found = false, fromRail = false, reopen = true } = {}) => {
    // One landing at a time: a newer one takes over instead of being cut short by this one's timer.
    const turn = ++landTurn.current;
    // Was it a card in the list on top (a statement just confirmed with "Yes, that's it")?
    const wasListed = !fromRail && batches.some((x) => x.id === batchId && NEEDS_ATTENTION_STATUSES.has(x.status));
    const b = (await load())?.find((x) => x.id === batchId);
    if (!b || turn !== landTurn.current) return;
    if (b.account_id == null || NEEDS_ATTENTION_STATUSES.has(b.status)) {
      // Read, but its card isn't known yet: it opens the way every statement opens, its pages
      // beside it, with the account question on top (D335); once answered it lands on its month.
      if (!found) {
        if (b.status === 'NEEDS_ACCOUNT' && reopen) setModalBatchId(b.id);
        return;
      }
      setFoundId(b.id);
      scrollTo(`batch-${b.id}`);
      await new Promise((r) => setTimeout(r, 2600));
      if (turn === landTurn.current) setFoundId(null);
      return;
    }
    invalidate('statement-gaps');
    setOpenBatchId(null);
    setModalBatchId(null);
    // One thing at a time, each settling before the next (D325, the owner found it all at once
    // forced): its card folds out of the list, the page glides to the deck and the months, the
    // filters narrow to the card, it slides to second place and comes forward, then its month lands.
    const beat = async (ms) => { await new Promise((r) => setTimeout(r, reduceMotion ? 0 : ms)); return turn === landTurn.current; };
    if (wasListed && !(await beat(450))) return;
    // Shown at Find the card already (the owner said "Yes, that's it" there): straight to its month.
    const shownAlready = cardShown.current === b.account_id;
    cardShown.current = null;
    scrollTo('statement-months');
    if (!(await beat(shownAlready ? 300 : 600))) return;
    if (shownAlready) {
      setSelectedAccountId(b.account_id);
    } else if (!(await showCard(b.account_id, b, () => turn === landTurn.current))) {
      return;
    }
    const filledEarly = shownAlready && railLandingNow.current?.batchId === b.id;
    if (filledEarly) {
      // Uploaded into its month as the boxes went on: let the ring settle, then the review.
      await new Promise((r) => setTimeout(r, reduceMotion ? 0 : PACE.settle));
      if (turn !== landTurn.current) return;
      setRailLanding(null);
    } else {
      if (found) setFoundId(b.id); else setLandingId(b.id);
      await new Promise((r) => setTimeout(r, found ? 2600 : reduceMotion ? 300 : 1900));
      if (turn !== landTurn.current) return;
    }
    setLandingId(null);
    setFoundId(null);
    if (!found && reopen && b.status === 'REVIEW') setModalBatchId(b.id);
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
    letGo();
    const base = { id: nextReadId(), source: 'drop', fileName: file.name, fileType: /\.csv$/i.test(file.name) ? 'CSV' : 'PDF', size: file.size, uploaded: false };
    setReading(base);
    let batch = null;
    try {
      batch = await api.imports.upload(file, 'local');
      // Uploaded: its card opens at once (D335, the owner's choice), the pages on the left and
      // the reading on the right, and the statement plays into its rows there. Its month fills
      // when it's approved or put away; the boxes come back only if the read stops.
      setReading(null);
      setParsingId(batch.id);
      setRevealId(batch.id);
      fresh.current = batch.id;
      fileRef.current.value = '';
      setFileName(null);
      await load();
      setModalBatchId(batch.id);
      const result = await api.imports.parse(batch.id);
      if (result.report) setReports((r) => ({ ...r, [batch.id]: result.report }));
      if (result.opened_with_saved_password) notify(`${file.name} · with a remembered password`, { name: 'statement.unlocked' });
      await load();
      // Its rows, and where each one sits on its pages, now that they're read.
      invalidate('imports');
      setUploading(null);
      setParsingId(null);
      notify(file.name, { name: 'statement.read' });
    } catch (err) {
      const existing = err.status === 409 ? err.body?.existing_batch : null;
      if (existing) {
        // Already on file (D325): Upload stops, holds, folds away by itself, and the earlier statement blinks.
        fileRef.current.value = '';
        setFileName(null);
        await playOut({ ...base, error: { message: err.message, stage: 'upload', existing } });
        setReading(null);
        setUploading(null);
        notify(`${file.name} · showing that one`, { name: 'statement.on_file' });
        await land(existing.id, { found: true });
        return;
      }
      await load();
      // The read stopped: its card closes, and the boxes stop where it stopped, with what to do
      // about it under them (D325, step 3): the password, Try again, or Read with Claude (asked,
      // never assumed: D182).
      setModalBatchId(null);
      fresh.current = null;
      const stopped = batch ? { ...base, batchId: batch.id, fileType: batch.file_type, uploaded: true } : base;
      setReading((r) => ({ ...(r ?? stopped), ...stopped, error: { message: err.message, stage: err.body?.stage ?? (batch ? 'read' : 'upload') } }));
      if (!batch) { fileRef.current.value = ''; setFileName(null); }
      notify(/password/i.test(err.message) ? `${file.name} · enter it under the boxes` : `${file.name}: ${err.message}`, {
        name: /password/i.test(err.message) ? 'error.locked' : 'error.read',
      });
    } finally {
      setUploading(null);
      setParsingId(null);
    }
  }

  /**
   * The popup's Unlock (D325): 'wrong' keeps it open for another try; 'ok' when the
   * password opened the file, even if the read then stops further on (the boxes say where).
   */
  async function tryPassword(batchId, password, remember = true) {
    setParsingId(batchId);
    try {
      const result = await api.imports.parse(batchId, password, undefined, remember);
      if (result.report) setReports((r) => ({ ...r, [batchId]: result.report }));
      unlocked.current = { batchId, result };
      return 'ok';
    } catch (err) {
      const stage = err.body?.stage ?? 'read';
      if (stage === 'open' && /password/i.test(err.message)) {
        await load();
        const r = readingNow.current;
        if (r?.source === 'drop' && r.batchId === batchId) setReading({ ...r, error: { message: err.message, stage } });
        return 'wrong';
      }
      unlocked.current = { batchId, error: { message: err.message, stage } };
      return 'ok';
    } finally {
      setParsingId(null);
    }
  }

  /** After "Unlocked": the boxes carry on from Open on the rail (same read), or play in the card. */
  async function afterUnlock() {
    const done = unlocked.current;
    unlocked.current = null;
    setUnlocking(null);
    if (!done) return;
    const r = readingNow.current;
    const fromRail = r?.source === 'drop' && r.batchId === done.batchId;
    const batch = batches.find((b) => b.id === done.batchId);
    const start = fromRail ? { ...r, error: null } : { id: nextReadId(), source: 'card', batchId: done.batchId, fileName: batch?.original_filename, fileType: 'PDF', uploaded: true };
    if (done.error) {
      await load();
      setReading({ ...start, error: done.error });
      return;
    }
    await playOut({ ...start, facts: done.result.facts ?? { rows: done.result.rows_parsed ?? 0 }, report: done.result.report });
    await load();
    setReading(null);
    setRevealId(done.batchId);
    setOpenBatchId(done.batchId);
    notify(`${start.fileName ?? 'The statement'} · read`, { name: 'statement.unlocked' });
    await land(done.batchId, { fromRail: start.source === 'drop' });
  }

  /** The one way a PDF reaches Claude: the person said yes to this file. */
  async function readWithClaude(batchId) {
    setError(null);
    setParsingId(batchId);
    const batch = batches.find((b) => b.id === batchId);
    // From the offer under the drop zone the boxes carry on there; from a card, in the card.
    const start = reading?.batchId === batchId && reading.source === 'drop'
      ? { ...reading, id: nextReadId(), error: null }
      : { id: nextReadId(), source: 'card', batchId, fileName: batch?.original_filename, fileType: 'PDF', uploaded: true };
    setReading(start);
    try {
      const result = await api.imports.parse(batchId, undefined, 'api');
      if (result.report) setReports((r) => ({ ...r, [batchId]: result.report }));
      await playOut({ ...start, facts: result.facts ?? { rows: result.rows_parsed ?? 0 }, report: result.report });
      await load();
      setReading(null);
      setRevealId(batchId);
      setOpenBatchId(batchId);
      await land(batchId, { fromRail: start.source === 'drop' });
    } catch (err) {
      setReading(start.source === 'drop' ? { ...start, error: { message: err.message, stage: err.body?.stage ?? 'read' } } : null);
      if (start.source !== 'drop') setError(err.message);
      await load();
      notify(err.message, { name: 'error.claude' });
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
      const proceed = await confirm({ title: 'Read it with Claude?', message: 'The statement goes to Claude. It costs a few cents, more for a long one.', confirm: 'Read with Claude' });
      if (!proceed) return;
    }
    setError(null);
    setParsingId(batchId);
    const batch = batches.find((b) => b.id === batchId);
    const fromRail = reading?.source === 'drop' && reading.batchId === batchId;
    const start = fromRail
      ? { ...reading, id: nextReadId(), error: null }
      : { id: nextReadId(), source: 'card', batchId, fileName: batch?.original_filename, fileType, uploaded: true };
    setReading(start);
    try {
      const result = await api.imports.parse(batchId, password);
      if (result.report) setReports((r) => ({ ...r, [batchId]: result.report }));
      await playOut({ ...start, facts: result.facts ?? { rows: result.rows_parsed ?? 0 }, report: result.report });
      await load();
      setReading(null);
      setRevealId(batchId);
      setOpenBatchId(batchId);
      await land(batchId, { fromRail: start.source === 'drop' });
    } catch (err) {
      // From the boxes, they stop again (a wrong password tints its field); from a card, the card explains.
      setReading(fromRail ? { ...start, error: { message: err.message, stage: err.body?.stage ?? 'read' } } : null);
      await load(); // pick up a FAILED status + error_message; the card shows it
      notify(err.message, { name: /password/i.test(err.message) ? 'error.still_locked' : 'error.read' });
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
      notify('Its rows went with it', { name: 'upload.deleted' });
      if (openBatchId === batchId) setOpenBatchId(null);
      // Deleting from a month's review closes it the way ✕ does: its card and year stay on
      // screen (D322), so the month can be seen turning Missing.
      if (modalBatchId === batchId) closeModal();
      await load();
      // The calendar's months come from the statement gaps, not this list: without this a deleted
      // month stayed green until a reload, instead of turning Missing (D325).
      invalidate('statement-gaps');
      onChange(); // transaction counts on accounts changed, same as approving
    } catch (err) {
      setError(err.message);
    }
  };

  // While the drop zone's boxes hold an upload (reading it, or stopped with its fix), they are its card;
  // it joins the list once they finish or are put away.
  const inRail = reading?.source === 'drop' ? reading.batchId : null;
  // The statement open in its card isn't also listed behind it.
  const needsAttention = batches.filter((b) => NEEDS_ATTENTION_STATUSES.has(b.status) && b.id !== inRail && b.id !== modalBatchId);

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
  // Nothing is picked until the owner picks a card or a statement is read (D322, undoing D313's first card).
  // A statement opened by ?open= shows its card until another is picked.
  const opened = modalBatchId === null ? null : walletBatches.find((b) => b.id === modalBatchId) ?? null;
  const pick = pickedAccountId ?? opened?.account_id ?? null;
  const selectedAccountId = pick !== null && visibleAccountIds.has(pick) ? pick : null;

  const selectedAccount = walletAccounts.find((a) => a.id === selectedAccountId) ?? null;
  const accountBatches = selectedAccountId === null ? [] : walletBatches.filter((b) => b.account_id === selectedAccountId);
  const uploadedMonthSet = new Set(accountBatches.filter((b) => b.period_end).map((b) => b.period_end.slice(0, 7)));
  const cardMonths = useCardMonths(selectedAccountId);
  const batchByMonth = new Map(accountBatches.filter((b) => b.period_end).map((b) => [b.period_end.slice(0, 7), b]));
  // Statements that don't add up to the cent glow on the calendar (D274), for the owner to check.
  const glow = tallyGlow(accountBatches, { byFifteenth: Boolean(cardMonths), money: (c) => formatMoney(c) });
  // A month whose statement was printed on an earlier card says which (D275).
  const tileNotes = new Map();
  for (const b of accountBatches) {
    const card = printedOn(b, selectedAccount);
    if (card) for (const key of statementMonths(b, Boolean(cardMonths))) tileNotes.set(key, `printed on ${card}`);
  }
  const unsettled = (list) => list.filter((b) => tallyNote(b.ledger_tally, formatMoney));
  const offHere = unsettled(accountBatches);
  const offCount = offHere.filter((b) => b.ledger_tally.state === 'off').length;
  const uncheckedCount = offHere.length - offCount;
  const offElsewhere = walletAccounts
    .filter((a) => a.id !== selectedAccountId && visibleAccountIds.has(a.id))
    .map((a) => ({ account: a, count: unsettled(walletBatches.filter((b) => b.account_id === a.id)).length }))
    .filter((x) => x.count > 0);

  const yearOptions = new Set([new Date().getFullYear()]);
  for (const key of [...uploadedMonthSet, ...Object.keys(cardMonths ?? {})]) yearOptions.add(Number(key.slice(0, 4)));
  const sortedYears = [...yearOptions].sort((a, b) => b - a);
  // The year being looked at belongs to the card: another card starts on its latest year.
  const shownYear = yearPick.accountId === selectedAccountId ? yearPick.year : opened?.account_id === selectedAccountId ? Number(opened?.period_end?.slice(0, 4)) : null;
  const yearIdx = Math.max(0, sortedYears.indexOf(shownYear));
  const setYearIdx = (fn) => setYearPick({ accountId: selectedAccountId, year: sortedYears[fn(yearIdx)] });
  const clampedYearIdx = Math.min(yearIdx, sortedYears.length - 1);
  const year = sortedYears[clampedYearIdx];

  // A statement still waiting for its card opens the same way (D335): it isn't in the wallet yet.
  const modalBatch = opened ?? (modalBatchId === null ? null
    : batches.find((b) => b.id === modalBatchId && ['UPLOADED', 'PARSING', 'NEEDS_ACCOUNT', 'REVIEW', 'APPROVED'].includes(b.status)) ?? null);
  const landingBatch = landingId === null ? null : accountBatches.find((b) => b.id === landingId);
  const pendingKeys = new Set(accountBatches.filter((b) => b.status === 'REVIEW').flatMap((b) => statementMonths(b, Boolean(cardMonths))));
  const landingKeys = landingBatch ? new Set(statementMonths(landingBatch, Boolean(cardMonths))) : null;
  const foundBatch = foundId === null ? null : accountBatches.find((b) => b.id === foundId);
  const foundKeys = foundBatch ? new Set(statementMonths(foundBatch, Boolean(cardMonths))) : null;
  // Closing the statement keeps its card and year on screen.
  const closeModal = () => {
    // A statement just uploaded goes to its month as its card closes, the way an approved one does.
    const id = modalBatchId;
    if (id !== null && fresh.current === id) {
      fresh.current = null;
      setModalBatchId(null);
      setTimeout(() => land(id, { reopen: false }), reduceMotion ? 0 : 360);
      return;
    }
    if (selectedAccountId !== null) {
      setSelectedAccountId(selectedAccountId);
      setYearPick({ accountId: selectedAccountId, year });
    }
    setModalBatchId(null);
  };

  // What to do where the read stopped (D325 step 3), under the boxes instead of on the card below.
  const askClaude = async (batchId, fileName) => {
    if (await confirm({ title: 'Read it with Claude?', message: `${fileName}'s transaction pages go to Anthropic. It costs a few cents.`, confirm: 'Read with Claude' })) {
      readWithClaude(batchId);
    }
  };
  const railStop = useRef(null);
  const openRailUnlock = () => setUnlocking({ batchId: reading.batchId, fileName: reading.fileName, anchorRef: railStop });
  const railFix = (() => {
    if (!reading?.error || reading.error.existing) return null;
    const { stage, message } = reading.error;
    // The upload itself was refused (too big, not a PDF): nothing on file to try again.
    if (!reading.batchId) return <FailedStrip compact message={message} />;
    const stopped = batches.find((b) => b.id === reading.batchId);
    const method = stopped?.parse_method ?? 'local';
    const busy = parsingId !== null;
    const retry = () => parse(reading.batchId, reading.fileType, method);
    if (stage === 'open' && /password/i.test(message)) {
      return <LockedRow wrong={/didn.t open/i.test(message)} onOpen={openRailUnlock} />;
    }
    const free = reading.fileType === 'PDF' && method === 'local';
    // A bank the free reader doesn't know: the offer itself is the ask, so no second confirm.
    if (stage === 'find' && free) {
      return <ClaudeOffer compact offer={{ fileName: reading.fileName }} busy={busy} onAccept={() => readWithClaude(reading.batchId)} onDismiss={() => setReading(null)} />;
    }
    return <FailedStrip compact message={message} busy={busy} onRetry={() => retry()} onClaude={free ? () => askClaude(reading.batchId, reading.fileName) : null} />;
  })();

  // A guessed card's question, hung from its Find the card box (D325). Only for a suggestion the
  // app can name; a card it can't match (none, or two sharing the last 4) is picked on the statement.
  const guessed = reading?.facts?.card_known === 'suggested' ? accounts.find((a) => a.id === reading.facts.account_id) : null;
  const askCard = guessed ? () => setConfirming({ batchId: reading.batchId, account: guessed, holder: reading.facts.card?.holder ?? null }) : undefined;
  const answered = (batchId, patch) => setReading((r) => (r && r.batchId === batchId ? { ...r, answered: true, ...patch(r) } : r));

  const readingAccount = reading?.facts?.account_id != null ? accounts.find((a) => a.id === reading.facts.account_id) : null;
  const rail = reading && (
    <ReadingStages
      key={reading.id}
      reading={reading}
      label={reading.facts?.card && reading.facts.period?.end
        ? statementLabel({ account_id: reading.facts.account_id ?? 0, account_issuer: reading.facts.card.issuer, account_name: reading.facts.card.name, account_mask: reading.facts.card.mask, period_end: reading.facts.period.end })
        : null}
      accountName={readingAccount && `${readingAccount.name}${readingAccount.mask ? ` ···${readingAccount.mask}` : ''}`}
      still={Boolean(reduceMotion)}
      onSettled={() => settle.current?.()}
      onClose={() => { letGo(); setReading(null); }}
      fix={railFix}
      stopRef={railStop}
      onAsk={askCard}
      onProgress={(done) => setRailLanding((l) => {
        if (!l || l.batchId !== reading.batchId) return l;
        const fill = Math.max(l.fill, landingFill(done));
        return fill === l.fill ? l : { ...l, fill };
      })}
      onStopClick={reading.error && /password/i.test(reading.error.message) && reading.error.stage === 'open' ? openRailUnlock : undefined}
    />
  );

  const renderCard = (batch, { onCloseModal, onFocusRow, onReadProgress, pageBeside, aside, onAccountConfirmed: confirmed, onFinished, printed, onFocusFigure, litFigure } = {}) => (
    <BatchCard
      aside={aside}
      printed={printed}
      onFocusFigure={onFocusFigure}
      litFigure={litFigure}
      onFinished={onFinished}
      onFocusRow={onFocusRow}
      onReadProgress={onReadProgress}
      pageBeside={pageBeside}
      key={batch.id}
      still={still}
      batch={batch}
      label={statementLabel(batch)}
      isOpen={false}
      // Review opens the statement in its own view, pages beside it, like a month does (D335).
      onToggleOpen={() => { setRevealId(null); setModalBatchId(batch.id); }}
      reveal={revealId === batch.id}
      rail={reading?.source === 'card' && reading.batchId === batch.id && !onCloseModal ? rail : null}
      glow={foundId === batch.id && !onCloseModal}
      onUnlock={(anchorRef) => setUnlocking({ batchId: batch.id, fileName: batch.original_filename, anchorRef })}
      pickOther={declined.has(batch.id)}
      onCloseModal={onCloseModal}
      parsingId={parsingId}
      onParse={(password) => parse(batch.id, batch.file_type, batch.parse_method, password)}
      onReadWithClaude={async () => {
        if (await confirm({ title: 'Read it with Claude?', message: `${batch.original_filename}'s transaction pages go to Anthropic. It costs a few cents.`, confirm: 'Read with Claude' })) {
          readWithClaude(batch.id);
        }
      }}
      onDelete={handleDelete}
      report={reports[batch.id]}
      categories={categories}
      accounts={accounts}
      people={people}
      onApproved={handleApproved}
      onAccountConfirmed={confirmed ?? land}
    />
  );

  return (
    <section className="apple-pane mb-12">
      <header className="mb-6">
        <PageTitle className="text-2xl font-medium tracking-tight text-ink" emoji="📥" tint="bg-vivid-amber/20">Statements</PageTitle>
        <p className="mt-1 text-sm text-muted">Drop a statement to read it free, then pick a card to see its months.</p>
      </header>

      <div className="mb-6">
        <DropZone
          fileRef={fileRef}
          fileName={fileName}
          onFileChosen={setFileName}
          onUpload={upload}
          uploading={uploading !== null}
          rail={reading?.source === 'drop' ? rail : null}
        />
      </div>
      {error && <ErrorBanner message={error} onDismiss={() => { setError(null); list.reload(); }} />}

      {list.data === undefined && !list.error && <ListSkeleton rows={5} className="max-w-6xl" />}
      <div className={`max-w-6xl ${needsAttention.length > 0 ? 'mb-2' : ''}`}>
        <AnimatePresence initial={false}>
          {needsAttention.map((b) => (
            <motion.div key={b.id} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.42, ease: [0.2, 0.8, 0.2, 1] }} className="overflow-hidden pb-4">
              {renderCard(b)}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

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
                liftId={selectedAccountId === liftedId ? liftedId : null}
              />
            </div>
          </div>

          {/* Right half: the statement calendar. It stays in view while the
              cards scroll (split-detail, D385; the owner's ask, D390), so a
              card picked far down the deck shows its months beside it. */}
          <div className="split-detail flex flex-col items-center text-center lg:w-1/2 lg:self-start lg:pt-2">
            <div className="mb-4 text-sm">
              {selectedAccount ? (
                <span className="text-ink">
                  {selectedAccount.name}
                  {selectedAccount.mask && <span className="ml-1.5 font-mono text-muted tnum">···{selectedAccount.mask}</span>}
                  {(earlierProducts(selectedAccount) || earlierCards(selectedAccount)) && (
                    <span className="mt-0.5 block text-xs text-muted">
                      {[earlierProducts(selectedAccount), earlierCards(selectedAccount)].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </span>
              ) : (
                <span className="text-muted">Pick a card to see its statements</span>
              )}
            </div>
            <div id="statement-months" />
            <MonthStatusGrid
              landing={railLanding?.keys ?? landingKeys}
              landingFill={railLanding ? railLanding.fill : null}
              found={foundKeys}
              pending={pendingKeys}
              still={Boolean(reduceMotion)}
              year={year}
              uploadedMonths={uploadedMonthSet}
              states={cardMonths}
              openedOn={selectedAccount?.member_since ?? null}
              glow={glow}
              notes={tileNotes}
              canGoPrevYear={clampedYearIdx < sortedYears.length - 1}
              canGoNextYear={clampedYearIdx > 0}
              onPrevYear={() => setYearIdx((i) => Math.min(i + 1, sortedYears.length - 1))}
              onNextYear={() => setYearIdx((i) => Math.max(i - 1, 0))}
              clickableStates={['uploaded']}
              disabled={selectedAccount === null}
              onTileClick={(state, key) => {
                // A card's month is the statement holding its 15th (D269); otherwise the month it closed in.
                const mid = `${key}-15`;
                const holding = cardMonths && accountBatches.find((b) => b.period_start && b.period_end && b.period_start.slice(0, 10) <= mid && mid <= b.period_end.slice(0, 10));
                if (state === 'uploaded' || pendingKeys.has(key)) setModalBatchId((holding ?? batchByMonth.get(key))?.id ?? null);
              }}
            />
            {(offHere.length > 0 || offElsewhere.length > 0) && (
              <div className="mt-4 max-w-sm space-y-1 text-xs text-muted">
                {offHere.length > 0 && (
                  <p>
                    {offCount > 0 && <><span className="text-ink tnum">{offCount}</span> {offCount === 1 ? "statement doesn't" : "statements don't"} add up to the cent</>}
                    {offCount > 0 && uncheckedCount > 0 && ' · '}
                    {uncheckedCount > 0 && <><span className="text-ink tnum">{uncheckedCount}</span> can't be checked</>}
                    . They glow; hover one for why.
                  </p>
                )}
                {offElsewhere.length > 0 && (
                  <p>
                    {offHere.length > 0 ? 'Also to check: ' : 'Statements to check: '}
                    {offElsewhere.map(({ account, count }, i) => (
                      <span key={account.id}>
                        {i > 0 && ', '}
                        <button type="button" className="text-ink underline decoration-rule-str underline-offset-2 hover:decoration-ink" onClick={() => setSelectedAccountId(account.id)}>
                          {account.name}{account.mask ? ` ···${account.mask}` : ''}
                        </button>{' '}
                        <span className="tnum">({count})</span>
                      </span>
                    ))}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {confirming && (
        <ConfirmCardPopover
          key={confirming.batchId}
          anchorRef={railStop}
          account={confirming.account}
          holder={confirming.holder}
          onYes={async () => {
            try {
              await api.imports.confirmAccount(confirming.batchId, { account_id: confirming.account.id });
              return 'ok';
            } catch (err) {
              return err.message;
            }
          }}
          // Attached: the box ticks and the boxes play on, then the statement lands on its card's month.
          onDone={async () => {
            const { batchId: id, account } = confirming;
            setConfirming(null);
            notify(`On ${account.name}`, { name: 'statement.account' });
            // Find the card ticks, and the boxes hold on it while the deck shows the card (D325).
            const findAt = 2;
            answered(id, (r) => ({ holdAt: findAt, facts: { ...r.facts, card_known: 'confirmed' } }));
            const period = readingNow.current?.facts?.period;
            const span = period && { period_start: period.start, period_end: period.end };
            await wait(PACE.tick + PACE.link);
            await showCard(account.id, span);
            cardShown.current = account.id;
            // Its month starts the upload now, a little fill and the arrow rising; it fills as the boxes go on.
            const keys = span ? new Set(statementMonths(span, cardMonthAccounts.has(account.id))) : null;
            if (keys?.size) {
              setRailLanding({ batchId: id, keys, fill: landingFill(findAt + 1) });
              await wait(PACE.step / 2);
            }
            // Then on to Read rows.
            setReading((r) => (r && r.batchId === id ? { ...r, holdAt: null } : r));
          }}
          // Not this card: the boxes play on, and the statement then asks which account it is.
          onNo={() => { const id = confirming.batchId; setConfirming(null); setDeclined((d) => new Set(d).add(id)); answered(id, () => ({})); }}
          // Later: the boxes play on and the statement keeps its question.
          onClose={() => { const id = confirming.batchId; setConfirming(null); answered(id, () => ({})); }}
        />
      )}

      {unlocking && (
        <UnlockPopover
          key={unlocking.batchId}
          anchorRef={unlocking.anchorRef}
          fileName={unlocking.fileName}
          onUnlock={(password, remember) => tryPassword(unlocking.batchId, password, remember)}
          onDone={afterUnlock}
          onClose={() => setUnlocking(null)}
        />
      )}

      {/* The statement's review fades in once its month has landed, rather than popping (D325). */}
      <AnimatePresence>
        {modalBatch && (
          <motion.div key={modalBatch.id} className="modal-scrim fixed inset-0 z-20 flex items-center justify-center bg-ink/30 px-4 pt-6 pb-[5.5rem] md:px-8" onClick={closeModal}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: reduceMotion ? 0 : 0.3 } }} transition={{ duration: reduceMotion ? 0 : 0.28 }}>
            <motion.div className="flex w-full justify-center" onClick={(e) => e.stopPropagation()}
              initial={reduceMotion ? false : { opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
              // Out the way it came in (D335): the same path and spring, so opening and closing read as one motion.
              exit={reduceMotion ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: 10, scale: 0.98, transition: { type: 'spring', stiffness: 320, damping: 32 } }}
              transition={{ type: 'spring', stiffness: 320, damping: 30 }}>
              <StatementSplit batch={modalBatch} renderCard={(extra) => renderCard(modalBatch, {
                onCloseModal: closeModal,
                // In its card the statement stays open once its account is confirmed, and plays on.
                onAccountConfirmed: async () => { await load(); invalidate('statement-gaps'); },
                // Approved, nothing left: it closes the way it opened, then its month fills.
                onFinished: () => { const id = modalBatch.id; fresh.current = null; setModalBatchId(null); setTimeout(() => land(id, { reopen: false }), reduceMotion ? 0 : 360); },
                ...extra,
              })} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
