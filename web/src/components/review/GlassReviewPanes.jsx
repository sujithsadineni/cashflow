import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { api, formatMoney, formatShortDate } from '../../api';
import { invalidate } from '../../use-api';
import { useNotify } from '../../use-notify';
import { statementHintText } from '../../review-groups';
import { uploadsNeeded, monthLabel } from '../../uploads-needed';
import { ACTIVITY_GLYPHS } from '../../glass-activity-glyphs';
import { MerchantReview } from '../MerchantReview';
import { GroupSection, Group, Row, Tile, Chevron } from '../settings/glass-ui';

/**
 * Glass Review's other three panes (D249 step 3). Payments became one
 * to-do: which statements to upload, per account, with the months each is
 * missing and what uploading it clears. That's what all 37 explanations
 * were saying, one at a time.
 */

const KIND = {
  card: { icon: 'card', color: '#FF9500' },
  bank: { icon: 'business', color: '#007AFF' },
  unknown: { icon: 'ellipse', color: '#8E8E93' },
};

function KindTile({ kind, size = 32 }) {
  const k = KIND[kind] ?? KIND.unknown;
  return (
    <Tile color={k.color} size={size}>
      <svg width={Math.round(size * 0.58)} height={Math.round(size * 0.58)} viewBox="0 0 512 512">{ACTIVITY_GLYPHS[k.icon]}</svg>
    </Tile>
  );
}

function Months({ months, max = 4 }) {
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {months.slice(0, max).map((m) => (
        <span key={m} className="rounded-full bg-band px-2 py-px text-[12px] text-ink tnum">{monthLabel(m)}</span>
      ))}
      {months.length > max && <span className="px-1 text-[12px] text-muted">+{months.length - max} more</span>}
    </span>
  );
}

