import { useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { PRIMARY, QUIET } from './batch-buttons';

/**
 * The pieces of an upload's card on Import (D323), in the Apple style the
 * rest of the app uses: a glyph tile that says what state it's in, a
 * capsule for the status, a strip under the header for the one thing to do
 * (the password, Try again, Read with Claude), a quiet line for how it was
 * read, and one banner for an error that no card already explains.
 */

const STATUS_LABELS = {
  UPLOADED: 'Not read yet',
  PARSING: 'Reading',
  NEEDS_ACCOUNT: 'Pick its card',
  REVIEW: 'To review',
  APPROVED: 'Saved',
  FAILED: "Couldn't read",
};

const PILL = {
  NEEDS_ACCOUNT: 'bg-warn/12 text-warn',
  REVIEW: 'bg-warn/12 text-warn',
  APPROVED: 'bg-earn/12 text-earn',
  FAILED: 'bg-spend/10 text-spend',
  PARSING: 'bg-info/10 text-info',
};

// A glyph per status, for the capsule in a statement's own view (D335): saved ticks, to-review waits.
const PILL_GLYPH = {
  APPROVED: <path d="m4.5 10.5 3.5 3.5 7.5-8" />,
  REVIEW: <><circle cx="10" cy="10" r="6.5" /><path d="M10 6.8V10l2.2 1.5" /></>,
  NEEDS_ACCOUNT: <><rect x="3.5" y="5.5" width="13" height="9" rx="1.8" /><path d="M3.5 8.5h13" /></>,
  PARSING: <path d="M10 3.5a6.5 6.5 0 1 1-6.5 6.5" />,
  FAILED: <path d="M10 6v4.5M10 13.5v.01" />,
};

/** The status as a small tinted capsule; a locked PDF says so instead of "failed". `glyph` adds its icon. */
export function StatusPill({ status, locked, glyph = false }) {
  const text = locked ? 'Locked' : STATUS_LABELS[status] ?? status;
  const tone = locked ? 'bg-warn/12 text-warn' : PILL[status] ?? 'bg-band text-muted';
  const icon = locked ? LOCK : PILL_GLYPH[status];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full text-[12px] font-semibold ${glyph ? 'py-1 pr-3 pl-2' : 'px-2.5 py-0.5'} ${tone}`}>
      {glyph && icon && (
        <span className={status === 'PARSING' && !locked ? 'inline-flex animate-spin' : 'inline-flex'}><Icon size={14}>{icon}</Icon></span>
      )}
      {text}
    </span>
  );
}

const Icon = ({ children, size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
const LOCK = <><rect x="4.5" y="9" width="11" height="8" rx="2" /><path d="M7 9V6.5a3 3 0 0 1 6 0V9" /></>;
const ALERT = <><path d="M10 3.5 17.5 16.5h-15z" /><path d="M10 8.5v3.5M10 14.3v.01" /></>;
const DOC = <><path d="M5.5 2.5h6l3.5 3.5v11.5h-9.5z" /><path d="M11.5 2.5V6H15M8 10h5M8 13h5" /></>;
const CHECK = <path d="m5 10.5 3.2 3.2L15 6.8" />;

/** The leading tile: a lock, a warning, a spinner while reading, or the document. */
export function BatchGlyph({ status, locked, reading, still }) {
  const tone = locked ? 'bg-warn/12 text-warn' : status === 'FAILED' ? 'bg-spend/10 text-spend' : status === 'APPROVED' ? 'bg-earn/12 text-earn' : 'bg-info/10 text-info';
  return (
    <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${tone}`}>
      {reading ? (
        <motion.span className="block size-4 rounded-full border-2 border-current border-t-transparent"
          animate={still ? undefined : { rotate: 360 }} transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }} aria-label="Reading" />
      ) : <Icon>{locked ? LOCK : status === 'FAILED' ? ALERT : status === 'APPROVED' ? CHECK : DOC}</Icon>}
    </span>
  );
}

// Under the reading boxes: one tinted row, the reason on the left and what to do on the right.
const RAIL_ROW = 'mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-band/60 px-3 py-2';

/**
 * A locked PDF under the reading boxes: one line, and the password itself in
 * a small popup on the Open box (UnlockPopover), which opens as the boxes stop.
 */
