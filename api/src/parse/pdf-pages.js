/**
 * Stage 1 — local text extraction.
 *
 * pdfjs-dist pulls the text layer out per page, for free, before
 * anything touches the API. Most statements are text-based PDFs, so
 * this usually gives us everything we need.
 *
 * A page whose text comes back empty or vanishingly short has no
 * usable text layer — it's a scan. We mark it, we never drop it:
 * older statements are often scans and losing a page silently is far
 * worse than paying for image extraction on it.
 */

import { fileURLToPath } from 'node:url';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const MIN_USABLE_CHARS = 20;

// pdfjs-dist ships its own standard font substitution data (for a PDF
// that references a non-embedded standard font like Helvetica) right
// in the package — pointing at it stops the noisy-but-harmless
// "Ensure that the standardFontDataUrl API parameter is provided"
// warning on every single page of every PDF this app parses. A plain
// filesystem path, not a file:// URL — pdf.js's own Node data loader
// hands this straight to fs.readFile(), which takes a path.
const STANDARD_FONT_DATA_URL = `${fileURLToPath(new URL('standard_fonts/', import.meta.resolve('pdfjs-dist/package.json')))}/`;

/**
 * Reconstructs rough lines from pdf.js's flat item list by grouping
 * items whose Y coordinate is close together. pdf.js gives us
 * positioned glyphs/words, not lines — this is the same
 * approximation any text-layer extractor makes.
 */
function itemsToLines(items) {
  const positioned = items
    .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5] }))
    .sort((a, b) => b.y - a.y || a.x - b.x);

  const lines = [];
  let curY = null;
  let curLine = [];

  for (const it of positioned) {
    if (curY === null || Math.abs(it.y - curY) > 2) {
      if (curLine.length) lines.push(curLine.join(' '));
      curLine = [it.str];
      curY = it.y;
    } else {
      curLine.push(it.str);
    }
  }
  if (curLine.length) lines.push(curLine.join(' '));

  return lines.filter((l) => l.trim() !== '');
}

/**
 * Extract per-page text from a PDF buffer.
 * Returns [{ pageNumber, lines, text, hasTextLayer }].
 *
 * `password` is optional and harmless to pass for an unencrypted
 * PDF — pdfjs-dist just ignores it. Only matters for the household's
 * own password-protected statements (a Zolve export was the real
 * case this got built for), never logged or stored past this call.
 */
export async function extractPdfPages(buffer, password) {
  const data = new Uint8Array(buffer);
  // destroy() lives on the loading task, not the resolved document.
  const loadingTask = getDocument({
    data,
    useSystemFonts: true,
    isEvalSupported: false,
    password,
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
  });
  const doc = await loadingTask.promise;

  const pages = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const lines = itemsToLines(content.items);
      const text = lines.join('\n');

      pages.push({
        pageNumber: i,
        lines,
        text,
        hasTextLayer: text.length >= MIN_USABLE_CHARS,
      });
    }
  } finally {
    await loadingTask.destroy();
  }

  return pages;
}
