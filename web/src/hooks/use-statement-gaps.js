import { useState } from 'react';
import { api } from '../api';
import { useApi, invalidate } from './use-api';
import { useNotify } from './use-notify';
import { gapView, silentView, cycleMonth } from '../lib/review/statement-gaps-view';

/**
 * Statement gaps for Review (D268): the data, the count for its badges,
 * and answering a cycle. Kept apart from the component (fast refresh).
 */

// Re-judged when statements or rows change, and when an answer is saved.
const useGapData = () => useApi('statement-gaps', () => api.statementGaps.list(), { tags: ['statement-gaps', 'imports', 'transactions'] }).data;

/** The Statements tab's badge: statements to upload, and statements saved wrong. */
export function useStatementGapCount() {
  const cards = useGapData();
  return cards ? gapView(cards).count : 0;
}

/** The Silent months tab's badge (D269): the months only you can answer. */
export function useSilentCount() {
  const cards = useGapData();
  return cards ? silentView(cards).count : 0;
}

/** Loads the gaps, and answers or un-answers a cycle. Shared by both designs. */
export function useStatementGaps() {
  const notify = useNotify();
  const cards = useGapData();
  const [busy, setBusy] = useState(false);

  const act = async (fn, message, toast) => {
    setBusy(true);
    try {
      await fn();
      invalidate('statement-gaps');
      notify(message, { name: toast });
    } catch (err) {
      notify(err.message, { name: 'error.save' });
    } finally {
      setBusy(false);
    }
  };
  const answer = (c) => act(() => api.statementGaps.answer(c.account_id, c.cycle.end), `${c.name} · no statement for ${cycleMonth(c.cycle)}`, 'gap.none');
  const unanswer = (c) => act(() => api.statementGaps.unanswer(c.account_id, c.cycle.end), `${c.name} · ${cycleMonth(c.cycle)}`, 'gap.asked');
  return { view: cards ? gapView(cards) : null, silent: cards ? silentView(cards) : null, busy, answer, unanswer };
}


/** A card's calendar, month by month, as the server judged it (D269); null for an account that isn't a card. */
export function useCardMonths(accountId) {
  const cards = useGapData();
  return cards?.find((c) => c.account_id === accountId)?.months ?? null;
}

/** The accounts whose calendar is by card months (D269): a statement's month is the one holding its 15th. */
export function useCardMonthAccounts() {
  const cards = useGapData();
  return new Set((cards ?? []).filter((c) => c.months).map((c) => c.account_id));
}
