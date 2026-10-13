/**
 * Statement imports, /api/imports (D213). This file used to hold every
 * import route in 1,416 lines; each step now has its own file in
 * routes/imports/, mounted here in the order a statement moves through
 * them: upload → parse → confirm account → staged rows → approve.
 *
 * The SHA-256 of the file contents is the dedupe key. It's UNIQUE in
 * the database, so the same statement can't be imported twice even if
 * the filename changed.
 */

import { Router } from 'express';
import { uploadRouter } from './imports/upload.js';
import { parseRouter } from './imports/parse.js';
import { accountRouter } from './imports/account.js';
import { stagedRouter } from './imports/staged.js';
import { approveRouter } from './imports/approve.js';

export const importsRouter = Router();
importsRouter.use(uploadRouter, parseRouter, accountRouter, stagedRouter, approveRouter);

// Scripts (migrate-statement-folders.mjs) use the file-naming helpers.
export { accountFolderSlug, statementFileName, uniquePath, pathExists } from './imports/shared.js';
