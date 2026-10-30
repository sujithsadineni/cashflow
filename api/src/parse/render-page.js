/**
 * Renders a single PDF page to a PNG, for pages that failed Stage 1
 * text extraction (no usable text layer — almost always a scan).
 *
 * This path exists because "do not silently skip it" was explicit:
 * older statements are often scans and losing a page is worse than
 * paying for image extraction on it. It could not be validated
 * against a real statement in this project — all six approved
 * statements were text-based PDFs. Treat it as untested against real
 * scans until one comes through the app.
 */

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';

const RENDER_SCALE = 2; // ~144 DPI equivalent — legible without an oversized image

export async function renderPageToPng(buffer, pageNumber, password) {
  const loadingTask = getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, password });
  const doc = await loadingTask.promise;
  try {
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: RENDER_SCALE });

    const canvas = createCanvas(viewport.width, viewport.height);
    const context = canvas.getContext('2d');

    await page.render({ canvasContext: context, viewport }).promise;

    return canvas.toBuffer('image/png');
  } finally {
    await loadingTask.destroy();
  }
}
