/**
 * cashflow API server.
 *
 * index.js now does only three jobs: configure middleware, mount
 * route modules, handle errors. The routes themselves live in
 * src/routes/. Splitting them out while there are only a handful is
 * much easier than splitting them once there are thirty.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import pinoHttp from 'pino-http';

import { logger } from './core/logger.js';
import { checkConnection, databaseDetails, pool, query } from './core/db.js';
import { migrationFiles, migrationStatus } from './core/migrations.js';

import { referenceRouter } from './routes/reference.js';
import { accountsRouter } from './routes/accounts.js';
import { accountMembersRouter } from './routes/account-members.js';
import { activityRouter } from './routes/activity.js';
import { importsRouter } from './routes/imports.js';
import { transactionsRouter } from './routes/transactions.js';
import { summaryRouter } from './routes/summary.js';
import { loansRouter } from './routes/loans.js';
import { recurringRouter } from './routes/recurring.js';
import { zelleRouter } from './routes/zelle.js';
import { contactsRouter } from './routes/contacts.js';
import { merchantIconsRouter } from './routes/merchant-icons.js';
import { merchantReviewRouter } from './routes/merchant-review.js';
import { duplicatesRouter } from './routes/duplicates.js';
import { redemptionsRouter } from './routes/redemptions.js';
import { assistantRouter } from './routes/assistant.js';
import { merchantsRouter } from './routes/merchants.js';
import { peopleProfileRouter } from './routes/people-profile.js';
import { transactionReviewRouter } from './routes/transaction-review.js';
import { statementGapsRouter } from './routes/statement-gaps.js';
import { paymentMatchesRouter } from './routes/payment-matches.js';
import { backupsRouter } from './routes/backups.js';
import { scheduleBackups } from './core/backup.js';
import { alertsRouter } from './routes/alerts.js';
import { appSettingsRouter } from './routes/app-settings.js';
import { pdfPasswordsRouter } from './routes/pdf-passwords.js';

const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.json({ limit: '1mb' }));
app.use(pinoHttp({ logger }));

// ---------------------------------------------------------------
// Health
// ---------------------------------------------------------------

app.get('/api/health', async (req, res) => {
  try {
    const info = await checkConnection();
    res.json({
      status: 'ok',
      database: info.db,
      postgres: info.version.split(',')[0],
      uptime_seconds: Math.round(process.uptime()),
    });
  } catch (err) {
    req.log.error({ err }, 'health check failed');
    res.status(503).json({ status: 'error', error: 'database unreachable' });
  }
});

// The corner's API and Database cards (D333), fetched only when one opens.
// Always 200 while the API runs: the API half answers even when Postgres doesn't.
app.get('/api/health/details', async (req, res) => {
  const api = {
    started_at: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    uptime_seconds: Math.round(process.uptime()),
    node: process.version,
    port: Number(PORT),
  };
  try {
    res.json({ api, db: await databaseDetails() });
  } catch (err) {
    req.log.error({ err }, 'health details: database unreachable');
    res.json({ api, db: null, db_error: 'database unreachable' });
  }
});

// ---------------------------------------------------------------
// Routes
//
// No auth layer — this is a shared household ledger on localhost,
// not per-user data (see D100/D104 in docs/DECISIONS.md).
// ---------------------------------------------------------------

app.use('/api', referenceRouter);            // /api/people, /api/categories
app.use('/api/accounts', accountMembersRouter); // /api/accounts/:id/members (D344)
app.use('/api/accounts', accountsRouter);    // /api/accounts/...
app.use('/api/activity', activityRouter);    // /api/activity
app.use('/api/imports', importsRouter);      // /api/imports
app.use('/api/transactions', transactionsRouter);
app.use('/api/summary', summaryRouter);
app.use('/api/loans', loansRouter);
app.use('/api/recurring', recurringRouter);
app.use('/api/zelle', zelleRouter);
app.use('/api/contacts', contactsRouter);
app.use('/api/merchant-icons', merchantIconsRouter);
app.use('/api/merchant-review', merchantReviewRouter);
app.use('/api/duplicates', duplicatesRouter);
app.use('/api/redemptions', redemptionsRouter);
app.use('/api/assistant', assistantRouter);
app.use('/api/merchants', merchantsRouter);
app.use('/api/people', peopleProfileRouter);
app.use('/api/transaction-review', transactionReviewRouter);
app.use('/api/statement-gaps', statementGapsRouter);
app.use('/api/payment-matches', paymentMatchesRouter);
app.use('/api/backups', backupsRouter);
app.use('/api/alerts', alertsRouter);
app.use('/api/app-settings', appSettingsRouter);
app.use('/api/pdf-passwords', pdfPasswordsRouter);

// Card carousel images only — never the statement files themselves,
// those stay server-only and reachable exclusively through the import
// pipeline. A card image has no sensitive content by nature (the user
// picked it deliberately for a UI it displays it in), unlike a
// statement PDF, which is why this one directory is served directly.
app.use(
  '/api/account-images',
  express.static(process.env.ACCOUNT_IMAGES_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/account-images'))
);
// Same reasoning as account-images, for a contact's own photo.
app.use(
  '/api/contact-images',
  express.static(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/contact-images'))
);
// Same reasoning again, for a merchant's custom icon photo. Named
// merchant-icons-static, not merchant-icons, so it doesn't collide
// with the /api/merchant-icons API prefix mounted above.
app.use(
  '/api/merchant-icons-static',
  express.static(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/merchant-icons'))
);

// ---------------------------------------------------------------
// Errors
// ---------------------------------------------------------------

app.use((req, res) => {
  res.status(404).json({ error: 'not found', path: req.path });
});

// Four parameters, or Express doesn't treat it as the error handler; _next is unused on purpose.
app.use((err, req, res, _next) => {
  req.log.error({ err }, 'unhandled error');
  res.status(500).json({ error: 'internal server error' });
});

// ---------------------------------------------------------------
// Startup
// ---------------------------------------------------------------

async function start() {
  try {
    const info = await checkConnection();
    logger.info({ database: info.db }, 'database connected');
  } catch (err) {
    logger.error({ err }, 'cannot reach database - is postgres running?');
    logger.error('try: brew services list');
    process.exit(1);
  }

  // Code expects the schema the db/*.sql files describe (D204): refuse to
  // run against one that's behind, rather than fail later on a missing column.
  const { pending, changed, tracked } = await migrationStatus(query, await migrationFiles());
  if (!tracked) {
    logger.error('this database has no migration record: run `npm run migrate -- --baseline` once (built by hand) or `npm run migrate` (empty)');
    process.exit(1);
  }
  if (pending.length > 0) {
    logger.error({ pending: pending.map((f) => f.name) }, 'migrations pending: run `npm run migrate`');
    process.exit(1);
  }
  for (const name of changed) logger.warn({ migration: name }, 'an applied migration was edited; put changes in a new file');

  const server = app.listen(PORT, () => {
    logger.info(`cashflow api listening on http://localhost:${PORT}`);
  });

  // A daily copy of the database and the statement PDFs (D205). Off for a
  // throwaway API, like the demo recorder's (D257).
  if (process.env.BACKUP_SCHEDULE !== 'off') scheduleBackups();

  const shutdown = (signal) => {
    logger.info(`${signal} received, shutting down`);
    server.close(async () => {
      await pool.end();
      logger.info('shutdown complete');
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// Started only when run as the server, so tests can import the app and
// serve it on a throwaway port against a throwaway database (D209).
export { app };
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) start();
