import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { currentMonth } from '../lib/app/dates';
import { overviewView, viewParams } from '../lib/overview/overview-view';

const KEY = 'cashflow.overview.view';
const load = () => { try { return JSON.parse(sessionStorage.getItem(KEY)); } catch { return null; } };
const save = (v) => { try { sessionStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private window: the address still holds it */ } };

/**
 * Overview's month and Month/YTD (D380), kept in the address and, for this
 * tab, in sessionStorage, so coming back from another page lands where you
 * were (and the address shows it again). A new tab starts on this month. Replaces the history entry rather
 * than adding one, so Back leaves Overview instead of stepping through months.
 */
export function useOverviewView() {
  const [params, setParams] = useSearchParams();
  const thisMonth = currentMonth();
  const view = overviewView(params, load(), thisMonth);
  // Whatever is showing is what this tab remembers, a pick or an address that arrived from a link.
  // and a view remembered from earlier goes back into the address, so a refresh keeps it too.
  const wanted = new URLSearchParams(viewParams(view, thisMonth)).toString();
  useEffect(() => {
    save({ month: view.month, span: view.span });
    if (params.toString() !== wanted) setParams(wanted, { replace: true });
  }, [view.month, view.span, wanted, params, setParams]);

  function set(change) {
    const next = { ...view, ...change };
    // Saved first: picking this month or Month leaves the address bare, and a bare
    // address reads the tab's saved view, so an older pick there would win.
    save(next);
    setParams(viewParams(next, thisMonth), { replace: true });
  }

  return { month: view.month, span: view.span, setMonth: (month) => set({ month }), setSpan: (span) => set({ span }) };
}
