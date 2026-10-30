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
import { PAYMENT_METHOD_KEYS } from '../merchants/payment-method.js';

/** A per-card accent color — not a third app-wide accent, just this tile's background. */
const hexColorSchema = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex color like #2F6B4F');

export const accountCreateSchema = z.object({
  person_id: z.coerce.number().int().positive(),

  name: z.string().trim().min(1, 'Name is required').max(60),

  issuer: z.string().trim().max(60).optional().or(z.literal('')),

  account_type: z.enum(['CREDIT_CARD', 'CHECKING', 'SAVINGS', 'INVESTMENT']),

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
  parse_method: z.enum(['api', 'local']).optional().default('local'), // free unless asked (D182)
});

/**
 * Confirming which account a parsed statement belongs to: either an
 * existing account's id, or the details to create a new one (prefilled
 * from what the parser detected, edited by the human).
 */
export const accountConfirmSchema = z
  .object({
    account_id: z.coerce.number().int().positive().optional(),
    // Attach to an account the statement doesn't look like (another bank, or a card for a bank statement).
    force: z.boolean().optional(),
    create: z
      .object({
        // The owner, or (a shared statement, D400) whichever member is the primary.
        person_id: z.coerce.number({ message: 'Pick whose account it is' }).int().positive('Pick whose account it is').optional(),
        // A statement printing several people's sections, said to be shared: who each name is.
        members: z.array(z.object({
          printed_name: z.string().trim().min(1).max(80),
          role: z.enum(['owner', 'co_owner', 'additional']),
          person_id: z.coerce.number().int().positive().optional(),
          new_person: z.string().trim().min(1).max(80).optional(),
          card_ending: z.string().trim().regex(/^\d{4}$/).nullable().optional(),
        }).refine((m) => (m.person_id !== undefined) !== (m.new_person !== undefined), 'Pick who this is'))
          .max(6).optional(),
        // A card whose statement prints no limit: typed in once, or skipped for Settings later.
        credit_limit_cents: z.coerce.number().int().positive('Enter the limit, or skip it').optional(),
        name: z.string().trim().min(1, 'Name is required').max(60),
        issuer: z.string().trim().max(60).optional().or(z.literal('')),
        account_type: z.enum(['CREDIT_CARD', 'CHECKING', 'SAVINGS', 'INVESTMENT']),
        mask: z.string().trim().regex(/^\d{4}$/, 'Enter the last 4 digits').optional().or(z.literal('')),
      })
      .refine((c) => (c.members?.length ? c.members.filter((m) => m.role === 'owner').length === 1 : c.person_id !== undefined), {
        message: 'Pick whose account it is, or one primary on a shared one',
        path: ['person_id'],
      })
      .optional(),
  })
  .refine((body) => (body.account_id !== undefined) !== (body.create !== undefined), {
    message: 'Provide account_id or create, not both',
  });

export const TXN_TYPE_VALUES = [
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
    // A line the parser found no date for gets one from its review panel (D335).
    posted_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional(),
  })
  .refine(
    (body) => body.suggested_category !== undefined || body.merchant !== undefined || body.txn_type !== undefined || body.posted_date !== undefined,
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
  // Everything the add form sets can be edited later (D267).
  person_id: z.coerce.number().int().positive().optional(),
  account_type: z.enum(['CREDIT_CARD', 'CHECKING', 'SAVINGS', 'INVESTMENT']).optional(),
  holder_name: z.string().trim().max(80).optional().or(z.literal('')),
  // A card's usual closing and due day (D270); 31 means the month's last day. null clears it.
  closing_day: z.coerce.number().int().min(1).max(31).nullable().optional(),
  due_day: z.coerce.number().int().min(1).max(31).nullable().optional(),
  // A flat cash back rate for a card that prints none (D330), in basis points: 300 is 3%. null clears it.
  cashback_rate_bps: z.coerce.number().int().min(1).max(2000).nullable().optional(),
  name: z.string().trim().min(1).max(60).optional(),
  // A credit limit the household sets for a card whose statements print none (D354), in cents; null clears it.
  credit_limit_manual_cents: z.coerce.number().int().min(1).max(100_000_000_00).nullable().optional(),
  // A short name for tight places (D353); '' clears it back to the full name.
  nickname: z.string().trim().max(24, 'Keep it to 24 characters').optional().or(z.literal('')),
  issuer: z.string().trim().max(60).optional().or(z.literal('')),
  mask: z.string().trim().regex(/^\d{4}$/).optional().or(z.literal('')),
  is_active: z.boolean().optional(),
  // Nullable, not just optional: null is how a card resets to its
  // default (a recognized bank's real color, or the random palette
  // fallback) — omitting the field entirely means "leave it alone".
  color: hexColorSchema.nullable().optional(),
});

