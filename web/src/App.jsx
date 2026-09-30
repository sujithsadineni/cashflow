import { useCallback, useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { api } from './api';
import { Layout } from './components/Layout';
import { Welcome } from './components/Welcome';
import { Overview } from './components/Overview';
import { Alerts } from './components/Alerts';
import { Cards } from './components/Cards';
import { Transactions } from './components/Transactions';
import { Imports } from './components/Imports';
import { Recurring } from './components/Recurring';
import { ActivityLog } from './components/ActivityLog';
import { Settings } from './components/Settings';
import { MerchantIconsProvider } from './merchant-icons-context';
import { PrivacyProvider } from './privacy-context';
import { DesignProvider } from './design-context';
import { MotionConfig } from 'motion/react';
import { NotificationProvider, useNotify } from './notification-context';
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
  useEffect(() => {
    checkAlerts(notify);
  }, [notify]);
  return null;
}

export default function App() {
  const [health, setHealth] = useState(null);
  const [people, setPeople] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(false);

  /**
   * Reference data (people, accounts, categories) is loaded once here
   * and shared with every page. After any write, pages call load()
   * to refetch rather than patching local state — the screen always
   * shows what the database actually contains.
   */
  const load = useCallback(async () => {
    try {
      const [h, p, a, c] = await Promise.all([
        api.health(),
        api.people(),
        api.accounts.list(),
        api.categories(),
      ]);
      setHealth(h);
      setPeople(p);
      setAccounts(a);
      setCategories(c);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const connection = error ? 'down' : health ? 'ok' : 'checking';

  return (
    <NotificationProvider>
      <AlertsChecker />
      <PrivacyProvider>
        <DesignProvider>
        {/* Honors the OS "reduce motion" setting for every motion-library animation (D138). */}
        <MotionConfig reducedMotion="user">
        <MerchantIconsProvider>
          <Routes>
            <Route path="/" element={<Welcome hasData={accounts.length > 0} loaded={loaded} />} />
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
              <Route path="recurring" element={<Recurring categories={categories} />} />
              <Route path="activity" element={<ActivityLog categories={categories} accounts={accounts} people={people} />} />
              <Route
                path="settings"
                element={
                  <Settings accounts={accounts} people={people} categories={categories} onChange={load} />
                }
              />
            </Route>
          </Routes>
        </MerchantIconsProvider>
        </MotionConfig>
        </DesignProvider>
      </PrivacyProvider>
    </NotificationProvider>
  );
}
