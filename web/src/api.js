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
    const { demoRequest } = await import('./lib/demo/demo.js');
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
  healthDetails: () => request('/health/details'),

  people:     () => request('/people'),
  personCreate: (name) => post('/people', { name }),
  personRename: (id, name) => request(`/people/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  personNickname: (id, nickname) => request(`/people/${id}/nickname`, { method: 'PATCH', body: JSON.stringify({ nickname }) }),
  personAvatar: (id, avatar) => request(`/people/${id}/avatar`, { method: 'PATCH', body: JSON.stringify({ avatar }) }),
  // One person as their statements describe them (D302): printed names, addresses, accounts, the year's money.
  personProfile: (id, year) => request(`/people/${id}/profile${year ? `?year=${year}` : ''}`),
  categories: () => request('/categories'),
  activity:   (limit = 50, { area, before, entity } = {}) =>
    request(`/activity?${new URLSearchParams({ limit, ...(area && { area }), ...(before && { before }), ...(entity && { entity }) })}`),
  summary:    (month) => request(`/summary${month ? `?month=${month}` : ''}`),
  savingsBreakdown: (month) => request(`/summary/savings-breakdown?month=${month}`),
  savings: (year) => request(`/summary/savings?year=${year}`),
  cashback: (year) => request(`/summary/cashback?year=${year}`),
  fees: (year) => request(`/summary/fees?year=${year}`),
  // Credit used, each open card's line month by month for a year (D358).
  credit: (year) => request(`/summary/credit?year=${year}`),
  investment: (year) => request(`/summary/investment?year=${year}`),
  india: (year) => request(`/summary/india?year=${year}`),
  zelleYear: (year) => request(`/summary/zelle?year=${year}`),
  // "Where it's going" (D373): a month or the year so far, the household or one person.
  where: (month, span, personId) => request(`/summary/where?${new URLSearchParams({ month, span, ...(personId ? { person_id: personId } : {}) })}`),
  whereTransactions: (month, span, personId, categoryId) =>
    request(`/summary/where/transactions?${new URLSearchParams({ month, span, category_id: categoryId ?? 'none', ...(personId ? { person_id: personId } : {}) })}`),
  recordBalance: (accountId, body) => post(`/accounts/${accountId}/balances`, body),
  alerts:     () => request('/alerts'),
  // Answer an alert (D318): { key, ref, kind: 'snooze' | 'dismiss' | 'paid', days }; unanswer to undo.
  alertAnswer:   (body) => post('/alerts/snooze', body),
  alertUnanswer: (key, ref = '') => request(`/alerts/snooze?${new URLSearchParams({ key, ref })}`, { method: 'DELETE' }),
  alertHistory: ({ month, year, ytd } = {}) => {
    const params = ytd ? `year=${year}&ytd=true` : `month=${month}`;
    return request(`/alerts/history?${params}`);
  },

  appSetting: {
    all: () => request('/app-settings'), // { key: value } for every setting (D389)
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
    // The issuer's picture of a known card, by product key (D407).
    cardArt: (id, key) => post(`/accounts/${id}/card-art`, { key }),
    statementMonths: (id) => request(`/accounts/${id}/statement-months`),
    summary: (id) => request(`/accounts/${id}/summary`),
    // The statement that closed in a month, or the newest (D347): the back of the card.
    statementFacts: (id, month = null) => request(`/accounts/${id}/statement-facts${month ? `?month=${month}` : ''}`),
    // A bank account's month (D355): balance, what its money earned, the year so far.
    bankFacts: (id, month = null) => request(`/accounts/${id}/bank-facts${month ? `?month=${month}` : ''}`),
    // Who's on a shared card (D344): members, names its statements print that nobody accounts for.
    members:      (id) => request(`/accounts/${id}/members`),
    addMember:    (id, data) => post(`/accounts/${id}/members`, data),
    updateMember: (id, memberId, data) =>
                  request(`/accounts/${id}/members/${memberId}`, { method: 'PATCH', body: JSON.stringify(data) }),
    undoMember:   (id, auditId) => post(`/accounts/${id}/members/undo/${auditId}`),
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
    // `parseMethod: 'api'` switches a free-read PDF to Claude. Only ever
    // sent after the person said yes to that file (D182).
    // A typed password that opens it is remembered unless `remember` is false (D336).
    parse:       (id, password, parseMethod, remember = true) => request(`/imports/${id}/parse`, {
                   method: 'POST',
                   timeoutMs: 180_000,
                   body: password || parseMethod
                     ? JSON.stringify({ ...(password ? { password, remember } : {}), ...(parseMethod ? { parse_method: parseMethod } : {}) })
                     : undefined,
                 }),
    staged:      (id) => request(`/imports/${id}/staged`),
    updateStaged: (id, stagedId, changes) =>
                   request(`/imports/${id}/staged/${stagedId}`, {
                     method: 'PATCH',
                     body: JSON.stringify(changes),
                   }),
    approve:     (id, body) => post(`/imports/${id}/approve`, body),
    // Re-read a stored PDF for rows its saved rows lack (D214) and misread balances (D215). dry: list only.
    recover:     (id, { dry = false, balances = false } = {}) => post(`/imports/${id}/recover${dry ? '?dry=1' : balances ? '?balances=1' : ''}`),
    approveAnyway: (id, stagedId) => post(`/imports/${id}/staged/${stagedId}/approve-anyway`),
    // A line kept out for good, or brought back (D335).
    // The stored PDF's pages and where each row's line sits on them (D335); a page as a picture.
    pages:       (id) => request(`/imports/${id}/pages`, { timeoutMs: 60_000 }),
    // `version` is the file's fingerprint (D404): a reused import id never shows another file's cached page.
    pageImage:   (id, n, version) => `/api/imports/${id}/pages/${n}.png${version ? `?v=${version}` : ''}`,
    skipStaged:  (id, stagedId) => post(`/imports/${id}/staged/${stagedId}/skip`),
    restoreStaged: (id, stagedId) => post(`/imports/${id}/staged/${stagedId}/restore`),
    remove:      (id) => request(`/imports/${id}`, { method: 'DELETE' }),
  },

  // Remembered PDF passwords (D336): listed without the passwords themselves.
  pdfPasswords: {
    list: () => request('/pdf-passwords'),
    add: (password, label) => post('/pdf-passwords', { password, label }),
    forget: (id) => request(`/pdf-passwords/${id}`, { method: 'DELETE' }),
  },

  transactions: {
    get: (id) => request(`/transactions/${id}`),
    list: (filters = {}) => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(filters)) {
        // An array (several categories, D287) goes as one comma-separated value; an empty one not at all.
        if (value !== '' && value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0)) params.set(key, value);
      }
      const qs = params.toString();
      return request(`/transactions${qs ? `?${qs}` : ''}`);
    },
    // Every place the purchases happened (D352): [{ key, label, count }].
    places: () => request('/transactions/places'),
    // What was spent each day of a month (D321): [{ date, spent_cents, count }].
    daily: (month) => request(`/transactions/daily?month=${month}`),
    categorySummary: (filters) => request(`/transactions/category-summary?${new URLSearchParams(Object.entries(filters).filter(([, v]) => v != null && v !== ''))}`),
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
    // Month-by-month paid/remaining for one loan — LoanScheduleDetail.
    history:    (id) => request(`/loans/${id}/history`),
    create:     (data) => post('/loans', data),
    update:     (id, data) =>
                  request(`/loans/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    deactivate: (id) => post(`/loans/${id}/deactivate`),
    // Cards carrying a balance transfer no loan tracks yet (D194).
    suggestions:       () => request('/loans/suggestions'),
    dismissSuggestion: (key) => post(`/loans/suggestions/${encodeURIComponent(key)}/dismiss`),
  },

  recurring: {
    list:        (includeEnded = false, month = null) =>
                   request(`/recurring?${new URLSearchParams({ ...(includeEnded ? { include_ended: 'true' } : {}), ...(month ? { month } : {}) })}`),
    // Reads two years of spending and looks for rhythms — slower than a list call.
    suggestions: () => request('/recurring/suggestions', { timeoutMs: 30_000 }),
    ignore:      (key) => post('/recurring/suggestions/ignore', { key }),
    ignored:     () => request('/recurring/suggestions/ignored'),
    restore:     (key) => post('/recurring/suggestions/restore', { key }),
    recheck:     () => post('/recurring/recheck'),
    create:      (data) => post('/recurring', data),
    update:      (id, data) => request(`/recurring/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    charges:     (id) => request(`/recurring/${id}/charges`),
    unlink:      (id, transactionId) => post(`/recurring/${id}/unlink`, { transaction_id: transactionId }),
  },

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
    similar:    () => request('/contacts/similar'),
    merge:      (id, into) => request(`/contacts/${id}/merge`, { method: 'POST', body: JSON.stringify({ into }) }),
    distinct:   (a, b) => request('/contacts/distinct', { method: 'POST', body: JSON.stringify({ a, b }) }),
  },
  merchantReview: {
    list:    () => request('/merchant-review'),
    count:   () => request('/merchant-review/count'),
    approve: (id) => post(`/merchant-review/${id}/approve`),
    dismiss: (id) => post(`/merchant-review/${id}/dismiss`),
  },
  // Possible duplicates: the same purchase saved from two statements (D328).
  duplicates: {
    list:     () => request('/duplicates'),
    count:    () => request('/duplicates/count'),
    bothReal: (keep_id, remove_id) => post('/duplicates/both-real', { keep_id, remove_id }),
    remove:   (keep_id, remove_id) => post('/duplicates/remove', { keep_id, remove_id }),
  },
  // Rewards taken as gift cards (D330): entered by hand, counted as cashback on their day.
  // Questions for the assistant (D332): answered here, or saved for Claude Code to answer later.
  assistant: {
    questions: () => request('/assistant/questions'),
    question: (id) => request(`/assistant/questions/${id}`),
    ask: (question) => post('/assistant/ask', { question }),
    // Several lookups can take a while: two minutes, not the usual ten seconds.
    askClaude: (question) => request('/assistant/ask-claude', { method: 'POST', body: JSON.stringify({ question }), timeoutMs: 120_000 }),
    suggestions: () => request('/assistant/suggestions'),
    saveForLater: (question) => post('/assistant/questions', { question, via: 'claude_code' }),
    seen: (id) => post(`/assistant/questions/${id}/seen`),
    dismiss: (id) => post(`/assistant/questions/${id}/dismiss`),
  },
  redemptions: {
    list:   () => request('/redemptions'),
    create: (data) => post('/redemptions', data),
    update: (id, data) => request(`/redemptions/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    void:   (id) => post(`/redemptions/${id}/void`),
  },
  // Daily copies of the database and statement PDFs (D205).
  backups: {
    status: () => request('/backups'),
    run:    () => post('/backups'),
  },
  // Where a card payment came from, set by hand (D200).
  paymentMatches: {
    set:   (transactionId, via, label) => post(`/payment-matches/${transactionId}`, label ? { via, label } : { via }),
    clear: (transactionId) => request(`/payment-matches/${transactionId}/manual`, { method: 'DELETE' }),
  },
  // Months a card has no statement for: quiet, or one to upload (D268).
  statementGaps: {
    list:     () => request('/statement-gaps'),
    answer:   (account_id, cycle_end) => post('/statement-gaps/answer', { account_id, cycle_end }),
    unanswer: (account_id, cycle_end) =>
                request('/statement-gaps/answer', { method: 'DELETE', body: JSON.stringify({ account_id, cycle_end }) }),
  },
  transactionReview: {
    list:    () => request('/transaction-review'),
    count:   () => request('/transaction-review/count'),
    run:     () => post('/transaction-review/run'),
    approve: (id, value) => post(`/transaction-review/${id}/approve`, value ? { value } : {}),
    dismiss: (id) => post(`/transaction-review/${id}/dismiss`),
    // D249: many at once, all or nothing; and putting them back.
    batch:   ({ approve = [], dismiss = [] }) => post('/transaction-review/batch', { approve, dismiss }),
    undo:    (items) => post('/transaction-review/undo', { items }),
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

  // Renaming a merchant, or merging it into one that exists (D300); undo by the change's id.
  merchants: {
    rename:     (from, to) => post('/merchants/rename', { from, to }),
    undoRename: (auditId) => post(`/merchants/rename/${auditId}/undo`),
    // Companies by that name with a logo (D301): sends the name to Clearbit, so only on Search.
    logoSearch: (q) => request(`/merchants/logo-search?q=${encodeURIComponent(q)}`, { timeoutMs: 15_000 }),
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
/** "1,234.56" or "$1234.56" -> 123456; NaN when empty. The one place a typed amount becomes cents. */
export function dollarsToCents(value) {
  const cleaned = String(value).replace(/[^0-9.-]/g, '');
  if (cleaned === '') return NaN;
  return Math.round(parseFloat(cleaned) * 100);
}

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
/**
 * A mailing address read off statements (D302), hidden whole in privacy mode:
 * no part of an address (a street, a ZIP) is safe in a screenshot.
 */
export function maskAddress(line) {
  return privacyMode && line ? 'Address hidden' : line;
}

export function maskName(name) {
  if (!privacyMode || !name) return name;
  if (!placeholderNames.has(name)) {
    const next = PLACEHOLDER_NAMES[placeholderNames.size] ?? `Person ${placeholderNames.size + 1}`;
    placeholderNames.set(name, next);
  }
  return placeholderNames.get(name);
}

/**
 * A person, briefly, for tight places like the Transactions table (D237):
 * their nickname, else their first name. Privacy mode shows the masked
 * placeholder's first name and never the nickname, which could identify them.
 */
export function shortPersonName(name, nickname) {
  if (!name) return name;
  if (nickname && !privacyMode) return nickname;
  return maskName(name).trim().split(/\s+/)[0];
}

export const ACCOUNT_TYPES = [
  { value: 'CREDIT_CARD', label: 'Credit card' },
  { value: 'CHECKING',    label: 'Checking' },
  { value: 'SAVINGS',     label: 'Savings' },
  { value: 'INVESTMENT',  label: 'Investment' },
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