/**
 * Someone on a shared card (D344): the person, their role, and how the
 * statement prints them. card_ending is a last four only, like a mask.
 */
const memberFields = {
  person_id: z.coerce.number().int().positive(),
  role: z.enum(['owner', 'co_owner', 'additional']),
  printed_name: z.string().trim().max(80).nullable().optional(),
  card_ending: z.string().trim().regex(/^\d{4}$/, 'Enter the last 4 digits').nullable().optional(),
  since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').nullable().optional(),
};
export const accountMemberCreateSchema = z.object(memberFields).strict();
export const accountMemberUpdateSchema = z.object({ ...memberFields, is_active: z.boolean() }).partial().strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change');

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
  payment_account_id: z.coerce.number().int().positive().optional(),
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
    payment_account_id: z.coerce.number().int().positive().nullable().optional(),
    // The last month of a balance transfer's minimum-payment phase (D309), as its first day.
    minimum_until: z.string().regex(/^\d{4}-\d{2}-01$/, 'Use the first of a month, YYYY-MM-01').nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to update' });

const CADENCE_VALUES = ['WEEKLY', 'BIWEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL'];

/** Creating a recurring series, from a detected candidate or by hand. */
/** Confirming a suggested bill, or adding one by hand (D185). */
export const billCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  merchant: z.string().trim().min(1).max(80),
  cadence: z.enum(CADENCE_VALUES),
  day: z.coerce.number().int().min(1).max(31).nullable().optional(),
  expected_amount_cents: z.coerce.number().int().max(-1, 'A bill is money out'),
  amount_varies: z.boolean().default(false),
  match_amount_min_cents: z.coerce.number().int().nullable().optional(),
  match_amount_max_cents: z.coerce.number().int().nullable().optional(),
  charge_ids: z.array(z.coerce.number().int().positive()).max(500).default([]),
}).strict();

/** Editing a bill: its name, price, rhythm, day, or status. */
export const billUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    cadence: z.enum(CADENCE_VALUES).optional(),
    day: z.coerce.number().int().min(1).max(31).nullable().optional(),
    expected_amount_cents: z.coerce.number().int().max(-1).optional(),
    amount_varies: z.boolean().optional(),
    status: z.enum(['ACTIVE', 'PAUSED', 'ENDED']).optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to update' });

/** Ignoring a suggestion (its merchant|cadence|price key), or unlinking one charge. */
export const billIgnoreSchema = z.object({ key: z.string().trim().min(1).max(200) }).strict();
export const billUnlinkSchema = z.object({ transaction_id: z.coerce.number().int().positive() }).strict();

/** Reviewing one Zelle transaction: assign a display name and the type that decides its accounting effect. */
export const zelleReviewSchema = z.object({
  zelle_type: z.enum(['INTERNAL', 'SENT', 'RECEIVED']),
  zelle_person: z.string().trim().min(1, 'A name is required').max(80),
});

/** Editing a contact: name and/or nickname. Photo goes through its own upload route. */
/** Merge one contact into another (D290). */
export const contactMergeSchema = z.object({ into: z.number().int().positive() }).strict();
/** Two contacts the household says are different people (D290). */
export const contactDistinctSchema = z.object({ a: z.number().int().positive(), b: z.number().int().positive() }).strict()
  .refine((x) => x.a !== x.b, { message: 'Pick two different contacts' });

