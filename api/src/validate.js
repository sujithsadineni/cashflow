/**
 * Input validation.
 *
 * Every piece of data arriving from the browser gets checked here
 * before it reaches a query. Two reasons, and only one of them is
 * security:
 *
 *   1. Bad data is caught at the edge with a clear message, instead
 *      of becoming a confusing Postgres constraint error three
 *      layers down.
 *   2. The schema is documentation. Reading accountCreateSchema
 *      tells you exactly what the endpoint accepts, which no amount
 *      of prose in a README reliably does.
 *
 * zod handles the shape. The database constraints are still there
 * as the last line of defence — validation and constraints are
 * belt and braces, not alternatives.
 */

import { z } from 'zod';

/** A per-card accent color — not a third app-wide accent, just this tile's background. */
const hexColorSchema = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex color like #2F6B4F');

export const accountCreateSchema = z.object({
  person_id: z.coerce.number().int().positive(),

  name: z.string().trim().min(1, 'Name is required').max(60),

  issuer: z.string().trim().max(60).optional().or(z.literal('')),

  account_type: z.enum(['CREDIT_CARD', 'CHECKING', 'SAVINGS']),

  // Last four digits only. We never accept a full card number, so
  // the regex enforces exactly four digits rather than "up to 16".
  mask: z
    .string()
    .trim()
    .regex(/^\d{4}$/, 'Enter the last 4 digits')
    .optional()
    .or(z.literal('')),

  color: hexColorSchema.optional().or(z.literal('')),
});

/**
 * Multipart form fields arrive as strings, so account_id is coerced.
 * It's optional now — the parser identifies the account from the
 * statement itself and a human confirms it; passing one up front is
 * just an override. The file is validated in the route, not here.
 */
export const importCreateSchema = z.object({
  account_id: z.coerce.number().int().positive().optional(),
  // 'local' means parse deterministically, no Anthropic API call —
  // see parse/pdf-local.js. CSV rows still get the cheap Haiku
  // enrichment pass either way; 'local' only changes PDF handling.
  parse_method: z.enum(['api', 'local']).optional().default('api'),
});

/**
 * Confirming which account a parsed statement belongs to: either an
 * existing account's id, or the details to create a new one (prefilled
 * from what the parser detected, edited by the human).
 */
export const accountConfirmSchema = z
  .object({
    account_id: z.coerce.number().int().positive().optional(),
    create: z
      .object({
        person_id: z.coerce.number().int().positive(),
        name: z.string().trim().min(1, 'Name is required').max(60),
        issuer: z.string().trim().max(60).optional().or(z.literal('')),
        account_type: z.enum(['CREDIT_CARD', 'CHECKING', 'SAVINGS']),
        mask: z.string().trim().regex(/^\d{4}$/, 'Enter the last 4 digits').optional().or(z.literal('')),
      })
      .optional(),
  })
  .refine((body) => (body.account_id !== undefined) !== (body.create !== undefined), {
    message: 'Provide account_id or create, not both',
  });

const TXN_TYPE_VALUES = [
  'purchase',
  'refund',
  'payment',
  'transfer',
  'deposit',
  'fee',
  'interest',
  'cashback',
  'savings',
];

/** Inline edit on a staged row: category, merchant name, and/or type. null clears (category/merchant only). */
export const stagedUpdateSchema = z
  .object({
    suggested_category: z.string().trim().min(1).max(60).nullable().optional(),
    merchant: z.string().trim().min(1).max(80).nullable().optional(),
    txn_type: z.enum(TXN_TYPE_VALUES).optional(),
  })
  .refine(
    (body) => body.suggested_category !== undefined || body.merchant !== undefined || body.txn_type !== undefined,
    { message: 'Nothing to update' }
  );

/** Approve either an explicit list of staged rows, or every pending one. */
export const approveSchema = z
  .object({
    staged_ids: z.array(z.coerce.number().int().positive()).min(1).optional(),
    all: z.boolean().optional(),
  })
  .refine((body) => body.all === true || body.staged_ids !== undefined, {
    message: 'Provide staged_ids or all: true',
  });

export const accountUpdateSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  issuer: z.string().trim().max(60).optional().or(z.literal('')),
  mask: z.string().trim().regex(/^\d{4}$/).optional().or(z.literal('')),
  is_active: z.boolean().optional(),
  // Nullable, not just optional: null is how a card resets to its
  // default (a recognized bank's real color, or the random palette
  // fallback) — omitting the field entirely means "leave it alone".
  color: hexColorSchema.nullable().optional(),
});

