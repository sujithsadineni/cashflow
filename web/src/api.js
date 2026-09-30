/**
 * One place that knows how to talk to the backend.
 */

/**
 * A request timeout.
 *
 * fetch has no default timeout — if the server accepts the
 * connection and then never answers, the promise hangs forever and
 * the UI sits on a spinner with no way out. AbortController gives
 * us a deadline, so a stuck backend becomes a visible error instead
 * of an eternal "loading".
 */
const TIMEOUT_MS = 10_000;

async function request(path, { timeoutMs = TIMEOUT_MS, ...options } = {}) {
  // The GitHub Pages demo has no server: replay recorded responses instead.
  if (import.meta.env.VITE_DEMO === '1') {
    const { demoRequest } = await import('./demo.js');
    return demoRequest(path, options, notifyBackgroundError);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // FormData sets its own multipart Content-Type (with boundary);
  // forcing JSON here would break file uploads.
  const headers = options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' };

  try {
    const response = await fetch(`/api${path}`, {
      headers,
      signal: controller.signal,
      ...options,
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const error = new Error(body.error || `Request failed (${response.status})`);
      error.field = body.field;          // which form field was rejected
      error.status = response.status;
      error.body = body;                 // any endpoint-specific detail (e.g. which row conflicted)
      throw error;
    }

    // 204 No Content has no body to parse.
    if (response.status === 204) return null;
    return response.json();
  } catch (err) {
    if (err.name === 'AbortError') {
      const timeout = new Error('The server took too long to respond');
      notifyBackgroundError(timeout.message);
      throw timeout;
    }
    // fetch throws TypeError when it can't reach the host at all
    if (err instanceof TypeError) {
      const unreachable = new Error('Cannot reach the server — is the API running?');
      notifyBackgroundError(unreachable.message);
      throw unreachable;
    }
    // A genuine server-side failure (a bug, a crash) — worth a toast
    // wherever it happens, unlike an ordinary 4xx (a validation
    // rejection, a 404), which the calling component already shows
    // inline right next to whatever the person just did.
    if (err.status >= 500) {
      notifyBackgroundError(err.message);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Set once by NotificationProvider (notification-context.jsx), same
 * module-level-flag pattern as setGlobalPrivacyMode below — api.js is
 * a plain module, not a component, so it can't call a React hook
 * itself. A no-op until the provider mounts, which is early enough
 * that nothing meaningful can fail before it does.
 */
let notifyBackgroundError = () => {};
export function setGlobalErrorNotifier(fn) {
  notifyBackgroundError = fn;
}

const post = (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) });

export const api = {
  health:     () => request('/health'),

  people:     () => request('/people'),
  personCreate: (name) => post('/people', { name }),
  personRename: (id, name) => request(`/people/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  personAvatar: (id, avatar) => request(`/people/${id}/avatar`, { method: 'PATCH', body: JSON.stringify({ avatar }) }),
  categories: () => request('/categories'),
  activity:   (limit = 50, { area, before, entity } = {}) =>
    request(`/activity?${new URLSearchParams({ limit, ...(area && { area }), ...(before && { before }), ...(entity && { entity }) })}`),
  summary:    (month) => request(`/summary${month ? `?month=${month}` : ''}`),
  alerts:     () => request('/alerts'),
  alertHistory: ({ month, year, ytd } = {}) => {
    const params = ytd ? `year=${year}&ytd=true` : `month=${month}`;
    return request(`/alerts/history?${params}`);
  },

  appSetting: {
    get: (key) => request(`/app-settings/${key}`),
    set: (key, value) => request(`/app-settings/${key}`, { method: 'PUT', body: JSON.stringify({ value }) }),
  },

  accounts: {
    list:       (includeClosed = false) =>
                  request(`/accounts${includeClosed ? '?include_closed=true' : ''}`),
    create:     (data) => post('/accounts', data),
    update:     (id, data) =>
                  request(`/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    deactivate: (id) => post(`/accounts/${id}/deactivate`),
    setColor:   (id, color) =>
                  request(`/accounts/${id}`, { method: 'PATCH', body: JSON.stringify({ color }) }),
    uploadImage: (id, file) => {
      const form = new FormData();
      form.append('image', file);
      return request(`/accounts/${id}/image`, { method: 'POST', body: form });
    },
    removeImage: (id) => request(`/accounts/${id}/image`, { method: 'DELETE' }),
    statementMonths: (id) => request(`/accounts/${id}/statement-months`),
    summary: (id) => request(`/accounts/${id}/summary`),
  },

  imports: {
    list:   () => request('/imports'),
    upload: (file, parseMethod = 'api') => {
      const form = new FormData();
      form.append('statement', file);
      form.append('parse_method', parseMethod);
      return request('/imports', { method: 'POST', body: form });
    },
    confirmAccount: (id, body) => post(`/imports/${id}/account`, body),
    // A PDF parse is a round trip to the Anthropic API — give it
    // three minutes, not the default ten seconds. `password` is only
    // sent when the caller actually has one to try (a household-
    // encrypted PDF) — never persisted anywhere past this call.
    parse:       (id, password) => request(`/imports/${id}/parse`, {
                   method: 'POST',
                   timeoutMs: 180_000,
                   body: password ? JSON.stringify({ password }) : undefined,
                 }),
    staged:      (id) => request(`/imports/${id}/staged`),
    updateStaged: (id, stagedId, changes) =>
                   request(`/imports/${id}/staged/${stagedId}`, {
                     method: 'PATCH',
                     body: JSON.stringify(changes),
                   }),
    approve:     (id, body) => post(`/imports/${id}/approve`, body),
    approveAnyway: (id, stagedId) => post(`/imports/${id}/staged/${stagedId}/approve-anyway`),
    remove:      (id) => request(`/imports/${id}`, { method: 'DELETE' }),
  },

  transactions: {
    list: (filters = {}) => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(filters)) {
        if (value !== '' && value !== undefined && value !== null) params.set(key, value);
      }
      const qs = params.toString();
      return request(`/transactions${qs ? `?${qs}` : ''}`);
    },
    update: (id, changes) =>
      request(`/transactions/${id}`, { method: 'PATCH', body: JSON.stringify(changes) }),
    trends: (granularity, month) =>
      request(`/transactions/trends?granularity=${granularity}&month=${month}`),
    merchantSummary: (merchant, categoryId) =>
      request(
        `/transactions/merchant-summary?merchant=${encodeURIComponent(merchant)}` +
        // categoryId is a real category's numeric id, the "none"
        // sentinel (the Uncategorized chip), or null/undefined for no
        // filter at all — checked explicitly so a falsy-but-real id
        // (0, in principle) isn't dropped the way `categoryId ? …` would.
        (categoryId != null ? `&category_id=${categoryId}` : '')
      ),
  },

  categoryCreate: (name) => post('/categories', { name }),
  categoryDelete: (id) => request(`/categories/${id}`, { method: 'DELETE' }),
  categoryIcon: (id, iconKey) =>
    request(`/categories/${id}/icon`, { method: 'PATCH', body: JSON.stringify({ icon_key: iconKey }) }),

  loans: {
    // `month` (YYYY-MM), when given, asks for balances as of that
    // month instead of right now — see routes/loans.js's own
    // `monthEndCappedSql`. Omitted by Settings' loan management page,
    // which always wants "right now"; passed by the Overview Loans
    // card's drill-down (LoansDetail.jsx) so it matches the month the
    // card itself is showing.
    list:       (includeClosed = false, month = null) =>
                  request(`/loans?${new URLSearchParams({
                    ...(includeClosed ? { include_closed: 'true' } : {}),
                    ...(month ? { month } : {}),
                  })}`),
    create:     (data) => post('/loans', data),
    update:     (id, data) =>
                  request(`/loans/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    deactivate: (id) => post(`/loans/${id}/deactivate`),
  },

  recurring: {
    list:   (includeEnded = false) =>
              request(`/recurring${includeEnded ? '?include_ended=true' : ''}`),
    // A detect pass reads every spend transaction from the last two
    // years and classifies each merchant group — noticeably slower
    // than a normal list/create call.
    detect: () => request('/recurring/detect', { method: 'POST', timeoutMs: 30_000 }),
    dismissCandidate: (matchNameContains) => post('/recurring/candidates/dismiss', { match_name_contains: matchNameContains }),
    create: (data) => post('/recurring', data),
    update: (id, data) =>
              request(`/recurring/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    link:   (id, transactionId) => post(`/recurring/${id}/link`, { transaction_id: transactionId }),
    unlink: (id, transactionId) => post(`/recurring/${id}/unlink`, { transaction_id: transactionId }),
    transactions: (id) => request(`/recurring/${id}/transactions`),
  },

  calendar: (month) => request(`/calendar?month=${month}`),

  zelle: {
    list:   () => request('/zelle'),
    review: (id, data) => request(`/zelle/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  },

  contacts: {
    list:       () => request('/contacts'),
    update:     (id, data) => request(`/contacts/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    uploadImage: (id, file) => {
      const form = new FormData();
      form.append('image', file);
      return request(`/contacts/${id}/image`, { method: 'POST', body: form });
    },
    removeImage: (id) => request(`/contacts/${id}/image`, { method: 'DELETE' }),
  },
  merchantReview: {
    list:    () => request('/merchant-review'),
    count:   () => request('/merchant-review/count'),
    approve: (id) => post(`/merchant-review/${id}/approve`),
    dismiss: (id) => post(`/merchant-review/${id}/dismiss`),
  },
  merchantIcons: {
    list:        () => request('/merchant-icons'),
    allMerchants: () => request('/merchant-icons/all-merchants'),
    update:      (merchant, data) => request(`/merchant-icons/${encodeURIComponent(merchant)}`, { method: 'PATCH', body: JSON.stringify(data) }),
    uploadImage: (merchant, file) => {
      const form = new FormData();
      form.append('image', file);
      return request(`/merchant-icons/${encodeURIComponent(merchant)}/image`, { method: 'POST', body: form });
    },
    removeImage: (merchant) => request(`/merchant-icons/${encodeURIComponent(merchant)}/image`, { method: 'DELETE' }),
  },
};

/**
 * Money formatting.
 *
 * The database stores integer cents. This is the ONLY function
 * allowed to divide by 100. Keeping that conversion in exactly one
 * place is how you avoid the bug where one screen shows $1,234.00
 * and another shows $123400.
 */
/**
 * Privacy mode: a pure display-layer toggle for taking screenshots
 * without exposing real numbers, dates, or names. Nothing about the
 * data changes — the database, the API responses, even React state
 * all still hold the real values. Only what these formatters render
 * changes.
 *
 * A module-level flag rather than React state, because formatMoney
 * is a plain function called from dozens of components that don't
 * carry context — mirroring one boolean here (set by PrivacyProvider,
 * see privacy-context.jsx) means every existing call site masks
 * automatically, with no changes to any of them.
 */
let privacyMode = false;
export function setGlobalPrivacyMode(value) {
  privacyMode = value;
}

// `compact` ("$6.2K") is for cells too narrow for full cents, like the
// Vivid Saved ledger. Kept here, as an option, rather than a second
// formatter: this stays the one function in the app that divides by 100.
export function formatMoney(cents, { showSign = false, compact = false } = {}) {
  if (cents == null) return '—';

  if (privacyMode) {
    const masked = compact ? '$***' : '$***.**';
    if (showSign && cents > 0) return `+${masked}`;
    if (cents < 0) return `−${masked}`;
    return masked;
  }

  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    // Whole dollars under $1,000 ("$955", not "$955.2"); one decimal once it's K/M.
    ...(compact && { notation: 'compact', maximumFractionDigits: Math.abs(cents) < 100_000 ? 0 : 1 }),
  }).format(Math.abs(cents) / 100);

  if (showSign && cents > 0) return `+${formatted}`;
  if (cents < 0) return `−${formatted}`;   // U+2212 minus, not a hyphen
  return formatted;
}

const SHORT_MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'YYYY-MM-DD' -> 'Jun 18' (or a masked placeholder in privacy mode). */
export function formatShortDate(iso) {
  if (!iso) return '—';
  if (privacyMode) return '*** **';
  const [, m, d] = iso.split('-').map(Number);
  return `${SHORT_MONTH[m - 1]} ${d}`;
}

/** ISO timestamp -> 'Jun 18 · 2:14 PM' (or a masked placeholder in privacy mode). */
export function formatTimestamp(iso) {
  if (!iso) return '—';
  if (privacyMode) return '*** ** · **:**';
  const d = new Date(iso);
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${SHORT_MONTH[d.getMonth()]} ${d.getDate()} · ${time}`;
}

const placeholderNames = new Map();
const PLACEHOLDER_NAMES = ['John Doe', 'Jane Doe'];

/**
 * A real name, or a stable Jane/John Doe placeholder in privacy mode.
 * Keyed by the name itself (not a person id) so the same real name
 * always maps to the same placeholder everywhere it appears, even
 * across components that only ever see the name string.
 */
export function maskName(name) {
  if (!privacyMode || !name) return name;
  if (!placeholderNames.has(name)) {
    const next = PLACEHOLDER_NAMES[placeholderNames.size] ?? `Person ${placeholderNames.size + 1}`;
    placeholderNames.set(name, next);
  }
  return placeholderNames.get(name);
}

export const ACCOUNT_TYPES = [
  { value: 'CREDIT_CARD', label: 'Credit card' },
  { value: 'CHECKING',    label: 'Checking' },
  { value: 'SAVINGS',     label: 'Savings' },
];

export const typeLabel = (value) =>
  ACCOUNT_TYPES.find((t) => t.value === value)?.label ?? value;

/** Casual labels for a transaction's type — same voice everywhere it appears. */
export const TXN_TYPE_LABELS = {
  purchase: 'Purchase',
  refund: 'Refund',
  payment: 'Card payment',
  transfer: 'Transfer',
  deposit: 'Deposit',
  fee: 'Fee',
  interest: 'Interest',
  cashback: 'Cashback',
  savings: 'Savings',
};

export const TXN_TYPE_OPTIONS = Object.entries(TXN_TYPE_LABELS).map(([value, label]) => ({ value, label }));
