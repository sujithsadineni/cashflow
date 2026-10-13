import { lazy, useEffect } from 'react';
import { useApi } from './use-api';
import { Routes, Route } from 'react-router-dom';
import { api } from './api';
import { Layout } from './components/Layout';
import { Welcome } from './components/Welcome';
import { NotFound } from './components/NotFound';
// Each page loads when it's first opened (D210): the app was one 777 KB
// file, so opening Settings also downloaded Overview's charts. Welcome
// stays in the main file because it's the first thing anyone sees.
// Layout shows "Loading…" (Suspense) while a page's file arrives.
const page = (load, name) => lazy(() => load().then((m) => ({ default: m[name] })));
const Overview = page(() => import('./components/Overview'), 'Overview');
const Alerts = page(() => import('./components/Alerts'), 'Alerts');
const Cards = page(() => import('./components/Cards'), 'Cards');
const Transactions = page(() => import('./components/Transactions'), 'Transactions');
const Imports = page(() => import('./components/Imports'), 'Imports');
const Recurring = page(() => import('./components/Recurring'), 'Recurring');
const ActivityLog = page(() => import('./components/ActivityLog'), 'ActivityLog');
const Settings = page(() => import('./components/Settings'), 'Settings');
const Review = page(() => import('./components/TransactionReview'), 'TransactionReview');
import { MerchantIconsProvider } from './merchant-icons-context';
import { PrivacyProvider } from './privacy-context';
import { DesignProvider } from './design-context';
import { MotionConfig } from 'motion/react';
import { NotificationProvider } from './notification-context';
import { useNotify } from './use-notify';
import { checkAlerts } from './alerts';

/**
 * No UI of its own — just fires the once-per-load alerts check
 * (overdue statements, missed recurring charges, newly detected
 * ones) as toasts. Has to live INSIDE NotificationProvider to call
 * useNotify(), which is why this isn't just another line in App()
 * itself: App is what renders the provider, so it sits one level
 * above where the context is actually available.
 */
function AlertsChecker() {
  const notify = useNotify();
  // A beat after load, so they arrive once the page has settled rather
  // than over a "Loading…" screen (D201).
  useEffect(() => {
    const t = setTimeout(() => checkAlerts(notify), 1200);
    return () => clearTimeout(t);
  }, [notify]);
  return null;
}

export default function App() {
  /**
   * Reference data (people, accounts, categories) is loaded once here
   * and shared with every page. After any write, pages call load()
   * to refetch rather than patching local state — the screen always
   * shows what the database actually contains. (useApi, D211; tagged
   * 'reference' so any page can invalidate it.)
   */
  const ref = useApi('reference', () => Promise.all([api.health(), api.people(), api.accounts.list(), api.categories()]), { tags: ['reference'] });
  const [health, people, accounts, categories] = ref.data ?? [null, [], [], []];
  const error = ref.error;
  const loaded = ref.data !== undefined || ref.error != null;
  const load = ref.reload;

  const connection = error ? 'down' : health ? 'ok' : 'checking';

  return (
    <PrivacyProvider>
      <DesignProvider>
        {/* Honors the OS "reduce motion" setting for every motion-library animation (D138). */}
        <MotionConfig reducedMotion="user">
        {/* Inside Design so toasts take the chosen look (D201). */}
        <NotificationProvider>
        <AlertsChecker />
        <MerchantIconsProvider>
          <Routes>
            <Route path="/" element={<Welcome hasData={accounts.length > 0} loaded={loaded} accounts={accounts} />} />
            <Route element={<Layout connection={connection} database={health?.database} />}>
              <Route path="overview" element={<Overview accounts={accounts} people={people} onChange={load} />} />
              <Route path="alerts" element={<Alerts />} />
              <Route
                path="cards"
                element={<Cards accounts={accounts} people={people} categories={categories} onAccountsChanged={load} />}
              />
              <Route
                path="transactions"
                element={<Transactions accounts={accounts} people={people} categories={categories} />}
              />
              <Route
                path="import"
                element={<Imports accounts={accounts} people={people} categories={categories} onChange={load} />}
              />
              <Route path="review" element={<Review categories={categories} onResolved={load} />} />
              <Route path="recurring" element={<Recurring />} />
              <Route path="activity" element={<ActivityLog categories={categories} accounts={accounts} people={people} />} />
              <Route
                path="settings"
                element={
                  <Settings accounts={accounts} people={people} categories={categories} onChange={load} />
                }
              />
              {/* Anything else: a real "not found" page, not a blank one (D232). */}
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </MerchantIconsProvider>
        </NotificationProvider>
        </MotionConfig>
      </DesignProvider>
    </PrivacyProvider>
  );
}
