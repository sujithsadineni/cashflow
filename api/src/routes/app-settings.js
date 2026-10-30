/**
 * A generic key/value store for shared household preferences — see
 * db/024_app_setting.sql for why this is generic rather than one
 * bespoke table+route per setting. Values are plain JSON (an array,
 * an object, a boolean), whatever the one caller of a given key
 * expects — this route doesn't interpret them.
 *
 * Only key names already in use are ever readable/writable in
 * practice, but nothing here enforces a fixed key list — the whole
 * point is that the next preference doesn't need a migration.
 */

import { Router } from 'express';
import { query } from '../core/db.js';
import { audit } from '../core/audit.js';

export const appSettingsRouter = Router();

/**
 * Every setting at once, { key: value }, so the app reads them in one
 * request instead of one per setting (D389). A handful of small JSON
 * values; the per-key route below stays for anything that wants one.
 */
appSettingsRouter.get('/', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT key, value FROM app_setting ORDER BY key');
    res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
  } catch (err) {
    next(err);
  }
});

appSettingsRouter.get('/:key', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT value FROM app_setting WHERE key = $1', [req.params.key]);
    res.json({ key: req.params.key, value: rows[0]?.value ?? null });
  } catch (err) {
    next(err);
  }
});

appSettingsRouter.put('/:key', async (req, res, next) => {
  try {
    if (!('value' in req.body)) {
      return res.status(400).json({ error: '"value" is required', field: 'value' });
    }
    await query(
      `INSERT INTO app_setting (key, value, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
      [req.params.key, JSON.stringify(req.body.value)]
    );
    await audit({ action: 'app_setting.changed', entityType: 'app_setting', detail: { key: req.params.key, value: req.body.value } });
    res.json({ key: req.params.key, value: req.body.value });
  } catch (err) {
    next(err);
  }
});
