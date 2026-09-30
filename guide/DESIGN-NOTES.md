# Design notes

The decisions that shape this codebase, and what was rejected. Code comments
cite decision numbers like `D12` or `D100` — those point to the maintainer's
private build log; the reasoning that matters is summarised here.

## Money

- **Integer cents, everywhere.** Floats drift over thousands of additions;
  `0.1 + 0.2` is not `0.3`. One function (`formatMoney`) turns cents into text.
- **One sign convention.** Negative is money out, positive is money in, for
  every account type. Credit-card statements print the opposite (a purchase is
  positive on the bill), so card parsers flip the sign on the way in; checking
  statements are taken as printed.

## Trust

- **Review before save.** Parsing is good, never perfect. A wrong number
  silently written to the ledger is much worse than 30 seconds of review, so
  every parsed row stops in `staged_transaction` until a person approves it.
- **Reconcile, don't guess.** The local PDF parsers check their rows against
  the statement's own printed section totals and balances. A line inside a
  known section that doesn't parse fails the import loudly instead of being
  dropped.
- **Read the issuer's numbers.** Cashback is copied from the statement, not
  computed from rules — the bank already did that maths.
- **Never hard-delete.** A closed card's history is still the household's
  history. Accounts deactivate; edits keep an audit trail with before and after.

## Cost and privacy

- **Local-first PDF parsing.** Most of a statement is boilerplate. Text
  extraction and page classification run locally for free; four issuers are
  parsed entirely locally; only the pages that matter are ever sent to a
  model, and only when there's no local parser.
- **No full card numbers.** A redaction pass runs on every extraction path,
  and the database only accepts a 4-digit mask.
- **No aggregator.** No Plaid, no bank logins — statements you already have.

## Simplicity

- **Raw SQL, no ORM.** The summaries lean on `SUM(...) FILTER (WHERE ...)`
  and `date_trunc`, which read and tune more easily as SQL than through an ORM.
  Every value is a parameter; dynamic column names come from an allow-list.
- **Computed, not stored, summaries.** Monthly totals are calculated on read,
  so fixing one transaction's category fixes every chart at once.
- **No component library.** A handful of shared components (`DataTable`,
  `DetailDialog`) cover the app; Tailwind tokens carry the design.

## Two designs

- **Classic** comes from greenbar ledger paper: a quiet surface, two
  saturated colours with fixed meanings (oxblood = money out, pine = money
  in), tabular figures so amounts align on the decimal.
- **Vivid** is an opt-in, per-browser alternative with a wider palette, emoji
  and `motion` animation (including a synthesised-sound welcome page). It's
  deliberately isolated behind `useDesign()` so Classic stays calm.

## The demo

GitHub Pages can't run the API, so the demo replays recorded responses from
an invented household. Recording by driving the real UI (rather than listing
endpoints by hand) means the demo captures whatever the pages actually ask for.
