import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { createRequire } from "node:module";

// Resolve the worker explicitly so serverless bundles (Vercel/nft) can find it.
try {
  const require = createRequire(import.meta.url);
  const workerPath = require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = workerPath;
} catch {
  /* the legacy build falls back to its own resolution */
}
import { createCanvas } from "@napi-rs/canvas";
import { fixExtractedLine, hasArabic } from "./arabic.mjs";
import {
  chooseLineText, groupIntoLines, mergeWrappedLines, structuredLines, tableRows,
} from "./text-assembly.mjs";

const PDFJS_OPTIONS = {
  isEvalSupported: false,
  useSystemFonts: false,
  disableFontFace: true,
  standardFontDataUrl: undefined,
};

export async function openPdfJs(buffer) {
  const data = new Uint8Array(buffer);
  const task = pdfjs.getDocument({ ...PDFJS_OPTIONS, data, verbosity: 0 });
  const doc = await task.promise;
  return doc;
}

/** Renders pages to image buffers. Returns points + pixels metadata. */
export async function renderPdfPages(buffer, { dpi = 150, format = "png", quality = 0.9, maxPages = 200, pages = null } = {}) {
  const doc = await openPdfJs(buffer);
  const scale = dpi / 72;
  const results = [];
  const indices = pages || Array.from({ length: Math.min(doc.numPages, maxPages) }, (_, i) => i + 1);
  for (const pageNumber of indices) {
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    const data = format === "jpeg"
      ? canvas.toBuffer("image/jpeg", quality)
      : canvas.toBuffer("image/png");
    const base = page.getViewport({ scale: 1 });
    results.push({
      data,
      page: pageNumber,
      width: canvas.width,
      height: canvas.height,
      widthPt: base.width,
      heightPt: base.height,
    });
    page.cleanup();
  }
  await doc.destroy();
  return results;
}

/** Extracts structured text (lines with size + alignment hints) from a PDF. */
export async function extractPdfStructure(buffer, { maxPages = 400, onProgress = null } = {}) {
  const doc = await openPdfJs(buffer);
  const pages = [];
  const count = Math.min(doc.numPages, maxPages);
  for (let p = 1; p <= count; p += 1) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const lines = structuredLines(content.items);
    const viewport = page.getViewport({ scale: 1 });
    pages.push({ page: p, width: viewport.width, height: viewport.height, lines });
    page.cleanup();
    if (onProgress) onProgress(p, count);
  }
  await doc.destroy();
  return pages;
}

/**
 * Table/row extraction used by the PDF -> Excel converter.
 */
export async function extractPdfGrid(buffer, { maxPages = 60 } = {}) {
  const doc = await openPdfJs(buffer);
  const count = Math.min(doc.numPages, maxPages);
  const sheets = [];
  for (let p = 1; p <= count; p += 1) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const rows = tableRows(content.items);
    let arabicCells = 0;
    let totalCells = 0;
    rows.forEach((row) => row.forEach((cell) => {
      totalCells += 1;
      if (hasArabic(cell)) arabicCells += 1;
    }));
    const rtlPage = totalCells > 0 && arabicCells / totalCells > 0.2;
    if (rows.length) {
      sheets.push({ page: p, rows: rows.map((row) => (rtlPage ? [...row].reverse() : row)) });
    }
    page.cleanup();
  }
  await doc.destroy();
  return sheets;
}

export async function pdfHasTextLayer(buffer) {
  const doc = await openPdfJs(buffer);
  let chars = 0;
  const pages = Math.min(doc.numPages, 3);
  for (let p = 1; p <= pages; p += 1) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    chars += content.items.reduce((sum, item) => sum + (item.str ? item.str.trim().length : 0), 0);
    page.cleanup();
  }
  await doc.destroy();
  return chars > 20;
}
