import { Link, useLocation } from 'react-router-dom';
import { PageTitle } from './Form';
import { nearestPage } from '../nav';

/**
 * Any address the app doesn't know (D232). It used to render nothing, a
 * blank white page. It sits inside the Layout, so the sidebar is still
 * there, and offers the page a typo most likely meant.
 */
export function NotFound() {
  const { pathname } = useLocation();
  const guess = nearestPage(pathname);
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <p className="font-mono text-sm tnum text-faint">404</p>
      <div className="mt-2 flex justify-center">
        <PageTitle as="h1" className="text-2xl font-medium tracking-tight text-ink" emoji="🧭" tint="bg-vivid-blue/15">
          Page not found
        </PageTitle>
      </div>
      <p className="mt-3 text-muted">
        There's no page at <code className="rounded bg-band px-1.5 py-0.5 font-mono text-sm text-ink">{pathname}</code>.
      </p>
      {guess && (
        <p className="mt-6">
          Did you mean{' '}
          <Link to={guess.to} className="font-medium text-earn underline-offset-4 hover:underline">{guess.label}</Link>?
        </p>
      )}
      <div className="mt-8 flex justify-center gap-2">
        <Link to="/overview" className="rounded-md bg-ink px-4 py-2 font-medium text-paper transition-colors hover:bg-ink/90">Go to Overview</Link>
        <Link to="/transactions" className="rounded-md border border-rule px-4 py-2 font-medium text-ink transition-colors hover:bg-band">Transactions</Link>
      </div>
    </div>
  );
}
