import { Component } from 'react';

/**
 * A page that throws while rendering shows this instead of blanking the
 * whole app (D206). The Activity crash (D202) took every page down to a
 * white screen, sidebar included, because nothing caught it. Wrapped
 * around the page area in Layout and keyed by path, so the sidebar stays
 * and moving to another page starts fresh.
 *
 * A class because React still only catches render errors in
 * getDerivedStateFromError / componentDidCatch; there's no hook for it.
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, showDetail: false };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Kept in the browser console for debugging; nothing leaves the machine.
    console.error('Page crashed:', error, info?.componentStack);
  }

  render() {
    const { error, showDetail } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" className="max-w-xl rounded-lg border border-spend/40 bg-spend/5 px-5 py-4">
        <h2 className="text-base font-medium text-ink">This page couldn’t load</h2>
        <p className="mt-1 text-sm text-muted">
          Something on it failed to display. Your data is safe: nothing was changed. The rest of the app still works from the sidebar.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            onClick={() => this.setState({ error: null, showDetail: false })}
            className="rounded-md bg-ink px-3 py-1.5 text-sm text-paper transition-colors hover:bg-ink/90"
          >
            Try again
          </button>
          <button onClick={() => window.location.reload()} className="rounded-md border border-rule px-3 py-1.5 text-sm text-ink hover:bg-band">
            Reload the app
          </button>
          <button onClick={() => this.setState({ showDetail: !showDetail })} className="text-sm text-muted underline-offset-4 hover:text-ink hover:underline">
            {showDetail ? 'Hide details' : 'Show details'}
          </button>
        </div>
        {showDetail && (
          <pre className="mt-3 max-h-48 overflow-auto rounded-md border border-rule bg-raised px-3 py-2 font-mono text-xs text-muted">
            {String(error?.stack ?? error)}
          </pre>
        )}
      </div>
    );
  }
}