export const contactUpdateSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(80).optional(),
    nickname: z.string().trim().max(80).nullable().optional(),
  })
  .refine((body) => body.name !== undefined || body.nickname !== undefined, { message: 'Nothing to update' });

/** Setting a merchant's custom emoji. Photo goes through its own upload route; either clears the other server-side. */
/**
 * A merchant's logo source (D300, D301): a website for its logo, or none
 * (back to its built-in logo or its category's icon). Emoji are gone (D301).
 */
/** One possible-duplicate pair, answered (D328): the copy kept and the one removed. */
export const duplicatePairSchema = z.object({
  keep_id: z.coerce.number().int().positive(),
  remove_id: z.coerce.number().int().positive(),
});

/**
 * Rewards taken as a gift card (D330): the card, the day, the brand, what
 * the gift card is worth, and what it cost in rewards, dollars or points.
 */
const redemptionFields = {
  account_id: z.coerce.number().int().positive(),
  redeemed_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  brand: z.string().trim().min(1, 'Name the gift card').max(60),
  value_cents: z.coerce.number().int().positive('A gift card is worth more than $0'),
  rewards_used_cents: z.coerce.number().int().positive().nullable().optional(),
  points_used: z.coerce.number().int().positive().nullable().optional(),
  note: z.string().trim().max(200).nullable().optional(),
};
export const redemptionCreateSchema = z.object(redemptionFields);
export const redemptionUpdateSchema = z.object(redemptionFields).partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to update' });

/** A question for the assistant (D332). Only "save for Claude Code" until steps 3 and 4. */
export const assistantAskSchema = z.object({
  question: z.string().trim().min(1, 'Type a question').max(500, 'Keep it under 500 characters'),
  via: z.enum(['claude_code']),
});

/** A question answered here, on this computer (D332 step 3). */
export const assistantLocalAskSchema = z.object({
  question: z.string().trim().min(1, 'Type a question').max(500, 'Keep it under 500 characters'),
});

/** An answer written back to a saved question (by Claude Code, D332). */
export const assistantAnswerSchema = z.object({
  answer: z.string().trim().min(1, 'The answer is empty').max(20000),
});

export const merchantIconEmojiSchema = z.object({
  domain: z.string().trim().max(300).nullable().optional(),
});

/** Renaming a merchant, or merging it into another (D300). */
export const merchantRenameSchema = z.object({
  from: z.string().min(1).max(200),
  to: z.string().max(200),
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
  'undo', 'piggy', 'plane', 'film', 'briefcase', 'trend-up', 'school', 'cut',
  'wrench', 'ticket', 'document', 'gift', 'barbell', 'bed', 'phone', 'dot',
  // D373: so no two categories share an icon
  'globe', 'people', 'compare', 'battery', 'storefront', 'fast-food', 'shirt', 'check', 'cash', 'hourglass', 'leaf', 'library', 'receipt'];

export const categoryIconSchema = z.object({
  icon_key: z.enum(CATEGORY_ICON_KEYS),
});

export const personUpdateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
});

