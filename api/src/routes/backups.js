/** Backups (D205): when the last one ran, and one now on demand. */

import { Router } from 'express';
import { backupDir, lastBackup, runBackup, KEEP } from '../backup.js';

export const backupsRouter = Router();

backupsRouter.get('/', async (req, res, next) => {
  try {
    res.json({ last: await lastBackup(), folder: backupDir(), keep: KEEP });
  } catch (err) {
    next(err);
  }
});

backupsRouter.post('/', async (req, res, next) => {
  try {
    res.json({ last: await runBackup({ reason: 'manual' }), folder: backupDir(), keep: KEEP });
  } catch (err) {
    next(err);
  }
});
