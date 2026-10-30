import { lazy, useCallback } from 'react';
import { invalidate, useApi } from './hooks/use-api';
import { Routes, Route } from 'react-router-dom';
import { api } from './api';
import { Layout } from './components/layout/Layout';
import { Welcome } from './components/welcome/Welcome';
import { NotFound } from './components/layout/NotFound';
// Each page loads when it's first opened (D210): the app was one 777 KB
// file, so opening Settings also downloaded Overview's charts. Welcome
// stays in the main file because it's the first thing anyone sees.
// Layout shows "Loading…" (Suspense) while a page's file arrives.
const page = (load, name) => lazy(() => load().then((m) => ({ default: m[name] })));
const Overview = page(() => import('./components/overview/Overview'), 'Overview');
const Alerts = page(() => import('./components/alerts/Alerts'), 'Alerts');
const Cards = page(() => import('./components/cards/Cards'), 'Cards');
const Transactions = page(() => import('./components/transactions/Transactions'), 'Transactions');
const Imports = page(() => import('./components/imports/Imports'), 'Imports');
const Recurring = page(() => import('./components/recurring/Recurring'), 'Recurring');
const ActivityLog = page(() => import('./components/activity/ActivityLog'), 'ActivityLog');
const Settings = page(() => import('./components/settings/Settings'), 'Settings');
const Review = page(() => import('./components/review/TransactionReview'), 'TransactionReview');
import { MerchantIconsProvider } from './context/merchant-icons-context';
import { PrivacyProvider } from './context/privacy-context';
import { DesignProvider } from './context/design-context';
import { MotionConfig } from 'motion/react';
import { NotificationProvider } from './context/notification-context';
import { ConfirmProvider } from './context/confirm-context';

export default function App() {
  /**
   * Reference data (people, accounts, categories) is loaded once here
   * and shared with every page. After any write, pages call load()
   * to refetch rather than patching local state — the screen always
   * shows what the database actually contains. (useApi, D211; tagged
   * 'reference' so any page can invalidate it.) One key each (D389), so a
   * page asking for the same list (Alerts' accounts, Overview's
   * categories) shares the request instead of making its own.
   */
  const peopleReq = useApi('people', () => api.people(), { tags: ['reference'] });
  const accountsReq = useApi('accounts:active', () => api.accounts.list(), { tags: ['reference'] });
  const categoriesReq = useApi('categories', () => api.categories(), { tags: ['reference'] });
  const refs = [peopleReq, accountsReq, categoriesReq];
  const [people, accounts, categories] = refs.map((r) => r.data ?? []);
  const loaded = refs.every((r) => r.data !== undefined) || refs.some((r) => r.error != null);
  const load = useCallback(() => invalidate('reference'), []);

  return (
    <PrivacyProvider>
      <DesignProvider>
        {/* Honors the OS "reduce motion" setting for every motion-library animation (D138). */}
        <MotionConfig reducedMotion="user">
        {/* Inside Design so toasts take the chosen look (D201). */}
        <NotificationProvider>
        <ConfirmProvider>
        <MerchantIconsProvider>
          <Routes>
            <Route path="/" element={<Welcome hasData={accounts.length > 0} loaded={loaded} accounts={accounts} />} />
            <Route element={<Layout />}>
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
        </ConfirmProvider>
        </NotificationProvider>
        </MotionConfig>
      </DesignProvider>
    </PrivacyProvider>
  );
}