/** A person's nickname (D237): shown where space is tight. Blank clears it. */
export const personNicknameSchema = z.object({
  nickname: z.string().trim().max(40).nullable().transform((v) => (v ? v : null)),
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
    // How it was paid, as the person says (D359); null goes back to what the statement says.
    payment_method: z.enum(PAYMENT_METHOD_KEYS).nullable().optional(),
  })
  .refine(
    (body) => body.category_id !== undefined || body.merchant !== undefined || body.txn_type !== undefined || body.payment_method !== undefined,
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
/** GET /transactions/category-summary (D198): one card, optionally one date range. */
export const categorySummaryQuerySchema = z.object({
  account_id: z.coerce.number().int().positive(),
  from: optionalFilter(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')),
  to: optionalFilter(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')),
});

/**
 * GET /summary/where (D373): "Where it's going" for a month or the year so
 * far, for the household or one person. category_id only on /transactions.
 */
export const whereQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM'),
  span: z.enum(['month', 'ytd']).default('month'),
  person_id: optionalFilter(z.coerce.number().int().positive()),
  category_id: optionalFilter(z.union([z.literal('none'), z.coerce.number().int().positive()])),
});

/** Several ids at once, comma-separated ("3,7"); one id still works (D304). */
const idList = (what) => optionalFilter(z.coerce.string()
  .regex(/^[1-9]\d*(,[1-9]\d*)*$/, `Use ${what} ids, separated by commas`)
  .transform((s) => [...new Set(s.split(','))].map(Number)));

export const transactionsQuerySchema = z.object({
  account_id: idList('account'),
  person_id: idList('person'),
  // 'none' = uncategorised rows, for the Cards page's category bar (D198).
  // Several at once, comma-separated ("3,7,none"), for the Transactions filter (D287).
  category_id: optionalFilter(z.coerce.string()
    .regex(/^(none|[1-9]\d*)(,(none|[1-9]\d*))*$/, 'Use category ids or none, separated by commas')
    .transform((s) => [...new Set(s.split(','))])),
  from: optionalFilter(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')),
  to: optionalFilter(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')),
  // Several types at once too (D304): "purchase,refund".
  txn_type: optionalFilter(z.coerce.string()
    .transform((s) => [...new Set(s.split(','))])
    .pipe(z.array(z.enum(TXN_TYPE_VALUES)).min(1))),
  q: z.string().trim().max(200).optional(),
  // Where (D352): place keys, "online" or "Town|ST", several at once separated by commas.
  place: optionalFilter(z.string().max(1000).transform((s) => [...new Set(s.split(',').map((x) => x.trim()).filter(Boolean))])),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * Express middleware factory. Validates req.body against a schema,
 * replaces it with the cleaned result, or returns 400 with the
 * specific field that failed.
 */
/** Approving a re-check finding (D175): optionally with a different value than the one suggested. */
export const transactionReviewApproveSchema = z.object({ value: z.string().trim().min(1).max(100).optional() }).strict();

/** Many Review findings at once (D249): approve some (each with an optional other value), dismiss others. */
const reviewIdSchema = z.number().int().positive();
export const transactionReviewBatchSchema = z.object({
  approve: z.array(z.object({ id: reviewIdSchema, value: z.string().trim().min(1).max(100).optional() }).strict()).max(500).default([]),
  dismiss: z.array(reviewIdSchema).max(500).default([]),
}).strict().refine((b) => b.approve.length + b.dismiss.length > 0, { message: 'Nothing to do' });

/** "No statement this month" for one card's cycle (D268), named by the day it would have closed. */
export const statementGapAnswerSchema = z.object({
  account_id: z.coerce.number().int().positive(),
  cycle_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
}).strict();

/** Putting findings back (D249): each with the value it was approved as, so a later edit is never overwritten. */
export const transactionReviewUndoSchema = z.object({
  items: z.array(z.object({ id: reviewIdSchema, value: z.string().trim().min(1).max(100).optional() }).strict()).min(1).max(500),
}).strict();

/** A hand-entered balance for a savings or investment account (D180). */
export const accountBalanceSchema = z.object({
  as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  balance_cents: z.number().int().min(-2e9).max(2e9),
}).strict();

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

/** Marking where a card payment came from by hand (D200). */
export const paymentSourceSchema = z.object({
  via: z.enum(['person', 'cash', 'outside']),
  label: z.string().trim().max(80).optional(),
}).strict().refine((v) => v.via === 'cash' || (v.label && v.label.length > 0), { message: 'Say who or which account', path: ['label'] });

/** Answering an alert (D318): snooze it some days, dismiss it, or mark a card bill paid. */
export const alertSnoozeSchema = z.object({
  key: z.string().trim().min(1).max(80).regex(/^[a-z_]+(:[\w.|+ -]+)?$/i, 'An alert key, like pay:9'),
  ref: z.string().trim().max(40).optional().default(''),
  kind: z.enum(['snooze', 'dismiss', 'paid']),
  days: z.coerce.number().int().min(1).max(90).optional(),
}).refine((b) => b.kind !== 'snooze' || b.days, { message: 'How many days to snooze', path: ['days'] });
