/**
 * The app's pages, as the sidebar lists them (Layout.jsx), and the
 * nearest one to a mistyped address (the 404 page, D232).
 */

// Two groups — viewing money, then managing the data behind it —
// split by a plain rule rather than a text label. A "MONEY" /
// "SYSTEM" eyebrow would just restate what the icons and grouping
// already say, and ALL-CAPS labels are on this app's avoid-list.
export const NAV_GROUPS = [
  [
    { to: '/overview', label: 'Overview', end: true, icon: 'overview' },
    { to: '/alerts', label: 'Alerts', icon: 'alerts' },
    { to: '/cards', label: 'Cards', icon: 'cards' },
    { to: '/transactions', label: 'Transactions', icon: 'transactions' },
    // Its own page (D212): it was a pop-up behind a button on Transactions.
    { to: '/review', label: 'Review', icon: 'review' },
    { to: '/recurring', label: 'Recurring', icon: 'recurring' },
  ],
  [
    { to: '/import', label: 'Import', icon: 'import' },
    { to: '/activity', label: 'Activity', icon: 'activity' },
    { to: '/settings', label: 'Settings', icon: 'settings' },
  ],
];

const PAGES = NAV_GROUPS.flat();

// Edits (insert, delete, change one letter) between two words.
function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const here = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = here;
    }
  }
  return row[b.length];
}

/** The page a mistyped path most likely meant ("/transactons" → Transactions), or null. */
export function nearestPage(pathname) {
  const word = pathname.toLowerCase().split('/').filter(Boolean)[0] ?? '';
  if (!word) return null;
  let best = null;
  for (const page of PAGES) {
    const d = distance(word, page.to.slice(1));
    if (!best || d < best.d) best = { page, d };
  }
  // Close enough to be a typo: about a third of the word.
  return best.d <= Math.max(2, Math.floor(word.length / 3)) ? best.page : null;
}

// Settings tabs whose label isn't just the tab's name capitalised.
const SETTINGS_TAB = { icons: 'Merchants', overview: 'Overview cards' };

/**
 * The browser tab's title for a page (D232): "Transactions · cashflow",
 * "Loans · Settings · cashflow", "Review (46) · cashflow" while there's
 * something to look at, "Page not found · cashflow" for an unknown address.
 * `counts` is the sidebar's badges, keyed by page ({ '/review': 46 }).
 */
export function pageTitle(pathname, search = '', counts = {}) {
  if (pathname === '/' || pathname === '') return 'cashflow';
  const page = PAGES.find((p) => pathname === p.to || pathname.startsWith(`${p.to}/`));
  if (!page) return 'Page not found · cashflow';
  const count = counts[page.to] > 0 ? ` (${counts[page.to]})` : '';
  const tab = page.to === '/settings' ? new URLSearchParams(search).get('tab') : null;
  const tabLabel = tab ? SETTINGS_TAB[tab] ?? tab.charAt(0).toUpperCase() + tab.slice(1) : null;
  return [tabLabel, `${page.label}${count}`, 'cashflow'].filter(Boolean).join(' · ');
}
