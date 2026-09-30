# cashflow — rules for anyone changing this code

Read by coding agents (Codex reads `AGENTS.md`; Claude Code reads it via
`CLAUDE.md`) and meant just as much for people. The README covers setup;
`guide/ARCHITECTURE.md` covers how the pieces fit.

## What this is

A household expense tracker that runs on your own machine. Upload bank and
card statements (PDF or CSV), review the parsed rows, then see spending by
month, category, person and account. No bank logins, no aggregators, no cloud.

## Rules that must not be broken

- **Money is integer cents.** `$12.34` is `1234`, never a float.
  `formatMoney()` in `web/src/api.js` is the only code that divides by 100.
- **Negative is money out, positive is money in.** A $50 purchase is `-5000`.
- **Parsed rows go to `staged_transaction` first.** A person reviews and
  approves before anything reaches `transaction`. PDF parsing is never 100%
  accurate, and silently wrong financial data is worse than 30 seconds of review.
- **Cashback is read off the statement, not calculated.** Copy the issuer's
  printed number; don't build a rewards engine.
- **Never hard-delete.** Accounts deactivate; transactions get edited with an
  audit entry. History stays part of the record.
- **Never store a full card number.** `account.mask` is exactly 4 digits.
  `api/src/parse/redact.js` scrubs any card number a parser meets.
- **Parameterise every query value.** Dynamic column names come from a fixed
  allow-list in code, never from input (see `routes/accounts.js` PATCH).
- **Every write gets an audit entry** via `audit()` in `api/src/audit.js`.
- **Never commit `.env`, statements, or real financial data.** The pre-commit
  hook (`git config core.hooksPath .githooks`) runs `scripts/leak-scan.mjs`.

## Scope

In: statement upload and parsing, review before save, monthly views by
category/person/account, cashback per month, full-history search, manual
loan tracking, recurring-bill detection, a shared household ledger.

Out: bill splitting with roommates, card-rewards modelling, "which card
should I use", bank APIs/Plaid, budgets and forecasting. Ask before adding
anything outside the "In" list.

## Stack and layout

Node + Express 5 + raw SQL via `pg` (no ORM), zod validation, pino logging ·
React 19 + Vite + Tailwind v4, no component library · PostgreSQL.

```
api/src/          routes/ (one file per resource), parse/ (CSV + PDF pipeline)
api/demo/         invented demo household + recorder for the GitHub Pages demo
db/               numbered SQL migrations, applied in order
web/src/          components/, api.js (every fetch), index.css (design tokens)
scripts/          leak-scan (pre-commit), publish manifest
guide/            architecture and design notes
```

## Design system

Two designs, picked in Settings → Design. **Classic** is quiet: greenbar
ledger colours, `spend` (oxblood) and `earn` (pine) as the only saturated
colours, no emoji. **Vivid** is the colourful one: `--color-vivid-*` tokens,
emoji and `motion` animation. Keep Vivid-only work behind `useDesign()` so it
never leaks into Classic. Use token classes (`text-ink`, `bg-band`), never raw
hex. Every number in a column gets `.tnum`.

## Working here

- Test as you go: `npm test` in `api/` and `web/`.
- Keep changes small and verified; explain why, not only what.
- Local gotcha: use `127.0.0.1`, not `localhost`, for the Vite proxy target.