function UploadRow({ g }) {
  const [open, setOpen] = useState(false);
  const reduceMotion = useReducedMotion();
  const clears = g.payments + g.bills;
  return (
    <li className="gs-row">
      <div className="flex items-center gap-3 px-4 py-3">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <KindTile kind={g.kind} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] text-ink">
              {g.name}{g.mask && <span className="text-muted tnum"> ··{g.mask}</span>}
            </span>
            <Months months={g.months} />
          </span>
          <span className="shrink-0 text-right">
            <span className="block text-[15px] text-ink tnum">{clears || g.waiting}</span>
            <span className="block text-[12px] text-muted">{clears ? 'to clear' : 'waiting'}</span>
          </span>
          <Chevron open={open} />
        </button>
        <Link to="/import" className="btn btn-primary shrink-0 rounded-full px-3.5 py-1.5 text-[13px]">Upload</Link>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={reduceMotion ? { duration: 0 } : { type: 'spring', bounce: 0, duration: 0.35 }}
            className="overflow-hidden"
          >
            <ul className="mr-4 mb-3 ml-[60px] overflow-hidden rounded-[10px] bg-band" style={{ '--gs-inset': '12px' }}>
              {g.items.map((it, i) => (
                <li key={i} className="gs-row flex items-baseline justify-between gap-3 px-3 py-2 text-[13px]">
                  <span className="min-w-0 truncate text-ink">
                    {it.kind === 'bill'
                      ? <>Card bill paid in {monthLabel(it.month)}{it.count > 1 && <span className="text-muted"> · {it.count} payments</span>}</>
                      : <>{it.account}{it.mask && <span className="text-muted tnum"> ··{it.mask}</span>} paid on <span className="tnum">{formatShortDate(it.date)}</span>{it.kind === 'waiting' && <span className="text-muted"> · named, waiting</span>}</>}
                  </span>
                  <span className={`shrink-0 tnum ${it.cents < 0 ? 'text-spend' : 'text-earn'}`}>{formatMoney(it.cents, { showSign: true })}</span>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

export function GlassPaymentsPane({ data }) {
  const groups = uploadsNeeded(data.payments ?? [], data.card_bills ?? []);
  const todo = groups.filter((g) => g.payments + g.bills > 0);
  const waiting = groups.filter((g) => g.payments + g.bills === 0);
  const clears = todo.reduce((n, g) => n + g.payments + g.bills, 0);

  if (groups.length === 0) {
    return (
      <Group as="div" className="flex flex-col items-center gap-3 px-6 py-14 text-center">
        <KindTile kind="card" size={56} />
        <p className="text-[20px] font-semibold text-ink">Every payment is traced</p>
        <p className="max-w-sm text-[14px] text-muted">Each card payment matches the bank that paid it, and every card bill reaches its card.</p>
      </Group>
    );
  }

  return (
    <div className="space-y-8">
      {todo.length > 0 && (
        <GroupSection
          label={`Statements to upload · ${todo.length}`}
          footnote="A card payment with no bank behind it, or a bank bill with no card to land on, is a statement that isn't in the app yet. Upload it and the match is checked again on its own."
        >
          <Group as="div" className="mb-3 px-4 py-3.5">
            <p className="text-[15px] text-ink">
              <span className="font-semibold tnum">{todo.length}</span> statements would clear <span className="font-semibold tnum">{clears}</span> payments and bills.
            </p>
          </Group>
          <Group inset={60}>{todo.map((g) => <UploadRow key={g.key} g={g} />)}</Group>
        </GroupSection>
      )}
      {waiting.length > 0 && (
        <GroupSection
          label={`Confirming on their own · ${waiting.reduce((n, g) => n + g.waiting, 0)}`}
          footnote="The card statement already names the bank that paid these. They confirm once that bank's statement for the month is uploaded."
        >
          <Group inset={60}>{waiting.map((g) => <UploadRow key={g.key} g={g} />)}</Group>
        </GroupSection>
      )}
    </div>
  );
}

const TONE = { spend: 'text-spend', earn: 'text-earn', muted: 'text-muted' };

export function GlassStatementsPane({ data, reload }) {
  const notify = useNotify();
  const [busy, setBusy] = useState(false);
  const [showSmall, setShowSmall] = useState(false);
  const all = data.statements ?? [];
  const big = all.filter((s) => s.hint?.kind !== 'small').sort((a, b) => Math.abs(b.tally.diff_cents) - Math.abs(a.tally.diff_cents));
  const small = all.filter((s) => s.hint?.kind === 'small');

  const flip = async (s) => {
    setBusy(true);
    try {
      await api.transactionReview.approve(s.hint.review_id);
      invalidate('transactions');
      await reload();
      notify(`${s.account_name}: sign flipped, statement re-checked.`, { type: 'success' });
    } catch (err) {
      notify(err.message, { type: 'error', title: "Couldn't fix" });
    } finally {
      setBusy(false);
    }
  };

  if (all.length === 0) {
    return (
      <Group as="div" className="flex flex-col items-center gap-3 px-6 py-14 text-center">
        <Tile color="#007AFF" size={56}><svg width="32" height="32" viewBox="0 0 512 512">{ACTIVITY_GLYPHS['document-text']}</svg></Tile>
        <p className="text-[20px] font-semibold text-ink">Every statement adds up</p>
        <p className="max-w-sm text-[14px] text-muted">Each statement's rows add up to the change between its printed opening and closing balance.</p>
      </Group>
    );
  }

  const row = (s) => {
    const hint = statementHintText(s.hint);
    return (
      <Row
        key={s.batch_id}
        wrap
        leading={<Tile color="#007AFF" size={32}><svg width="18" height="18" viewBox="0 0 512 512">{ACTIVITY_GLYPHS['document-text']}</svg></Tile>}
        title={s.account_name}
        subtitle={<>
          Ending <span className="tnum">{formatShortDate(s.period_end)}</span> · <span className="tnum">{s.row_count}</span> rows
          <span className={`mt-1 block ${TONE[hint.tone] ?? ''}`}>{hint.title}</span>
        </>}
        trailing={<>
          <span className="text-right">
            <span className="block text-[15px] text-ink tnum">{formatMoney(Math.abs(s.tally.diff_cents))}</span>
            <span className="block text-[12px] text-muted">off</span>
          </span>
          {hint.action === 'approve' && (
            <button type="button" disabled={busy} onClick={() => flip(s)} className="btn btn-primary rounded-full px-3.5 py-1.5 text-[13px]">Flip the sign</button>
          )}
        </>}
      />
    );
  };

  return (
    <div className="space-y-8">
      {big.length > 0 && (
        <GroupSection label={`Don't add up · ${big.length}`} footnote="Each statement's rows should add up to the change between its opening and closing balance. The likeliest cause is under each one.">
          <Group inset={60}>{big.map(row)}</Group>
        </GroupSection>
      )}
      {small.length > 0 && (
        <GroupSection
          label={`Small gaps under $10 · ${small.length}`}
          action={<button type="button" onClick={() => setShowSmall((v) => !v)} className="text-[13px] font-medium text-info">{showSmall ? 'Hide' : 'Show'}</button>}
        >
          {showSmall && <Group inset={60}>{small.map(row)}</Group>}
        </GroupSection>
      )}
    </div>
  );
}

export function GlassMerchantsPane({ onResolved }) {
  return (
    <GroupSection footnote="Statement lines the app couldn't name with confidence. Approving a name teaches every later import.">
      <Group as="div" className="px-4 py-3">
        <MerchantReview embedded onResolved={onResolved} />
      </Group>
    </GroupSection>
  );
}
