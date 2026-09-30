# Architecture

Three processes on one machine: PostgreSQL, an Express API on :4000, and a
Vite/React app on :5173 that proxies `/api` to the API. No login — it's a
single household's ledger on localhost.

```
 browser ──► web (Vite :5173) ──/api──► api (Express :4000) ──► PostgreSQL
                                             │
                                             └─► data/statements/   (uploaded files, git-ignored)
                                             └─► Anthropic API      (optional: other banks' PDFs)
```

## The life of a statement

```
upload ──► import_batch ──► parse ──► staged_transaction ──► review ──► approve ──► transaction
 (SHA-256            (CSV or         (nothing is final          (a person       (audit entry,
  dedup: the same     PDF pipeline)   yet; duplicates are        edits, skips,   statement row,
  file twice is                       flagged against the        confirms the    recurring links)
  refused)                            existing ledger)           account)
```

1. **Upload** (`routes/imports.js`). The file is hashed; an identical file is
   refused. It's stored under `data/statements/`, in a per-account folder
   once the account is confirmed.
2. **Account detection.** Issuer, account name, last 4 and holder name are
   read from the statement itself and matched to an existing account, or a
   new one is proposed. A new *person* is proposed, never auto-added, when a
   statement names someone the household doesn't have yet.
3. **Parse.**
   - **CSV** (`parse/csv.js`): the header row is sniffed and columns mapped by
     meaning, so any issuer's export works. Optional AI enrichment
     (`parse/categorize.js`) suggests merchant names and categories; if it
     fails, the rows import plain.
   - **PDF** — a local-first pipeline (`parse/pdf.js`):
     1. `pdf-pages.js` — text layer per page, locally. A page with no text
        (a scan) is marked, never dropped.
     2. `classify.js` — each page is scored and labelled TRANSACTIONS,
        SUMMARY or BOILERPLATE by an ordered, readable rule list.
     3. `layout-cache.js` — remembers each issuer's page pattern, to notice
        when a bank redesigns its statement.
     4. Extraction: for Bank of America, Chase, American Express and Bilt a
        deterministic local parser (`pdf-local-*.js`) reads the rows and
        **reconciles them against the statement's own printed totals**; for
        other issuers only the TRANSACTIONS/SUMMARY pages go to Claude with a
        strict output schema.
     5. A report of what was sent, what was skipped and why.
   - Every path runs `parse/redact.js`, which removes anything shaped like a
     full card number.
4. **Review** (`components/Review.jsx`). Rows are shown with suggested
   categories and duplicate warnings. Nothing is in the ledger yet.
5. **Approve.** Rows move to `transaction`, the statement's printed totals and
   cashback go to `statement`, and everything is audited.

## After import

- **Summaries** (`routes/summary.js`) are computed in SQL on every request —
  income, spend, loan payments, savings, per person and per category — so a
  recategorised transaction changes every view immediately. Spend is
  `amount_cents < 0` excluding payments/transfers; savings is income minus
  spend minus real loan payments.
- **Recurring bills** (`recurring.js`) are detected from transaction history
  and confirmed by a person; confirmed series link future matches.
- **Alerts** (`routes/alerts.js`) — overdue statements, missed or new
  recurring charges, rows awaiting review.
- **Activity** (`routes/activity.js`) reads `audit_log`; edits store
  `changes: { field: { from, to } }`.

## Data model (main tables)

| Table | Holds |
|---|---|
| `person` | household members (and their avatar) |
| `account` | cards and bank accounts — mask is 4 digits, never more |
| `import_batch` | one uploaded file and its parse status |
| `staged_transaction` | parsed rows awaiting review |
| `transaction` | the ledger — integer cents, negative = money out |
| `statement` | per-account, per-period printed totals and cashback |
| `category` | spending categories (with an optional icon) |
| `loan` | manual loan balances, terms and deadlines |
| `recurring_series` | confirmed recurring bills and their match rules |
| `contact` | Zelle counterparties |
| `audit_log` | every write, with before/after values |

Migrations in `db/` are plain SQL, numbered, applied in order. There's no
migration runner: applying them to an empty database reproduces the schema.

## Web app

- `web/src/api.js` is the only place that calls `fetch` and the only place
  that divides cents by 100 (`formatMoney`).
- `web/src/design-context.jsx` switches between Classic and Vivid; Vivid-only
  code checks `useDesign()`.
- Reusable pieces live in `components/ui/` (`DataTable`, `DetailDialog`,
  `PersonAvatar`); forms in `components/Form.jsx`.
- `web/src/demo.js` replaces the API with recorded responses in the GitHub
  Pages build (`VITE_DEMO=1`).