/**
 * A new loan/debt entry: manual balance, and optionally enough about
 * its term (monthly_payment_cents + term_months + start_date) for the
 * app to compute an estimated remaining balance instead of trusting a
 * number that goes stale the moment you forget to update it.
 */
const LOAN_TYPE_VALUES = ['car', 'home', 'credit_card', 'balance_transfer', 'other'];

export const loanCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  lender: z.string().trim().max(60).optional().or(z.literal('')),
  loan_type: z.enum(LOAN_TYPE_VALUES).optional(),
  linked_account_id: z.coerce.number().int().positive().optional(),
  term_months: z.coerce.number().int().positive().optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional().or(z.literal('')),
  monthly_payment_cents: z.coerce.number().int().positive().optional(),
  current_balance_cents: z.coerce.number().int().min(0),
  deadline_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional().or(z.literal('')),
});

/** Updating a loan: balance and deadline change most often, but everything's editable. */
export const loanUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    lender: z.string().trim().max(60).nullable().optional(),
    loan_type: z.enum(LOAN_TYPE_VALUES).optional(),
    linked_account_id: z.coerce.number().int().positive().nullable().optional(),
    term_months: z.coerce.number().int().positive().nullable().optional(),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').nullable().optional(),
    monthly_payment_cents: z.coerce.number().int().positive().nullable().optional(),
    current_balance_cents: z.coerce.number().int().min(0).optional(),
    deadline_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').nullable().optional(),
    is_active: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to update' });

const CADENCE_VALUES = ['WEEKLY', 'BIWEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL'];
const CONFIDENCE_VALUES = ['HIGH', 'MEDIUM', 'LOW'];
const RECURRING_STATUS_VALUES = ['ACTIVE', 'PAUSED', 'ENDED'];

/** Creating a recurring series, from a detected candidate or by hand. */
export const recurringCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  glyph: z.string().trim().min(1, 'Pick a glyph').max(8),
  category_id: z.coerce.number().int().positive().nullable().optional(),
  account_id: z.coerce.number().int().positive().nullable().optional(),
  person_id: z.coerce.number().int().positive().nullable().optional(),

  match_name_contains: z.string().trim().min(1, 'A match rule is required').max(80),
  match_amount_min_cents: z.coerce.number().int().nullable().optional(),
  match_amount_max_cents: z.coerce.number().int().nullable().optional(),
  match_days_of_month: z.array(z.coerce.number().int().min(1).max(31)).nullable().optional(),

  cadence: z.enum(CADENCE_VALUES),
  cadence_interval: z.coerce.number().int().positive().default(1),
  expected_amount_cents: z.coerce.number().int(),
  amount_varies: z.boolean().default(false),

  status: z.enum(RECURRING_STATUS_VALUES).default('ACTIVE'),
  // A starting estimate — get overwritten once real transactions are
  // linked below, same as first_seen_date/last_seen_date/occurrence_count,
  // which aren't accepted here at all: they're always derived from the
  // transactions actually matched at creation time, never client-supplied.
  next_expected_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').nullable().optional(),
  confidence: z.enum(CONFIDENCE_VALUES),
  created_from: z.enum(['DETECTED', 'MANUAL']),
});

/** Editing a series: filters, schedule, category, or status. DELETE isn't a route - use status: 'ENDED'. */
export const recurringUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    glyph: z.string().trim().min(1).max(8).optional(),
    category_id: z.coerce.number().int().positive().nullable().optional(),
    account_id: z.coerce.number().int().positive().nullable().optional(),
    person_id: z.coerce.number().int().positive().nullable().optional(),

    match_name_contains: z.string().trim().min(1).max(80).optional(),
    match_amount_min_cents: z.coerce.number().int().nullable().optional(),
    match_amount_max_cents: z.coerce.number().int().nullable().optional(),
    match_days_of_month: z.array(z.coerce.number().int().min(1).max(31)).nullable().optional(),

    cadence: z.enum(CADENCE_VALUES).optional(),
    cadence_interval: z.coerce.number().int().positive().optional(),
    expected_amount_cents: z.coerce.number().int().optional(),
    amount_varies: z.boolean().optional(),

    status: z.enum(RECURRING_STATUS_VALUES).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to update' });

