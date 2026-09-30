/**
 * Logging.
 *
 * Two audiences, two systems, and it's worth knowing the difference:
 *
 *   1. THIS FILE — runtime logs. Ephemeral. "A request came in",
 *      "the database was slow", "something threw". For debugging.
 *      Goes to your terminal.
 *
 *   2. src/audit.js — the audit log. Permanent, stored in Postgres.
 *      "This statement was imported", "this transaction was edited".
 *      For answering "where did this number come from?" in a year.
 *
 * We use pino rather than console.log because pino writes structured
 * JSON. That means every log line has real fields you can filter on,
 * instead of a string you have to grep. In development we pipe it
 * through pino-pretty so it's readable; in production the raw JSON
 * is what a log aggregator wants.
 */

import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',

  // Pretty colours and human timestamps while developing.
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname',
        },
      }
    : undefined,

  // Never log these, in any environment, by accident or otherwise.
  // Redaction happens inside pino, so even a careless logger.info(req)
  // can't leak them.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      '*.password',
      'DATABASE_URL',
      'ANTHROPIC_API_KEY',
    ],
    censor: '[redacted]',
  },
});