export function LockedRow({ wrong, onOpen }) {
  const open = useRef(onOpen);
  useEffect(() => { open.current = onOpen; });
  useEffect(() => { open.current(); }, []);
  return (
    <div className={RAIL_ROW}>
      <p className="min-w-0 flex-1 text-[13px] text-ink">{wrong ? "That password didn't open it" : 'This PDF has a password'}
        <span className="text-muted"> · it opens this file once and isn’t saved</span></p>
      <button type="button" onClick={onOpen} className={PRIMARY}>Unlock…</button>
    </div>
  );
}

/** Any other failure: what went wrong in plain words, then Try again, and Claude only when asked. */
export function FailedStrip({ message, busy, onRetry, onClaude, compact = false }) {
  return (
    <div className={compact ? RAIL_ROW : 'flex flex-wrap items-center gap-3 border-t border-rule px-4 py-4 sm:px-5'}>
      <p className={`min-w-0 flex-1 text-[13px] ${compact ? 'text-ink' : 'text-muted'}`}>{message || "This statement couldn't be read."}</p>
      {onRetry && <button type="button" disabled={busy} onClick={onRetry} className={QUIET}>Try again</button>}
      {onClaude && <button type="button" disabled={busy} onClick={onClaude} className={QUIET}>Read with Claude…</button>}
    </div>
  );
}

/** How it was read, one quiet line: free on this machine or what Claude cost, and whether the totals matched. */
export function ReadReport({ report }) {
  if (!report) return null;
  const matched = report.reconciliation && Object.values(report.reconciliation).every((v) => v !== false);
  const local = report.parse_method === 'local';
  // Read free with every total matching: the header says how it was read and the rows' check says it adds up (D335).
  if (local && matched) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 border-t border-rule px-4 py-2.5 text-[13px] text-muted sm:px-5">
      <span className={local && !matched ? 'text-warn' : 'text-info'}><Icon size={14}>{local && !matched ? ALERT : CHECK}</Icon></span>
      {local
        ? <>Read on this computer, free · {matched ? 'every printed total matches' : <span className="text-warn">a printed total didn't match; check it in Review</span>}</>
        : <span className="tnum">Read by Claude · {report.pages_sent.length} of {report.pages_total} pages sent · about ${report.estimated_cost_usd.toFixed(2)}</span>}
    </p>
  );
}

/** An error no card already explains, once, with a way to dismiss it. */
export function ErrorBanner({ message, onDismiss }) {
  return (
    <motion.div role="alert" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
      className="mb-6 flex items-start gap-3 rounded-2xl bg-spend/8 px-4 py-3">
      <span className="mt-0.5 text-spend"><Icon size={16}>{ALERT}</Icon></span>
      <p className="min-w-0 flex-1 text-[13px] text-ink">{message}</p>
      <button type="button" onClick={onDismiss} aria-label="Dismiss" className="text-muted hover:text-ink">
        <Icon size={14}><path d="M5 5l10 10M15 5 5 15" /></Icon>
      </button>
    </motion.div>
  );
}

/** Asked, never assumed (D182): a PDF the free reader couldn't read goes to Claude only from here. */
export function ClaudeOffer({ offer, onAccept, onDismiss, busy, compact = false }) {
  if (compact) {
    return (
      <div role="alert" className={RAIL_ROW}>
        <p className="min-w-0 flex-1 text-[13px] text-ink">Not a bank the free reader knows yet
          <span className="text-muted"> · Claude can read it: its transaction pages go to Anthropic, a few cents. Only if you say so.</span></p>
        <div className="flex shrink-0 gap-2">
          <button type="button" onClick={onDismiss} disabled={busy} className={QUIET}>Not now</button>
          <button type="button" onClick={onAccept} disabled={busy} className={PRIMARY}>{busy ? 'Reading…' : 'Read with Claude'}</button>
        </div>
      </div>
    );
  }
  return (
    <motion.div role="alert" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
      className="mt-3 flex flex-wrap items-center gap-4 rounded-[20px] border border-rule bg-raised p-4 sm:p-5">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-warn/12 text-warn"><Icon>{ALERT}</Icon></span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] text-ink" title={offer.fileName}>Couldn't read {offer.fileName} for free</p>
        <p className="text-[13px] text-muted">Claude can read it: its transaction pages go to Anthropic and it costs a few cents. Only if you say so.</p>
      </div>
      <div className="flex shrink-0 gap-2">
        <button type="button" onClick={onDismiss} disabled={busy} className={QUIET}>Not now</button>
        <button type="button" onClick={onAccept} disabled={busy} className={PRIMARY}>{busy ? 'Reading…' : 'Read with Claude'}</button>
      </div>
    </motion.div>
  );
}
