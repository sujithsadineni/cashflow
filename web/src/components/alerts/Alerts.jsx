import { PageTitle } from '../ui/Form';
import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { api } from '../../api';
import { useApi, invalidate } from '../../hooks/use-api';
import { useDesign } from '../../hooks/use-design';
import { useNotify } from '../../hooks/use-notify';
import { needsYou, tiles, clearedByMonth } from '../../lib/alerts/alert-feed';
import { todayISO } from '../../lib/app/dates';
import { GroupSection, Group } from '../settings/glass-ui';
import { Tiles, AlertCard } from './AlertParts';

/**
 * Alerts as a Today dashboard (D318; the calendar moved to Recurring, D321), chosen by the owner over a timeline
 * and Wallet cards. One page for every design:
 *   - four tiles: what to pay, upload, chase and match; a tile shows only its cards
 *   - the alerts as cards: art, the amount large, a ring of days, the one
 *     action, and "…" to snooze, dismiss or mark a card bill paid (each with
 *     Undo); a late statement takes its PDF dropped on the card
 *   - what was cleared this year, folded
 * The logic is lib/alerts/alert-feed.js; the parts are AlertParts.jsx.
 */

const longToday = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const ANSWERED = { snooze: 'alert.snoozed', paid: 'alert.paid', dismiss: 'alert.dismissed' };

export function Alerts() {
  const { design } = useDesign();
  const reduceMotion = useReducedMotion();
  const still = design === 'classic' || Boolean(reduceMotion);
  const notify = useNotify();
  const today = todayISO();
  const [filter, setFilter] = useState(null);
  const [busyKey, setBusyKey] = useState(null);
  const [showCleared, setShowCleared] = useState(false);

  const live = useApi('alerts:live', () => api.alerts(), { tags: ['transactions', 'loans', 'alerts'] });
  const accounts = useApi('accounts:active', () => api.accounts.list(), { tags: ['transactions'] });
  const history = useApi(`alerts:history:${today.slice(0, 4)}`, () => api.alertHistory({ year: today.slice(0, 4), ytd: true }), { tags: ['transactions', 'alerts'] });

  const byId = new Map((accounts.data ?? []).map((a) => [a.id, a]));
  const items = needsYou(live.data, today);
  const totals = tiles(items);
  const shown = filter ? items.filter((i) => i.tile === filter) : items;

  const cleared = clearedByMonth(history.data?.cleared ?? []);
  const clearedCount = cleared.reduce((n, m) => n + m.items.length, 0);

  const answer = async (item, body) => {
    setBusyKey(item.key);
    try {
      await api.alertAnswer({ key: item.key, ref: item.ref ?? '', ...body });
      invalidate('alerts');
      notify(body.kind === 'snooze' ? `${item.title} · for ${plural(body.days, 'day', 'days')}` : item.title, {
        name: ANSWERED[body.kind],
        action: { label: 'Undo', onClick: async () => { await api.alertUnanswer(item.key, item.ref ?? ''); invalidate('alerts'); } },
      });
    } catch (err) {
      notify(err.message, { name: 'error.save' });
    } finally {
      setBusyKey(null);
    }
  };

  // A late statement dropped on its card: uploaded and read here, reviewed on Import.
  const uploadDropped = async (item, file) => {
    setBusyKey(item.key);
    try {
      const batch = await api.imports.upload(file, 'local');
      await api.imports.parse(batch.id);
      invalidate('imports', 'alerts');
      notify(file.name, { name: 'statement.read', action: { label: 'Review', to: `/import?open=${batch.id}` } });
    } catch (err) {
      notify(`${file.name}: ${err.message}`, { name: 'error.read' });
    } finally {
      setBusyKey(null);
    }
  };

  const loading = live.loading && !live.data;

  return (
    <div className="apple-pane w-full">
      <header className="mb-6">
        {/* The same title as every page (D343); the day is its description line, under it. */}
        <PageTitle className="text-2xl font-medium tracking-tight text-ink" emoji="🔔" tint="bg-vivid-red/15">Alerts</PageTitle>
        <p className="mt-1 text-sm text-muted">{longToday(today)}</p>
      </header>

      {live.error && <p className="mb-4 text-[13px] text-spend">{live.error}</p>}

      <Tiles totals={totals} active={filter} onPick={setFilter} still={still} />

      <section className="mt-8">
        <div className="mb-3 flex items-baseline justify-between px-1">
          <h3 className="text-[20px] font-semibold tracking-[-0.01em] text-ink">{filter ? { pay: 'Pay', upload: 'Upload', bills: 'Bills', review: 'Review' }[filter] : 'Needs you'}</h3>
          {filter && <button type="button" onClick={() => setFilter(null)} className="text-[13px] font-medium text-info">Show all</button>}
        </div>
        {loading && <p className="px-1 text-[15px] text-muted">Checking…</p>}
        {!loading && shown.length === 0 && (
          <div className="rounded-[20px] border border-rule bg-raised px-5 py-8 text-center">
            <p className="text-[17px] font-semibold text-ink">All caught up</p>
            <p className="mt-1 text-[13px] text-muted">{filter ? 'Nothing of this kind needs you.' : 'Nothing needs you right now.'}</p>
          </div>
        )}
        <ul className="space-y-3">
          <AnimatePresence initial={false}>
            {shown.map((item, i) => (
              <AlertCard key={item.key} item={item} index={i} account={byId.get(item.account_id)} still={still}
                busy={busyKey === item.key} onAnswer={answer} onDropFile={uploadDropped} />
            ))}
          </AnimatePresence>
        </ul>
      </section>

      {clearedCount > 0 && (
        <section className="mt-10">
          <div className="mb-1.5 flex items-baseline justify-between px-4">
            <h3 className="text-[13px] text-muted">Cleared <span className="tnum">· {clearedCount} this year</span></h3>
            <button type="button" onClick={() => setShowCleared((v) => !v)} aria-expanded={showCleared} className="text-[13px] font-medium text-info">{showCleared ? 'Hide' : 'Show'}</button>
          </div>
          <AnimatePresence initial={false}>
            {showCleared && (
              <motion.div initial={still ? false : { height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                transition={{ type: 'spring', bounce: 0, duration: 0.35 }} className="space-y-5 overflow-hidden">
                {cleared.map((m) => (
                  <GroupSection key={m.month} label={m.label}>
                    <Group as="ul">
                      {m.items.map((it) => (
                        <li key={it.key} className="gs-row flex items-center gap-3 px-4 py-2.5">
                          <span className="min-w-0 flex-1 truncate text-[15px] text-muted">{it.title}</span>
                          <span className="shrink-0 text-[13px] text-faint tnum">{new Date(it.resolved_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                        </li>
                      ))}
                    </Group>
                  </GroupSection>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      )}
    </div>
  );
}
