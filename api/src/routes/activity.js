/**
 * The audit trail, exposed for the Activity view.
 */

import { Router } from 'express';
import { recentActivity, ACTIVITY_AREAS } from '../audit.js';

export const activityRouter = Router();

activityRouter.get('/', async (req, res, next) => {
  try {
    // Clamp the limit. An unbounded ?limit= is a cheap way for a
    // client to make the server do far too much work.
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const area = req.query.area;
    if (area !== undefined && !(area in ACTIVITY_AREAS)) {
      return res.status(400).json({ error: `area must be one of: ${Object.keys(ACTIVITY_AREAS).join(', ')}`, field: 'area' });
    }
    const beforeId = Number.isInteger(Number(req.query.before)) && req.query.before !== undefined ? Number(req.query.before) : null;
    // ?entity=transaction:1610 — one thing's own history. Both halves are
    // plain values bound as parameters; a malformed one is a 400.
    let entityType = null;
    let entityId = null;
    if (req.query.entity !== undefined) {
      const match = /^([a-z_]+):(\d+)$/.exec(req.query.entity);
      if (!match) return res.status(400).json({ error: 'entity must look like type:id', field: 'entity' });
      entityType = match[1];
      entityId = Number(match[2]);
    }
    res.json(await recentActivity(limit, { area: area ?? null, beforeId, entityType, entityId }));
  } catch (err) {
    next(err);
  }
});
