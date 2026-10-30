/**
 * The statement's own pages, for the dialog's left pane (D335): which pages
 * the stored PDF has, where each staged row's line sits on them, and each
 * page as a picture. Read-only, never sent anywhere: the PDF is rendered on
 * this machine with the same pdf.js the free reader uses. A CSV, a missing
 * file or a password-protected PDF (its password is never stored) says
 * `available: false`, and the dialog keeps its drawn page instead.
 */

import { Router } from 'express';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';

import { query } from '../../core/db.js';
import { STANDARD_FONT_DATA_URL } from '../../parse/pdf-pages.js';
import { readSectionTotals } from '../../statements/section-totals.js';
import { locateFigures } from '../../statements/figure-lines.js';
import { rowHeadings } from '../../statements/row-headings.js';
import { pageLines, locateRows } from '../../statements/page-lines.js';
import { REPO_ROOT, statementSummary } from './shared.js';
import { findSavedPassword } from '../../statements/pdf-passwords.js';

const router = Router();
export { router as pagesRouter };

const RENDER_SCALE = 2; // about 144 dpi: sharp on a retina screen at the pane's width
const openDoc = (buffer, password) => getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: true, standardFontDataUrl: STANDARD_FONT_DATA_URL, password });
const locked = (err) => err?.name === 'PasswordException';
/** Open it; a password-protected one with a remembered password (D336). */
async function open(buffer) {
  let task = openDoc(buffer);
  try {
    return { task, doc: await task.promise };
  } catch (err) {
    await task.destroy();
    if (!locked(err)) throw err;
    const password = await findSavedPassword(buffer, { count: false });
    if (!password) throw err;
    task = openDoc(buffer, password);
    return { task, doc: await task.promise };
  }
}

// A rendered page takes a few hundred ms; the dialog asks for the same pages again on every
// open and replay. Kept for the most recent few, by batch and page, in memory only.
const pictures = new Map();
const remember = (key, png) => {
  pictures.set(key, png);
  if (pictures.size > 24) pictures.delete(pictures.keys().next().value);
};

async function storedPdf(id) {
  const { rows: [batch] } = await query('SELECT id, stored_path, file_type FROM import_batch WHERE id = $1', [id]);
  if (!batch) return { status: 404 };
  if (batch.file_type !== 'PDF') return { unavailable: 'csv' };
  try {
    return { buffer: await readFile(path.resolve(REPO_ROOT, batch.stored_path)) };
  } catch {
    return { unavailable: 'missing' };
  }
}

router.get('/:id/pages', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const file = await storedPdf(id);
    if (file.status === 404) return res.status(404).json({ error: 'Import not found' });
    if (file.unavailable) return res.json({ available: false, reason: file.unavailable });

    let task;
    let doc;
    try {
      ({ task, doc } = await open(file.buffer));
    } catch (err) {
      if (locked(err)) return res.json({ available: false, reason: 'locked' });
      throw err;
    }
    const pages = [];
    try {
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        const { width, height } = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        pages.push({ n, width, height, lines: pageLines(content.items, width, height) });
      }
    } finally {
      await task.destroy();
    }

    const { rows: [batch] } = await query('SELECT * FROM import_batch WHERE id = $1', [id]);
    // In the order the reader saved them, which is nearly the printed order (92 of 105
    // statements exactly), so each match searching on from the one before rarely has to go back.
    const { rows } = await query(
      `SELECT id, posted_date, description, amount_cents FROM staged_transaction
        WHERE import_batch_id = $1 ORDER BY id`, [id]);
    const located = locateRows(pages, rows);
    res.json({
      available: true,
      pages: pages.map(({ n, width, height }) => ({ n, width, height })),
      rows: located,
      // The heading each row was printed under (D360), so the reading says what it's reading.
      headings: rowHeadings(pages, located),
      // Each person's printed total on a shared card (D360), for the reading's section check.
      sections: readSectionTotals(pages),
      // Where each figure of the strip is printed (D360), lit when it's hovered or read.
      figures: locateFigures(pages, (await statementSummary(batch)).summary),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/pages/:n.png', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const n = Number(req.params.n);
    const key = `${id}:${n}`;
    let png = pictures.get(key);
    if (!png) {
      const file = await storedPdf(id);
      if (file.status === 404 || file.unavailable) return res.status(404).json({ error: 'No page to show' });
      let task;
      try {
        let doc;
        ({ task, doc } = await open(file.buffer));
        if (!Number.isInteger(n) || n < 1 || n > doc.numPages) return res.status(404).json({ error: 'No such page' });
        const page = await doc.getPage(n);
        const viewport = page.getViewport({ scale: RENDER_SCALE });
        const canvas = createCanvas(viewport.width, viewport.height);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        png = canvas.toBuffer('image/png');
        remember(key, png);
      } catch (err) {
        if (locked(err)) return res.status(404).json({ error: 'This PDF has a password' });
        throw err;
      } finally {
        await task?.destroy();
      }
    }
    // The page of a stored statement never changes; private, since it's household data.
    res.set('Cache-Control', 'private, max-age=3600').type('png').send(png);
  } catch (err) {
    next(err);
  }
});