/** Manually linking or unlinking one transaction to a series. */
export const recurringLinkSchema = z.object({
  transaction_id: z.coerce.number().int().positive(),
});

export const recurringDismissSchema = z.object({
  match_name_contains: z.string().trim().min(1).max(80),
});

/** Reviewing one Zelle transaction: assign a display name and the type that decides its accounting effect. */
export const zelleReviewSchema = z.object({
  zelle_type: z.enum(['INTERNAL', 'SENT', 'RECEIVED']),
  zelle_person: z.string().trim().min(1, 'A name is required').max(80),
});

/** Editing a contact: name and/or nickname. Photo goes through its own upload route. */
export const contactUpdateSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(80).optional(),
    nickname: z.string().trim().max(80).nullable().optional(),
  })
  .refine((body) => body.name !== undefined || body.nickname !== undefined, { message: 'Nothing to update' });

/** Setting a merchant's custom emoji. Photo goes through its own upload route; either clears the other server-side. */
export const merchantIconEmojiSchema = z.object({
  emoji: z.string().trim().min(1, 'Pick an emoji').max(8),
});

export const categoryCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(40),
});

// Mirrors web/src/category-icons.js's ICON_CATALOG — a fixed
// allow-list, not free text, since icon_key ends up as a lookup key
// client-side (a typo would just render nothing, but there's no
// reason to accept one).
const CATEGORY_ICON_KEYS = [
  'home', 'bolt', 'cart', 'fork', 'car', 'fuel', 'bag', 'heart', 'shield',
  'refresh', 'star', 'tag', 'swap', 'card', 'tray-down', 'percent', 'bank',
  'undo', 'piggy', 'plane', 'film', 'briefcase', 'dot',
];

export const categoryIconSchema = z.object({
  icon_key: z.enum(CATEGORY_ICON_KEYS),
});

export const personUpdateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
});

/** A person's chosen avatar (D144) — an emoji, or null to go back to initials. */
export const personAvatarSchema = z.object({
  avatar: z.string().trim().min(1).max(16).nullable(),
});

/** Edit a transaction after approval: category, merchant name, and/or type. */
export const transactionUpdateSchema = z
  .object({
    category_id: z.coerce.number().int().positive().nullable().optional(),
    merchant: z.string().trim().min(1).max(80).nullable().optional(),
    txn_type: z.enum(TXN_TYPE_VALUES).optional(),
  })
  .refine(
    (body) => body.category_id !== undefined || body.merchant !== undefined || body.txn_type !== undefined,
    { message: 'Nothing to update' }
  );

/**
 * An empty string means "no filter" for a query param — that's what
 * an unselected HTML <select> naturally serializes to — but it is
 * NOT what any of these schemas otherwise accept: z.coerce.number()
 * turns '' into 0 (failing .positive() with a confusing error, not
 * "filter skipped"), and the date regex rejects '' outright. Without
 * this, a stale filter value or a hand-edited URL 400s instead of
 * just showing everything. Only used for query filters, not POST body
 * schemas, where an explicit '' can mean something real (e.g. "clear
 * this field").
 */
const optionalFilter = (schema) => z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

/** Transaction list filters. Everything optional; strings coerced. */
export const transactionsQuerySchema = z.object({
  account_id: optionalFilter(z.coerce.number().int().positive()),
  person_id: optionalFilter(z.coerce.number().int().positive()),
  category_id: optionalFilter(z.coerce.number().int().positive()),
  from: optionalFilter(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')),
  to: optionalFilter(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')),
  txn_type: optionalFilter(z.enum(TXN_TYPE_VALUES)),
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * Express middleware factory. Validates req.body against a schema,
 * replaces it with the cleaned result, or returns 400 with the
 * specific field that failed.
 */
export function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const first = result.error.issues[0];
      return res.status(400).json({
        error: first.message,
        field: first.path.join('.'),
      });
    }

    req.body = result.data;
    next();
  };
}

/**
 * Same idea for query strings. Express 5 makes req.query a getter, so
 * the cleaned result goes on req.filters instead of overwriting it.
 */
export function validateQuery(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.query);

    if (!result.success) {
      const first = result.error.issues[0];
      return res.status(400).json({
        error: first.message,
        field: first.path.join('.'),
      });
    }

    req.filters = result.data;
    next();
  };
}
